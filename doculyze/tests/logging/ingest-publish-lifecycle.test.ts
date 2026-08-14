import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Transport from "winston-transport";
import { createLogger } from "winston";

const { createChannel } = vi.hoisted(() => ({ createChannel: vi.fn() }));

vi.mock("@/_lib/rabbitmq", () => ({ createChannel }));

import {
  IngestConfirmTimeoutError,
  publishIngestJob,
} from "@/_lib/ingest_broker";
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

describe("publishIngestJob operational lifecycle seam", () => {
  it("records correlated queued start and terminal events after broker confirmation", async () => {
    const transport = captureEvents();
    createChannel.mockResolvedValue({
      sendToQueue: (_queue: string, _body: Buffer, _options: object, callback: (error: Error | null) => void) => callback(null),
    });

    await expect(publishIngestJob("user-a", "doc-a")).resolves.toBeUndefined();

    expect(transport.events).toEqual([
      expect.objectContaining({ operation: "publishIngestJob", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "publishIngestJob",
        lifecycle: "queued",
        level: "info",
        durationMs: expect.any(Number),
      }),
    ]);
    expect(transport.events[1].requestId).toBe(transport.events[0].requestId);
  });

  it("records an unknown warn event that explains a timed-out confirmation may have delivered", async () => {
    vi.useFakeTimers();
    const transport = captureEvents();
    createChannel.mockResolvedValue({ sendToQueue: vi.fn() });

    const publish = publishIngestJob("user-a", "doc-a");
    const rejectedPublish = expect(publish).rejects.toBeInstanceOf(IngestConfirmTimeoutError);
    await vi.advanceTimersByTimeAsync(5_000);

    await rejectedPublish;
    expect(transport.events).toEqual([
      expect.objectContaining({ operation: "publishIngestJob", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "publishIngestJob",
        lifecycle: "unknown",
        level: "warn",
        reason: "confirm_timeout",
        message: "Ingest enqueue confirmation timed out; the message may have been delivered.",
      }),
    ]);
  });

  it("preserves a broker failure while recording a failed terminal event", async () => {
    const transport = captureEvents();
    const outage = new Error("connection refused");
    createChannel.mockRejectedValue(outage);

    await expect(publishIngestJob("user-a", "doc-a")).rejects.toBe(outage);

    expect(transport.events).toEqual([
      expect.objectContaining({ operation: "publishIngestJob", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "publishIngestJob",
        lifecycle: "failed",
        level: "error",
        reason: "publish_failed",
      }),
    ]);
  });
});
