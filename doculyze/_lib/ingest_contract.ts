// Neutral module (no "use client" / no server-only) — same pattern as
// fileupload_schema.ts: this vocabulary is shared by the producer (server),
// finalizeUpload's return value, and the upload page's client branching, and a
// single module keeps the three from drifting.
//
// Enqueue outcome contract (issue #10):
//   "queued"  — the broker durably confirmed the envelope.
//   "failed"  — definitely NOT enqueued (connection refused, channel closed,
//               nack, ingest disabled). The upload itself is still saved; the
//               re-publish sweep (#9) is the recovery owner.
//   "unknown" — publish confirm timed out; the envelope MAY have landed.
//               Never render this as a failure — the truth is "delayed".
export type EnqueueOutcome = "queued" | "failed" | "unknown";

export type FinalizeResult = {
  enqueue: EnqueueOutcome;
};

// Document statuses that end the pipeline stream: the route handler closes
// server-side and the client closes its EventSource on the same event. One
// list here so the two ends can't drift.
export const TERMINAL_DOC_STATUSES = ["ready", "failed"] as const;

export function isTerminalDocStatus(status: string): boolean {
  return (TERMINAL_DOC_STATUSES as readonly string[]).includes(status);
}
