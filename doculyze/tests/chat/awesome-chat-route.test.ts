import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

// --- Mock the auth boundary (outside the DB seam) ---------------------------
// Same discipline as ingest-enqueue.test.ts: uid driven by the harness's
// authAs() global; Firestore stays REAL (emulator-backed).
vi.mock("@/_lib/data", () => ({
  getCurrentUid: async () => (globalThis as Record<string, unknown>).__TEST_UID__ ?? null,
}));

import { GET, POST } from "@/app/api/awesome-chat/route";
import { createSseParser, type ChatEvent } from "@/_lib/chat_events";
import { appendUserMessage, createConversation, listConversations, readTranscript } from "@/_lib/conversations";
import { db } from "@/_lib/admin";
import { FieldValue } from "firebase-admin/firestore";
import { authAs, resetEmulators } from "../helpers/harness";

const UID = "user-a";

// --- Stub chat service -------------------------------------------------------
// Stands in for the Python service at the HTTP boundary: records what Next sent
// and replies with canned SSE, chosen per test via `mode`.
const PLAN = { type: "plan", standalone: "What is recursion?", sub_queries: ["recursion definition"], degraded: false } as const;
const SOURCE = { n: 1, doc_id: "doc-1", file_name: "notes.pdf", section: "Ch 1", text: "Recursion is…" };
type Mode = "answer" | "http-500" | "hang-after-one-token";
let mode: Mode = "answer";
let lastBody: Record<string, unknown> | null = null;
let upstreamClosed = false;

const stub = http.createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(mode === "http-500" ? 500 : 200).end();
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    lastBody = JSON.parse(raw);
    if (mode === "http-500") {
      res.writeHead(500).end("boom");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.on("close", () => (upstreamClosed = true));
    res.write(`data: ${JSON.stringify(PLAN)}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "meta", route: "retrieve", answerMode: lastBody?.answer_mode })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "sources", sources: [SOURCE] })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "token", text: "Hel" })}\n\n`);
    if (mode === "hang-after-one-token") return; // never finishes — only Stop ends it
    res.write(`data: ${JSON.stringify({ type: "token", text: "lo" })}\n\n`);
    res.end(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});

afterAll(() => {
  stub.closeAllConnections();
  stub.close();
});

beforeEach(async () => {
  await resetEmulators();
  authAs(UID);
  mode = "answer";
  lastBody = null;
  upstreamClosed = false;
});

