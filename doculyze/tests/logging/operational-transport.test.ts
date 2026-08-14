import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOperationalLogger } from "@/_lib/operational_logger";

async function flush(logger: ReturnType<typeof createOperationalLogger>): Promise<void> {
  await new Promise<void>((resolve) => {
    logger.on("finish", resolve);
    logger.end();
  });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("operational logger transport seam", () => {
  it("writes each development event as JSONL below the configured log path", async () => {
    const logDirectory = await mkdtemp(path.join(tmpdir(), "doculyze-logs-"));
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_FILE_PATH", path.join(logDirectory, "nested", "operational-%DATE%.jsonl"));

    try {
      const logger = createOperationalLogger();
      logger.log("info", {
        category: "database op",
        operation: "listDocuments",
        lifecycle: "succeeded",
      });
      await flush(logger);

      const [logFile] = (await readdir(path.join(logDirectory, "nested")))
        .filter((entry) => entry.endsWith(".jsonl"));
      const entries = await readFile(path.join(logDirectory, "nested", logFile), "utf8");
      const entry = entries.trim();
      expect(entry.startsWith('{"category":"database op","operation":"listDocuments","lifecycle":"succeeded","level":"info"')).toBe(true);
      expect(JSON.parse(entry)).toMatchObject({
        level: "info",
        category: "database op",
        operation: "listDocuments",
        lifecycle: "succeeded",
      });
    } finally {
      await rm(logDirectory, { recursive: true, force: true });
    }
  });

  it("writes structured production events to stdout without creating local log directories", async () => {
    const logDirectory = await mkdtemp(path.join(tmpdir(), "doculyze-logs-"));
    const configuredPath = path.join(logDirectory, "nested", "operational-%DATE%.jsonl");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_FILE_PATH", configuredPath);
    const consoleOutput = console as typeof console & { _stdout: { write: (entry: string) => boolean } };
    const originalStdout = consoleOutput._stdout;
    const writes: string[] = [];
    consoleOutput._stdout = { write: (entry) => { writes.push(entry); return true; } };

    try {
      const logger = createOperationalLogger();
      logger.log("info", {
        category: "database op",
        operation: "listDocuments",
        lifecycle: "succeeded",
      });
      await flush(logger);

      expect(writes.join("")).toContain(
        '{"category":"database op","operation":"listDocuments","lifecycle":"succeeded","level":"info"',
      );
      await expect(access(path.join(logDirectory, "nested"))).rejects.toThrow();
    } finally {
      consoleOutput._stdout = originalStdout;
      await rm(logDirectory, { recursive: true, force: true });
    }
  });
});
