import "server-only";
import { createChannel } from "./rabbitmq";

// The ingest producer (issue #4). Publishes the pointer envelope {uid, docId} —
// never bytes — onto the durable queue after finalize flips a record to `uploaded`.
// Broker-agnostic beyond this module + the worker's consumer shell (ADR-0001).
// Connection lifecycle + topology declaration live in ./rabbitmq (getChannel).
const QUEUE = process.env.INGEST_QUEUE ?? "doc.ingest";
const CONFIRM_TIMEOUT_MS = 5000;

// Issue #10 enqueue-outcome contract: a resolve means the broker durably
// confirmed the envelope (`queued`). Every other outcome rejects, and the two
// classes below are how finalizeUpload tells "definitely not enqueued" apart
// from "may have landed" — the mapping stays this thin on purpose.
export class IngestConfirmTimeoutError extends Error {}
export class IngestDisabledError extends Error {}

export async function publishIngestJob(uid: string, docId: string): Promise<void> {
  const ch = await createChannel();
  if (!ch) {
    // Ingest disabled (RABBITMQ_URL unset) — doc rests at `uploaded`. A silent
    // resolve here would misreport `queued` to the caller (issue #10), so this
    // is now a definite (recoverable) failure instead of a no-op.
    throw new IngestDisabledError("ingest disabled: RABBITMQ_URL unset");
  }

  const body = Buffer.from(JSON.stringify({ uid, docId })); // exactly two fields

  // Confirmed publish (grill Q3/Q4). The confirm-channel callback fires only after
  // the broker has durably accepted the persistent message onto the durable queue,
  // so a silently-dropped producer->broker hop can no longer leave a doc stuck at
  // `uploaded` unnoticed. Bounded by a timeout so a stalled broker can't hang the
  // user's finalizeUpload request — on timeout we treat the outcome as unknown and
  // let the #9 re-publish sweep reconcile. finalizeUpload swallow-and-logs any
  // throw here, so an enqueue failure never fails the upload itself.
  // One-shot, no retries: a timeout may have landed anyway (retry = duplicate),
  // and a definite failure means the broker is down or dying — the sweep, not an
  // immediate same-broker retry, is the recovery path.
  // (Backpressure/'drain' handling is elided: uploads are human-paced.)
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
  console.log("Ingest job published (confirmed) for", uid, docId);
}
