import "server-only";
import { createChannel } from "./rabbitmq";
import { logOperationalEvent, runWithRequestContext } from "./operational_logger";

// Deletion uses its own durable queue so cleanup retries cannot be starved by
// ingest traffic. The payload stays a pointer: the worker derives every path
// and tenant boundary from the authenticated uid + server-generated docId.
const QUEUE = process.env.DELETE_QUEUE ?? "doc.delete";
const CONFIRM_TIMEOUT_MS = 5000;

// A confirm timeout is distinct from a definite publish failure: RabbitMQ may
// have persisted the message even though its confirmation did not reach us.
export class DeleteConfirmTimeoutError extends Error {}
export class DeleteDisabledError extends Error {}

export async function publishDeleteJob(uid: string, docId: string): Promise<void> {
  return runWithRequestContext(async () => {
    const startedAt = Date.now();
    logOperationalEvent("info", { operation: "publishDeleteJob", lifecycle: "started" });

    try {
      const ch = await createChannel();
      if (!ch) {
        throw new DeleteDisabledError("deletion disabled: RABBITMQ_URL unset");
      }

      const body = Buffer.from(JSON.stringify({ uid, docId }));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new DeleteConfirmTimeoutError("deletion publish confirm timed out")),
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
        operation: "publishDeleteJob",
        lifecycle: "queued",
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof DeleteConfirmTimeoutError) {
        logOperationalEvent("warn", {
          operation: "publishDeleteJob",
          lifecycle: "unknown",
          durationMs: Date.now() - startedAt,
          reason: "confirm_timeout",
          message: "Deletion enqueue confirmation timed out; the message may have been delivered.",
        });
      } else {
        logOperationalEvent("error", {
          operation: "publishDeleteJob",
          lifecycle: "failed",
          durationMs: Date.now() - startedAt,
          reason: "publish_failed",
        });
      }
      throw error;
    }
  });
}