// --- Helpers -----------------------------------------------------------------
function post(body: unknown, signal?: AbortSignal) {
  return POST(
    new Request("http://localhost/api/awesome-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  );
}

async function readEvents(res: Response): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  const parse = createSseParser((e) => events.push(e));
  parse(await res.text());
  return events;
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

// --- Tests -------------------------------------------------------------------
describe("chat ticket 02 — /api/awesome-chat route handler", () => {
  it("reports whether the chat service is reachable", async () => {
    expect((await GET()).status).toBe(200);
    mode = "http-500";
    expect((await GET()).status).toBe(503);
  });
  it("returns 401 without a session and never calls the chat service", async () => {
    authAs(null);
    const res = await post({ question: "hi" });
    expect(res.status).toBe(401);
    expect(lastBody).toBeNull();
  });

  it("rejects an empty question (400) and an unknown Conversation (404)", async () => {
    expect((await post({ question: "   " })).status).toBe(400);
    expect((await post({ question: "hi", conversationId: "nope" })).status).toBe(404);
  });

  it("relays the stream and saves the Turn as complete", async () => {
    const res = await post({ question: "What is recursion?" });
    const conversationId = res.headers.get("X-Conversation-Id")!;

    expect(await readEvents(res)).toEqual([
      PLAN,
      { type: "meta", route: "retrieve", answerMode: "grounded" },
      { type: "sources", sources: [SOURCE] },
      { type: "token", text: "Hel" },
      { type: "token", text: "lo" },
      { type: "done" },
    ]);
    // The uid sent upstream comes from the session, never the request body.
    expect(lastBody).toEqual({ uid: UID, question: "What is recursion?", history: [], documents: [], answer_mode: "grounded" });
    expect(await readTranscript(UID, conversationId)).toEqual([
      { role: "user", content: "What is recursion?", seq: 0 },
      { role: "assistant", content: "Hello", seq: 1, status: "complete", answerMode: "grounded", route: "retrieve", sources: [SOURCE], plan: { standalone: PLAN.standalone, sub_queries: PLAN.sub_queries, degraded: false } },
    ]);
  });

  it("sends the saved history on the next Turn of the same Conversation", async () => {
    const first = await post({ question: "q1" });
    const conversationId = first.headers.get("X-Conversation-Id")!;
    await first.text();

    await (await post({ question: "q2", conversationId })).text();

    expect(lastBody?.history).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "Hello" },
    ]);
    expect((await readTranscript(UID, conversationId)).map((m) => m.seq)).toEqual([0, 1, 2, 3]);
  });

  it("keeps the user Message when the chat service fails, and saves the reply as failed", async () => {
    mode = "http-500";
    const res = await post({ question: "Will this survive?" });
    const conversationId = res.headers.get("X-Conversation-Id")!;

    expect(await readEvents(res)).toEqual([{ type: "error", message: "Chat service connection or stream failed. Check the server console." }]);
    expect(await readTranscript(UID, conversationId)).toEqual([
      { role: "user", content: "Will this survive?", seq: 0 },
      { role: "assistant", content: "", seq: 1, status: "failed" },
    ]);
  });

  it("Stop aborts the chat service call and saves the partial answer as stopped", async () => {
    mode = "hang-after-one-token";
    const browser = new AbortController();
    const res = await post({ question: "Long answer please" }, browser.signal);
    const conversationId = res.headers.get("X-Conversation-Id")!;

    const reader = res.body!.getReader();
    await reader.read(); // the first token has arrived
    browser.abort(); // the user pressed Stop
    await reader.cancel().catch(() => {});

    const reply = await waitFor(async () =>
      (await readTranscript(UID, conversationId)).find((m) => m.role === "assistant")
    );
    expect(reply).toMatchObject({ role: "assistant", content: "Hel", seq: 1, status: "stopped", sources: [SOURCE] });
    await waitFor(async () => (upstreamClosed ? true : undefined));
  });

  it("sends only the caller's ready documents, with their file names, as the Scope", async () => {
    const docs = (uid: string) => db.collection("users").doc(uid).collection("documents");
    await docs(UID).doc("doc-ready").set({ status: "ready", file_name: "notes.pdf", title: "" });
    await docs(UID).doc("doc-busy").set({ status: "processing", file_name: "draft.pdf", title: "" });
    await docs("user-b").doc("doc-other").set({ status: "ready", file_name: "theirs.pdf", title: "" });

    await (await post({ question: "q" })).text();

    expect(lastBody?.documents).toEqual([{ doc_id: "doc-ready", file_name: "notes.pdf" }]);
  });

  it("a new Conversation honors answerMode from the request, and stores it", async () => {
    const res = await post({ question: "q", answerMode: "open" });
    const conversationId = res.headers.get("X-Conversation-Id")!;
    await res.text();

    expect(lastBody?.answer_mode).toBe("open");
    const conversation = await db.collection("users").doc(UID).collection("conversations").doc(conversationId).get();
    expect(conversation.get("answerMode")).toBe("open");
  });

  it("an existing Conversation ignores answerMode in the body and uses the stored mode", async () => {
    const first = await post({ question: "q1", answerMode: "open" });
    const conversationId = first.headers.get("X-Conversation-Id")!;
    await first.text();

    await (await post({ question: "q2", conversationId, answerMode: "grounded" })).text();

    expect(lastBody?.answer_mode).toBe("open");
  });

  it("a Conversation with no stored mode behaves as grounded", async () => {
    const conversationId = await createConversation(UID, "old chat");
    await db.collection("users").doc(UID).collection("conversations").doc(conversationId).update({ answerMode: FieldValue.delete() });

    await (await post({ question: "q", conversationId, answerMode: "open" })).text();

    expect(lastBody?.answer_mode).toBe("grounded");
  });

  it("stores the mode and route the answer was generated under on the assistant Message", async () => {
    const res = await post({ question: "q", answerMode: "open" });
    const conversationId = res.headers.get("X-Conversation-Id")!;
    await res.text();

    const reply = (await readTranscript(UID, conversationId)).find((m) => m.role === "assistant");
    expect(reply).toMatchObject({ answerMode: "open", route: "retrieve" });
  });

  it("rejects an unknown answerMode (400)", async () => {
    expect((await post({ question: "q", answerMode: "anything-goes" })).status).toBe(400);
  });

  it("only reads Conversations in the caller's own namespace", async () => {
    const othersConversation = await createConversation("user-b", "private");
    const res = await post({ question: "peek", conversationId: othersConversation });
    expect(res.status).toBe(404);
  });
});

