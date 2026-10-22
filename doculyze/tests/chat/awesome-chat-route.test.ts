import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

// --- Mock the auth boundary (outside the DB seam) ---------------------------
// Same discipline as ingest-enqueue.test.ts: uid driven by the harness's
// authAs() global; Firestore stays REAL (emulator-backed).
vi.mock("@/_lib/data", () => ({
  getCurrentUid: async () => (globalThis as Record<string, unknown>).__TEST_UID__ ?? null,
}));

import { POST } from "@/app/api/awesome-chat/route";
import { createSseParser, type ChatEvent } from "@/_lib/chat_events";
import { createConversation, readTranscript } from "@/_lib/conversations";
import { authAs, resetEmulators } from "../helpers/harness";

const UID = "user-a";

// --- Stub chat service -------------------------------------------------------
// Stands in for the Python service at the HTTP boundary: records what Next sent
// and replies with canned SSE, chosen per test via `mode`.
type Mode = "answer" | "http-500" | "hang-after-one-token";
let mode: Mode = "answer";
let lastBody: Record<string, unknown> | null = null;
let upstreamClosed = false;

const stub = http.createServer((req, res) => {
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
      { type: "token", text: "Hel" },
      { type: "token", text: "lo" },
      { type: "done" },
    ]);
    // The uid sent upstream comes from the session, never the request body.
    expect(lastBody).toEqual({ uid: UID, question: "What is recursion?", history: [] });
    expect(await readTranscript(UID, conversationId)).toEqual([
      { role: "user", content: "What is recursion?", seq: 0 },
      { role: "assistant", content: "Hello", seq: 1, status: "complete" },
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

    expect(await readEvents(res)).toEqual([{ type: "error", message: "Answer failed." }]);
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
    expect(reply).toEqual({ role: "assistant", content: "Hel", seq: 1, status: "stopped" });
    await waitFor(async () => (upstreamClosed ? true : undefined));
  });

  it("only reads Conversations in the caller's own namespace", async () => {
    const othersConversation = await createConversation("user-b", "private");
    const res = await post({ question: "peek", conversationId: othersConversation });
    expect(res.status).toBe(404);
  });
});
