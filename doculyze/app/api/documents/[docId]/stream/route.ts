import "server-only";
import { documentRef } from "@/_lib/database";
import { getCurrentUid } from "@/_lib/data";
import { isTerminalDocStatus } from "@/_lib/ingest_contract";

// Per-document pipeline progress stream (issue #10). Server-Sent Events relaying
// the document record's status transitions from Firestore, push end to end:
// worker write -> Firestore -> Admin-SDK snapshot listener -> this stream.
//
// Route handlers are NOT gated by the (protected) layout, so the session check
// happens here: 401 when unauthenticated. The Firestore path derives from the
// cookie uid + the docId param — the same tenant-isolation shape as finalize; a
// tampered docId can only ever reach the caller's own namespace.
//
// This is the first place a client's mere presence holds server-side Firestore
// resources (one listener per open view). Abort cleanup is a correctness
// requirement, not a courtesy — hence the idempotent close() every exit path
// funnels through, and the hard deadline bounding leaked streams.

export const runtime = "nodejs"; // Admin SDK requires Node, not edge
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000; // SSE comments defeat proxy buffering
const HARD_DEADLINE_MS = 5 * 60_000; // generous bound on abandoned streams

export async function GET(
  req: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  const uid = await getCurrentUid(); // hot read — no checkRevoked round-trip
  if (!uid) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { docId } = await params;
  const ref = documentRef(uid, docId);

  const encoder = new TextEncoder();
  let close: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (frame: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          close(); // consumer already gone — release the listener
        }
      };

      const unsubscribe = ref.onSnapshot(
        (snap) => {
          // The listener's immediate initial snapshot is emitted as the first
          // event — this is what makes an EventSource reconnect resync for free.
          if (!snap.exists) {
            close(); // no such doc in the caller's namespace — nothing to watch
            return;
          }
          const data = snap.data()!;
          const status = typeof data.status === "string" ? data.status : "";
          // Payload contract: status and version only.
          send(`data: ${JSON.stringify({ status, version: data.version ?? 0 })}\n\n`);
          // Terminal ends the stream server-side; the client closes its
          // EventSource on the same event to prevent auto-reconnect.
          if (isTerminalDocStatus(status)) close();
        },
        () => close() // listener error: end cleanly so EventSource reconnects
      );

      const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);
      const deadline = setTimeout(close, HARD_DEADLINE_MS);

      close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(keepalive);
        clearTimeout(deadline);
        try {
          controller.close();
        } catch {
          // already errored/closed by the runtime — the cleanup above is what matters
        }
      };

      req.signal.addEventListener("abort", close);
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