// --- Chat ticket 08: Scope pinning ----------------------------------------------
describe("chat ticket 08 — Scope pinning", () => {
  const docs = (uid: string) => db.collection("users").doc(uid).collection("documents");
  const ready = (uid: string, id: string, file_name: string) => docs(uid).doc(id).set({ status: "ready", file_name, title: "" });
  const A = { doc_id: "doc-a", file_name: "a.pdf" };
  const B = { doc_id: "doc-b", file_name: "b.pdf" };

  beforeEach(async () => {
    await ready(UID, "doc-a", "a.pdf");
    await ready(UID, "doc-b", "b.pdf");
  });

  it("searches every ready document when no Scope is chosen", async () => {
    await (await post({ question: "q" })).text();

    expect(lastBody?.documents).toEqual([A, B]);
  });

  it("a new Conversation pinned to one document sends only that document, on every Turn", async () => {
    const first = await post({ question: "q1", scope: ["doc-b"] });
    const conversationId = first.headers.get("X-Conversation-Id")!;
    await first.text();
    expect(lastBody?.documents).toEqual([B]);

    await (await post({ question: "q2", conversationId })).text(); // no scope in this request
    expect(lastBody?.documents).toEqual([B]);
  });

  it("an existing Conversation keeps its stored Scope — the request can't change it", async () => {
    const first = await post({ question: "q1", scope: ["doc-a"] });
    const conversationId = first.headers.get("X-Conversation-Id")!;
    await first.text();

    await (await post({ question: "q2", conversationId, scope: ["doc-b"] })).text();

    expect(lastBody?.documents).toEqual([A]);
  });

  it("ignores a pinned id that belongs to another user", async () => {
    await ready("user-b", "doc-theirs", "theirs.pdf");

    await (await post({ question: "q", scope: ["doc-theirs", "doc-a"] })).text();
    expect(lastBody?.documents).toEqual([A]);

    // Only a foreign id pinned: nothing of the caller's is pinned, so the whole library is searched.
    await (await post({ question: "q", scope: ["doc-theirs"] })).text();
    expect(lastBody?.documents).toEqual([A, B]);
  });

  it("a pinned document that is later deleted drops out of the Scope", async () => {
    const first = await post({ question: "q1", scope: ["doc-a", "doc-b"] });
    const conversationId = first.headers.get("X-Conversation-Id")!;
    await first.text();

    await docs(UID).doc("doc-a").delete();
    await (await post({ question: "q2", conversationId })).text();

    expect(lastBody?.documents).toEqual([B]);
  });

  it("an emptied Scope widens back to everything — it never searches zero documents", async () => {
    const first = await post({ question: "q1", scope: ["doc-a"] });
    const conversationId = first.headers.get("X-Conversation-Id")!;
    await first.text();

    await docs(UID).doc("doc-a").delete();
    await (await post({ question: "q2", conversationId })).text();

    expect(lastBody?.documents).toEqual([B]);
  });

  it("rejects a malformed Scope (400)", async () => {
    expect((await post({ question: "q", scope: "doc-a" })).status).toBe(400);
    expect((await post({ question: "q", scope: [""] })).status).toBe(400);
    expect((await post({ question: "q", scope: Array.from({ length: 201 }, (_, i) => `d${i}`) })).status).toBe(400);
  });
});

