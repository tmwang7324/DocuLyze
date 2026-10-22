import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Transport from "winston-transport";
import { createLogger } from "winston";

const connect = vi.fn();

// RabbitMQ is outside the server seam: this fake broker exercises createChannel's
// observable return and logging contract without needing a running broker.
vi.mock("amqplib", () => ({ default: { connect } }));

class CapturingTransport extends Transport {
  readonly events: Record<string, unknown>[] = [];

  log(info: Record<string, unknown>, callback: () => void): void {
    this.events.push({ ...info });
    callback();
  }
}

function brokerChannel() {
  // The lifecycle code invalidates on a broker event. Keeping the fake's emit
  // surface explicit lets the test model a drop without inspecting module state.
  const listeners = new Map<string, () => void>();
  return {
    channel: {
      on: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
    },
    emit: (event: string) => listeners.get(event)?.(),
  };
}

afterEach(() => {
  delete process.env.RABBITMQ_URL;
  connect.mockReset();
  vi.resetModules();
});

beforeEach(() => {
  delete process.env.RABBITMQ_URL;
});

async function setupOperationalCapture() {
  const transport = new CapturingTransport();
  const { runWithRequestContext, setOperationalLoggerForTests } = await import("@/_lib/operational_logger");
  setOperationalLoggerForTests(createLogger({ transports: [transport] }));
  return { runWithRequestContext, transport };
}

describe("createChannel operational lifecycle seam", () => {
  // Missing configuration is expected: the disabled outcome preserves the null
  // return instead of turning local development into a broker error.
  it("records a correlated disabled lifecycle when broker configuration is absent", async () => {
    const { runWithRequestContext, transport } = await setupOperationalCapture();
    const { createChannel } = await import("@/_lib/rabbitmq");

    await expect(runWithRequestContext(() => createChannel())).resolves.toBeNull();

    expect(transport.events).toEqual([
      expect.objectContaining({ operation: "createChannel", lifecycle: "started", level: "info" }),
      expect.objectContaining({ operation: "createChannel", lifecycle: "disabled", level: "warn" }),
    ]);
    expect(transport.events[1].requestId).toBe(transport.events[0].requestId);
  });

  // A first ready channel is a created outcome, and the start/terminal pair is
  // correlated even though setup crosses several asynchronous broker calls.
  it("records a correlated created lifecycle for a ready broker channel", async () => {
    process.env.RABBITMQ_URL = "amqp://broker.test";
    const channel = {
      on: vi.fn(),
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
    };
    connect.mockResolvedValue({ on: vi.fn(), createConfirmChannel: vi.fn().mockResolvedValue(channel) });
    const { runWithRequestContext, transport } = await setupOperationalCapture();
    const { createChannel } = await import("@/_lib/rabbitmq");

    await expect(runWithRequestContext(() => createChannel())).resolves.toBe(channel);

    expect(channel.assertExchange).toHaveBeenNthCalledWith(1, "doc.ingest.dlx", "direct", { durable: true });
    expect(channel.assertQueue).toHaveBeenNthCalledWith(1, "doc.ingest.dead", { durable: true });
    expect(channel.bindQueue).toHaveBeenNthCalledWith(1, "doc.ingest.dead", "doc.ingest.dlx", "doc.ingest");
    expect(channel.assertQueue).toHaveBeenNthCalledWith(2, "doc.ingest", {
      durable: true,
      arguments: { "x-dead-letter-exchange": "doc.ingest.dlx" },
    });
    expect(channel.assertExchange).toHaveBeenNthCalledWith(2, "doc.delete.dlx", "direct", { durable: true });
    expect(channel.assertQueue).toHaveBeenNthCalledWith(3, "doc.delete.dead", { durable: true });
    expect(channel.bindQueue).toHaveBeenNthCalledWith(2, "doc.delete.dead", "doc.delete.dlx", "doc.delete");
    expect(channel.assertQueue).toHaveBeenNthCalledWith(4, "doc.delete", {
      durable: true,
      arguments: { "x-dead-letter-exchange": "doc.delete.dlx" },
    });

    expect(transport.events).toEqual([
      expect.objectContaining({ operation: "createChannel", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "createChannel",
        lifecycle: "created",
        level: "info",
        channelId: expect.any(String),
      }),
    ]);
    expect(transport.events[1].requestId).toBe(transport.events[0].requestId);
  });

  // Cache reuse must name the same channel; after its close handler invalidates
  // that cache, the replacement is a distinct channel with a distinct ID.
  it("reuses one channel ID for concurrent callers and assigns a new ID after invalidation", async () => {
    process.env.RABBITMQ_URL = "amqp://broker.test";
    const first = brokerChannel();
    const second = brokerChannel();
    connect
      .mockResolvedValueOnce({ on: vi.fn(), createConfirmChannel: vi.fn().mockResolvedValue(first.channel) })
      .mockResolvedValueOnce({ on: vi.fn(), createConfirmChannel: vi.fn().mockResolvedValue(second.channel) });
    const { runWithRequestContext, transport } = await setupOperationalCapture();
    const { createChannel } = await import("@/_lib/rabbitmq");

    await runWithRequestContext(async () => {
      await expect(Promise.all([createChannel(), createChannel()])).resolves.toEqual([
        first.channel,
        first.channel,
      ]);
      first.emit("close");
      await expect(createChannel()).resolves.toBe(second.channel);
    });

    const terminal = transport.events.filter(({ lifecycle }) => lifecycle !== "started");
    expect(terminal).toEqual([
      expect.objectContaining({ operation: "createChannel", lifecycle: "created", level: "info", channelId: expect.any(String) }),
      expect.objectContaining({ operation: "createChannel", lifecycle: "reused", level: "info", channelId: expect.any(String) }),
      expect.objectContaining({ operation: "createChannel", lifecycle: "created", level: "info", channelId: expect.any(String) }),
    ]);
    expect(terminal[1].channelId).toBe(terminal[0].channelId);
    expect(terminal[2].channelId).not.toBe(terminal[0].channelId);
  });

  // Instrumentation is observational: the original broker failure still reaches
  // the caller unchanged after its failed lifecycle event has been recorded.
  it("preserves a broker failure while recording a correlated failed lifecycle", async () => {
    process.env.RABBITMQ_URL = "amqp://broker.test";
    const outage = new Error("connection refused");
    connect.mockRejectedValue(outage);
    const { runWithRequestContext, transport } = await setupOperationalCapture();
    const { createChannel } = await import("@/_lib/rabbitmq");

    await expect(runWithRequestContext(() => createChannel())).rejects.toBe(outage);

    expect(transport.events).toEqual([
      expect.objectContaining({ operation: "createChannel", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "createChannel",
        lifecycle: "failed",
        level: "error",
        error: { name: "Error", message: "connection refused" },
      }),
    ]);
    expect(transport.events[1].requestId).toBe(transport.events[0].requestId);
  });
});
