import "server-only";
import { z } from "zod";
import { getCurrentUid } from "@/_lib/data";
import { createSseParser, sseFrame } from "@/_lib/chat_events";
import {
  appendAssistantMessage,
  appendUserMessage,
  conversationExists,
  createConversation,
  readHistory,
  type MessageStatus,
} from "@/_lib/conversations";
import { logOperationalEvent } from "@/_lib/operational_logger";

// One chat Turn (chat ticket 02, ADR-0006). The browser only ever talks to
// Next: this handler checks the session, owns every Conversation write, and
// relays the internal chat service's SSE stream back to the browser.
//
//   POST { question, conversationId? }  →  text/event-stream of ChatEvents
//   X-Conversation-Id response header   →  the Conversation this Turn landed in
//
// Stop is a closed connection, not a message: the browser aborts its fetch,
// req.signal fires, the upstream fetch is aborted, and the chat service closes
// its OpenAI stream. Whatever was streamed so far is saved as `stopped`.
//
// Route handlers are NOT gated by the (protected) layout, so the session check
// happens here — the same shape as the per-document progress stream.

export const runtime = "nodejs"; // Admin SDK requires Node, not edge
export const dynamic = "force-dynamic";
// Hosts that enforce it (serverless) would otherwise cut long answers at their
// default; under `next start` in the cluster it's inert (ADR-0006).
export const maxDuration = 300;

const KEEPALIVE_MS = 15_000; // SSE comments defeat proxy idle timeouts

const ChatBody = z.object({
  question: z.string().trim().min(1).max(32_000),
  conversationId: z.string().min(1).max(128).optional(),
});

function chatServiceUrl(): string {
  const url = process.env.CHAT_SERVICE_URL;
  if (!url) throw new Error("CHAT_SERVICE_URL is not set");
  return url.replace(/\/$/, "");
}

export async function POST(req: Request) {
  const uid = await getCurrentUid(); // hot read — no checkRevoked round-trip
  if (!uid) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsed = ChatBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return new Response("Bad request", { status: 400 });
  }
  const { question } = parsed.data;

  if (parsed.data.conversationId && !(await conversationExists(uid, parsed.data.conversationId))) {
    return new Response("Not found", { status: 404 });
  }
  const conversationId = parsed.data.conversationId ?? (await createConversation(uid, question));

  const history = await readHistory(uid, conversationId);
  // Started now, awaited only when the reply is written: the user Message write
  // runs in parallel with the chat-service call, never ahead of the first token.
  const userSeq = appendUserMessage(uid, conversationId, question);
  userSeq.catch(() => {}); // observed in persistReply; this just avoids an unhandled-rejection warning

  const upstream = new AbortController();
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (frame: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          open = false; // consumer already gone
        }
      };
      const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);
      const stop = () => upstream.abort();
      req.signal.addEventListener("abort", stop);

      const relay = async () => {
        let text = "";
        let outcome = "failed" as MessageStatus;
        try {
          const res = await fetch(`${chatServiceUrl()}/awesome-chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uid,
              question,
              history: history.map(({ role, content }) => ({ role, content })),
            }),
            signal: upstream.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`chat service responded ${res.status}`);
          }
          const parse = createSseParser((event) => {
            if (event.type === "token") text += event.text;
            else if (event.type === "done") outcome = "complete";
            send(sseFrame(event));
          });
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parse(decoder.decode(value, { stream: true }));
          }
        } catch {
          if (!upstream.signal.aborted) {
            send(sseFrame({ type: "error", message: "Answer failed." }));
          }
        } finally {
          if (upstream.signal.aborted && outcome !== "complete") outcome = "stopped";
          clearInterval(keepalive);
          req.signal.removeEventListener("abort", stop);
          await persistReply(text, outcome);
          if (open) {
            open = false;
            try {
              controller.close();
            } catch {
              // already closed by the runtime
            }
          }
        }
      };

      // The reply is written whether or not anyone is still reading: a Stopped
      // answer keeps the partial text the user saw; a failed one keeps nothing.
      const persistReply = async (text: string, outcome: MessageStatus) => {
        try {
          const seq = await userSeq;
          await appendAssistantMessage(uid, conversationId, seq + 1, outcome === "failed" ? "" : text, outcome);
          logOperationalEvent(outcome === "failed" ? "error" : "info", {
            operation: "chatTurn",
            lifecycle: outcome,
            durationMs: Date.now() - startedAt,
            userId: uid,
            conversationId,
          });
        } catch {
          logOperationalEvent("error", {
            operation: "chatTurn",
            lifecycle: "persist-failed",
            durationMs: Date.now() - startedAt,
            userId: uid,
            conversationId,
          });
        }
      };

      void relay();
    },
    cancel() {
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Conversation-Id": conversationId,
    },
  });
}