// --- Chat ticket 05: Edit and Regenerate --------------------------------------
// Edit = the same POST with `editSeq`: the user Message at that seq and everything
// after it are removed, then the new text runs as an ordinary Turn. Regenerate is an
// Edit with the same text, so it needs no code path of its own.
describe("chat ticket 05 — Edit and Regenerate", () => {
  async function twoTurns() {
    const first = await post({ question: "q1" });
    const conversationId = first.headers.get("X-Conversation-Id")!;
    await first.text();
    await (await post({ question: "q2", conversationId })).text();
    return conversationId;
  }
  const summary = async (id: string) => (await readTranscript(UID, id)).map((m) => `${m.seq}:${m.role}:${m.content}`);

  it("Edit removes that Message and everything after it, then answers the new text", async () => {
    const conversationId = await twoTurns();

    const res = await post({ question: "q2, reworded", conversationId, editSeq: 2 });
    expect(res.headers.get("X-Conversation-Id")).toBe(conversationId);
    await res.text();

    expect(await summary(conversationId)).toEqual(["0:user:q1", "1:assistant:Hello", "2:user:q2, reworded", "3:assistant:Hello"]);
    // The model sees the history before the edited Message only — never the discarded tail.
    expect(lastBody?.history).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("Editing the first Message restarts the Conversation and retitles it", async () => {
    const conversationId = await twoTurns();

    await (await post({ question: "a better first question", conversationId, editSeq: 0 })).text();

    expect(await summary(conversationId)).toEqual(["0:user:a better first question", "1:assistant:Hello"]);
    expect((await listConversations(UID))[0]).toMatchObject({ id: conversationId, title: "a better first question" });
  });

  it("Regenerate (an Edit with the same text) replaces a failed answer instead of duplicating it", async () => {
    mode = "http-500";
    const failed = await post({ question: "Will this work?" });
    const conversationId = failed.headers.get("X-Conversation-Id")!;
    await failed.text();
    expect((await readTranscript(UID, conversationId))[1]).toMatchObject({ role: "assistant", status: "failed" });

    mode = "answer";
    await (await post({ question: "Will this work?", conversationId, editSeq: 0 })).text();

    const transcript = await readTranscript(UID, conversationId);
    expect(transcript.map((m) => `${m.seq}:${m.role}:${m.status ?? ""}`)).toEqual(["0:user:", "1:assistant:complete"]);
    expect(transcript[1].content).toBe("Hello");
  });

  it("refuses an Edit of an assistant Message, a missing seq, or another user's Conversation", async () => {
    const conversationId = await twoTurns();
    const theirs = await createConversation("user-b", "private");
    await appendUserMessage("user-b", theirs, "private");
    const before = await summary(conversationId);

    expect((await post({ question: "x", conversationId, editSeq: 1 })).status).toBe(404); // an assistant reply
    expect((await post({ question: "x", conversationId, editSeq: 99 })).status).toBe(404);
    expect((await post({ question: "x", conversationId: theirs, editSeq: 0 })).status).toBe(404);

    expect(await summary(conversationId)).toEqual(before);
    expect(await readTranscript("user-b", theirs)).toHaveLength(1);
  });

  it("rejects an editSeq without a Conversation, or a malformed one (400)", async () => {
    expect((await post({ question: "x", editSeq: 0 })).status).toBe(400);
    expect((await post({ question: "x", conversationId: "c", editSeq: -1 })).status).toBe(400);
    expect((await post({ question: "x", conversationId: "c", editSeq: 1.5 })).status).toBe(400);
  });

  it("Edit during a live stream: the stopped reply never survives as an orphan", async () => {
    mode = "hang-after-one-token";
    const browser = new AbortController();
    const res = await post({ question: "first wording" }, browser.signal);
    const conversationId = res.headers.get("X-Conversation-Id")!;
    const reader = res.body!.getReader();
    await reader.read(); // an answer is streaming
    await waitFor(async () => ((await readTranscript(UID, conversationId)).length ? true : undefined));

    browser.abort(); // the client aborts first …
    await reader.cancel().catch(() => {});
    mode = "answer";
    await (await post({ question: "second wording", conversationId, editSeq: 0 })).text(); // … then edits
    await new Promise((r) => setTimeout(r, 400)); // give the aborted Turn every chance to write late

    expect(await summary(conversationId)).toEqual(["0:user:second wording", "1:assistant:Hello"]);
  });
});
