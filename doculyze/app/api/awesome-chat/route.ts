import "server-only";
import { z } from "zod";
import { getCurrentUid } from "@/_lib/data";
import { ANSWER_MODES, createSseParser, sseFrame, type AnswerMode, type RetrievalPlan, type Route, type Source } from "@/_lib/chat_events";
import {
  appendAssistantMessage,
  appendUserMessage,
  createConversation,
  listReadyDocuments,
  readConversation,
  readHistory,
  readUserMessage,
  setConversationTitle,
  truncateFrom,
  type MessageStatus,
  type ReplyExtras,
} from "@/_lib/conversations";
import { logOperationalEvent } from "@/_lib/operational_logger";
import { resolveScope } from "@/_lib/scope";

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

const ChatBody = z
  .object({
    question: z.string().trim().min(1).max(32_000),
    conversationId: z.string().min(1).max(128).optional(),
    // Only used to create a new Conversation; an existing one keeps its stored mode.
    answerMode: z.enum(ANSWER_MODES).optional(),
    // Edit (and so Regenerate, which is an Edit with the same text): the user Message
    // at this seq and everything after it are replaced by `question`.
    editSeq: z.number().int().min(0).optional(),
    // Document ids to pin a NEW Conversation to (ticket 08); ignored on an existing one.
    scope: z.array(z.string().min(1).max(128)).max(200).optional(),
  })
  .refine((body) => body.editSeq === undefined || body.conversationId !== undefined, {
    message: "editSeq needs a conversationId",
  });

function chatServiceUrl(): string {
  const url = process.env.CHAT_SERVICE_URL;
  if (!url) throw new Error("CHAT_SERVICE_URL is not set");
  return url.replace(/\/$/, "");
}

export async function GET() {
  if (!(await getCurrentUid())) return new Response("Unauthorized", { status: 401 });
  try {
    const res = await fetch(chatServiceUrl(), { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`health check returned HTTP ${res.status}`);
    console.info("[chat] Chat service is available");
    return Response.json({ available: true });
  } catch (error) {
    console.error("[chat] Chat service health check failed", error);
    return Response.json({ available: false }, { status: 503 });
  }
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

  // The server holds the mode: an existing Conversation's mode is read from
  // Firestore on every Turn, so nothing in the request can change it.
  // The Scope is held the same way: chosen once, when the Conversation is created,
  // and limited then to the caller's own ready documents.
  const ready = await listReadyDocuments(uid);
  let answerMode: AnswerMode;
  let conversationId: string;
  let pinned: string[];
  if (parsed.data.conversationId) {
    const stored = await readConversation(uid, parsed.data.conversationId);
    if (!stored) return new Response("Not found", { status: 404 });
    answerMode = stored.answerMode;
    pinned = stored.scope;
    conversationId = parsed.data.conversationId;
  } else {
    answerMode = parsed.data.answerMode ?? "grounded";
    const owned = new Set(ready.map((d) => d.doc_id));
    pinned = [...new Set(parsed.data.scope ?? [])].filter((id) => owned.has(id));
    conversationId = await createConversation(uid, question, answerMode, pinned);
  }
  const { documents, widened } = resolveScope(pinned, ready);
  if (widened) console.warn("[chat] Every pinned document is gone; searching the whole library");

  // Edit: discard the Message and everything after it before the history is read, so
  // the model never sees the discarded tail. The target must be one of the caller's
  // own user Messages; anything else is "not found" and nothing is touched.
  const { editSeq } = parsed.data;
  if (editSeq !== undefined) {
    if ((await readUserMessage(uid, conversationId, editSeq)) === null) return new Response("Not found", { status: 404 });
    await truncateFrom(uid, conversationId, editSeq);
    if (editSeq === 0) await setConversationTitle(uid, conversationId, question);
  }

  const history = await readHistory(uid, conversationId);
  // Identifies this Turn's user Message, so a reply that lands after an Edit or
  // Retract removed the Turn (or after another Turn took its seq) is dropped.
  const turnId = crypto.randomUUID();
  // Started now, awaited only when the reply is written: the user Message write
  // runs in parallel with the chat-service call, never ahead of the first token.
  const userSeq = appendUserMessage(uid, conversationId, question, turnId);
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
        let sources: Source[] = [];
        let plan: RetrievalPlan | undefined;
        let route: Route | undefined;
        let answeredIn: AnswerMode | undefined;
        let outcome = "failed" as MessageStatus;
        try {
          const res = await fetch(`${chatServiceUrl()}/awesome-chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uid,
              question,
              history: history.map(({ role, content }) => ({ role, content })),
              documents,
              answer_mode: answerMode,
            }),
            signal: upstream.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`chat service responded ${res.status}`);
          }
          const parse = createSseParser((event) => {
            if (event.type === "plan") {
              plan = { standalone: event.standalone, sub_queries: event.sub_queries, degraded: event.degraded };
              if (event.degraded) console.warn("[chat] Retrieval plan degraded (planner or rerank fell back; see chat-service log)");
            } else if (event.type === "meta") {
              route = event.route;
              answeredIn = event.answerMode;
            } else if (event.type === "sources") sources = event.sources;
            else if (event.type === "token") text += event.text;
            else if (event.type === "done") outcome = "complete";
            else if (event.type === "error") console.error("[chat] Chat service stream error:", event.message);
            send(sseFrame(event));
          });
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parse(decoder.decode(value, { stream: true }));
          }
          if (outcome !== "complete" && !upstream.signal.aborted) {
            console.error("[chat] Chat service stream ended without a done event");
          }
        } catch (error) {
          if (!upstream.signal.aborted) {
            console.error("[chat] Stream failed", error);
            send(sseFrame({ type: "error", message: "Chat service connection or stream failed. Check the server console." }));
          }
        } finally {
          if (upstream.signal.aborted && outcome !== "complete") outcome = "stopped";
          clearInterval(keepalive);
          req.signal.removeEventListener("abort", stop);
          await persistReply(text, outcome, { sources, plan, route, answerMode: answeredIn });
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
      const persistReply = async (text: string, outcome: MessageStatus, { sources = [], plan, route, answerMode: answeredIn }: ReplyExtras) => {
        try {
          const seq = await userSeq;
          const failed = outcome === "failed";
          const written = await appendAssistantMessage(uid, conversationId, seq + 1, failed ? "" : text, outcome, {
            ...(failed ? {} : { sources, plan, route, answerMode: answeredIn }),
            turnId,
          });
          logOperationalEvent(outcome === "failed" ? "error" : "info", {
            operation: "chatTurn",
            // "dropped": the Turn was Edited or Retracted away before its reply landed.
            lifecycle: written ? outcome : "dropped",
            edited: editSeq !== undefined,
            scopeDocuments: documents.length,
            scopePinned: pinned.length,
            scopeWidened: widened,
            durationMs: Date.now() - startedAt,
            userId: uid,
            conversationId,
            sourceCount: failed ? 0 : sources.length,
            subQueryCount: plan?.sub_queries.length ?? 0,
            planDegraded: plan?.degraded ?? false,
            answerMode,
            route: route ?? "none",
          });
        } catch (error) {
          console.error("[chat] Failed to save the assistant message", error);
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
