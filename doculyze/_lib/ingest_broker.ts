import "server-only";
import { createChannel } from "./rabbitmq";
import { logOperationalEvent, runWithRequestContext } from "./operational_logger";

// The ingest producer (issue #4). Publishes the pointer envelope {uid, docId}
// onto the durable queue after finalize flips a record to `uploaded`.
const QUEUE = process.env.INGEST_QUEUE ?? "doc.ingest";
const CONFIRM_TIMEOUT_MS = 5000;

// A resolve means the broker durably confirmed the envelope (`queued`). These
// classes preserve the existing distinction between definite non-enqueue and a
// confirm timeout where the envelope may have landed.
export class IngestConfirmTimeoutError extends Error {}
export class IngestDisabledError extends Error {}

export async function publishIngestJob(uid: string, docId: string): Promise<void> {
  return runWithRequestContext(async () => {
    const startedAt = Date.now();
    logOperationalEvent("info", { operation: "publishIngestJob", lifecycle: "started" });

    try {
      const ch = await createChannel();
      if (!ch) {
        throw new IngestDisabledError("ingest disabled: RABBITMQ_URL unset");
      }

      const body = Buffer.from(JSON.stringify({ uid, docId })); // exactly two fields
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new IngestConfirmTimeoutError("ingest publish confirm timed out")),
          CONFIRM_TIMEOUT_MS,
        );
        ch.sendToQueue(
          QUEUE,
          body,
          { persistent: true, contentType: "application/json" },
          (err) => {
            clearTimeout(timer);
            if (err) reject(err);
            else resolve();
          },
        );
      });

      logOperationalEvent("info", {
        operation: "publishIngestJob",
        lifecycle: "queued",
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof IngestConfirmTimeoutError) {
        logOperationalEvent("warn", {
          operation: "publishIngestJob",
          lifecycle: "unknown",
          durationMs: Date.now() - startedAt,
          reason: "confirm_timeout",
          message: "Ingest enqueue confirmation timed out; the message may have been delivered.",
        });
      } else {
        logOperationalEvent("error", {
          operation: "publishIngestJob",
          lifecycle: "failed",
          durationMs: Date.now() - startedAt,
          // Broker errors can include connection details; retain only a safe reason.
          reason: "publish_failed",
        });
      }
      throw error;
    }
  });
}
