import { afterEach, describe, expect, it, vi } from "vitest";
import Transport from "winston-transport";
import { createLogger } from "winston";

const { createChannel } = vi.hoisted(() => ({ createChannel: vi.fn() }));

vi.mock("@/_lib/rabbitmq", () => ({ createChannel }));

import {
  DeleteConfirmTimeoutError,
  publishDeleteJob,
} from "@/_lib/delete_broker";
import {
  resetOperationalLoggerForTests,
  setOperationalLoggerForTests,
} from "@/_lib/operational_logger";

class CapturingTransport extends Transport {
  readonly events: Record<string, unknown>[] = [];

  log(info: Record<string, unknown>, callback: () => void): void {
    this.events.push({ ...info });
    callback();
  }
}

function captureEvents(): CapturingTransport {
  const transport = new CapturingTransport();
  setOperationalLoggerForTests(createLogger({ transports: [transport] }));
  return transport;
}

afterEach(() => {
  resetOperationalLoggerForTests();
  createChannel.mockReset();
  vi.useRealTimers();
});

describe("publishDeleteJob operational lifecycle seam", () => {
  it("durably publishes exactly the uid and docId, then records a queued event", async () => {
    const transport = captureEvents();
    const sendToQueue = vi.fn(
      (_queue: string, _body: Buffer, _options: object, callback: (error: Error | null) => void) => callback(null),
    );
    createChannel.mockResolvedValue({ sendToQueue });

    await expect(publishDeleteJob("user-a", "doc-a")).resolves.toBeUndefined();

    expect(sendToQueue).toHaveBeenCalledWith(
      "doc.delete",
      expect.any(Buffer),
      { persistent: true, contentType: "application/json" },
      expect.any(Function),
    );
    expect(JSON.parse(sendToQueue.mock.calls[0][1].toString("utf8"))).toEqual({
      uid: "user-a",
      docId: "doc-a",
    });
    expect(transport.events).toEqual([
      expect.objectContaining({ operation: "publishDeleteJob", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "publishDeleteJob",
        lifecycle: "queued",
        level: "info",
        durationMs: expect.any(Number),
      }),
    ]);
    expect(transport.events[1].requestId).toBe(transport.events[0].requestId);
  });

  it("records an unknown outcome when publisher confirmation times out", async () => {
    vi.useFakeTimers();
    const transport = captureEvents();
    createChannel.mockResolvedValue({ sendToQueue: vi.fn() });

    const publish = publishDeleteJob("user-a", "doc-a");
    const rejectedPublish = expect(publish).rejects.toBeInstanceOf(DeleteConfirmTimeoutError);
    await vi.advanceTimersByTimeAsync(5_000);

    await rejectedPublish;
    expect(transport.events).toEqual([
      expect.objectContaining({ operation: "publishDeleteJob", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "publishDeleteJob",
        lifecycle: "unknown",
        level: "warn",
        reason: "confirm_timeout",
        message: "Deletion enqueue confirmation timed out; the message may have been delivered.",
      }),
    ]);
  });

  it("preserves a broker failure while recording a failed event", async () => {
    const transport = captureEvents();
    const outage = new Error("connection refused");
    createChannel.mockRejectedValue(outage);

    await expect(publishDeleteJob("user-a", "doc-a")).rejects.toBe(outage);

    expect(transport.events).toEqual([
      expect.objectContaining({ operation: "publishDeleteJob", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "publishDeleteJob",
        lifecycle: "failed",
        level: "error",
        reason: "publish_failed",
      }),
    ]);
  });
});
