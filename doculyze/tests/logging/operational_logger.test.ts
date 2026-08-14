import { afterEach, describe, expect, it } from "vitest";
import Transport from "winston-transport";
import { createLogger } from "winston";
import {
  createOperationalLogger,
  logOperationalEvent,
  resetOperationalLoggerForTests,
  runWithRequestContext,
  setOperationalLoggerForTests,
} from "@/_lib/operational_logger";

class CapturingTransport extends Transport {
  readonly events: Record<string, unknown>[] = [];

  log(info: Record<string, unknown>, callback: () => void): void {
    this.events.push({ ...info });
    callback();
  }
}

afterEach(() => {
  resetOperationalLoggerForTests();
  delete process.env.LOG_LEVEL;
});

describe("operational logger seam", () => {
  it("honors LOG_LEVEL while exposing structured events to a Winston test transport", () => {
    process.env.LOG_LEVEL = "warn";
    const transport = new CapturingTransport();
    setOperationalLoggerForTests(createOperationalLogger({
      transports: [transport],
    }));

    logOperationalEvent("info", { operation: "listDocuments", lifecycle: "started" });
    logOperationalEvent("warn", { operation: "publishIngestJob", lifecycle: "unknown" });

    expect(transport.events).toEqual([
      expect.objectContaining({
        level: "warn",
        category: "intermediate function",
        operation: "publishIngestJob",
        lifecycle: "unknown",
      }),
    ]);
  });

  it("creates a request ID at the top level and reuses it in nested work without parameters", async () => {
    const transport = new CapturingTransport();
    setOperationalLoggerForTests(createLogger({ transports: [transport] }));

    await runWithRequestContext(async () => {
      logOperationalEvent("info", { operation: "finalizeUpload", lifecycle: "started" });
      await runWithRequestContext(async () => {
        logOperationalEvent("info", { operation: "publishIngestJob", lifecycle: "started" });
      });
    });

    expect(transport.events).toHaveLength(2);
    expect(transport.events[0].category).toBe("server-action");
    expect(transport.events[1].category).toBe("intermediate function");
    expect(transport.events[0].requestId).toEqual(expect.any(String));
    expect(transport.events[1].requestId).toBe(transport.events[0].requestId);
  });

  it("puts a classified category before the operation in each event", () => {
    const transport = new CapturingTransport();
    setOperationalLoggerForTests(createLogger({ transports: [transport] }));

    logOperationalEvent("info", { operation: "listDocuments", lifecycle: "started" });

    expect(transport.events[0].category).toBe("database op");
    expect(Object.keys(transport.events[0]).slice(0, 2)).toEqual(["category", "operation"]);
  });

  it("redacts sensitive metadata and ignores a logger failure", () => {
    const transport = new CapturingTransport();
    setOperationalLoggerForTests(createLogger({ transports: [transport] }));

    logOperationalEvent("error", {
      operation: "createRefresh",
      lifecycle: "failed",
      password: "secret",
      idToken: "id-token",
      signedUrl: "https://sensitive.example",
      error: new Error("authentication failed"),
    });

    expect(transport.events).toEqual([
      expect.objectContaining({
        password: "[REDACTED]",
        idToken: "[REDACTED]",
        signedUrl: "[REDACTED]",
        error: { name: "Error", message: "authentication failed" },
      }),
    ]);

    setOperationalLoggerForTests({
      log: () => { throw new Error("transport unavailable"); },
      on: () => undefined,
    } as never);
    expect(() => logOperationalEvent("info", { operation: "listDocuments", lifecycle: "started" }))
      .not.toThrow();
  });
});
