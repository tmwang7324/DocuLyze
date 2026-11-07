import { beforeEach, describe, expect, it, vi } from "vitest";

// Session is the only mock; Firestore is the real emulator. The point of these
// tests is that a user only ever sees, and can only delete, their own Conversations.
vi.mock("@/_lib/data", () => ({
  requireUid: async () => {
    const uid = (globalThis as Record<string, unknown>).__TEST_UID__;
    if (!uid) throw new Error("Not signed in");
    return uid;
  },
}));

import { deleteConversation } from "@/app/actions/chat/delete_conversation";
import { listMyConversations } from "@/app/actions/chat/list_conversations";
import { appendAssistantMessage, appendUserMessage, conversationExists, createConversation, listConversations, readTranscript } from "@/_lib/conversations";
import { authAs, resetEmulators } from "../helpers/harness";

const tick = () => new Promise((r) => setTimeout(r, 15)); // serverTimestamp ties within a millisecond

beforeEach(async () => {
  await resetEmulators();
  authAs("user-a");
});

describe("chat ticket 12 — listing Conversations", () => {
  it("lists the caller's Conversations, most recently active first", async () => {
    const first = await createConversation("user-a", "What is a heap?");
    await tick();
    const second = await createConversation("user-a", "Explain error budgets");

    const list = await listConversations("user-a");

    expect(list.map((c) => c.id)).toEqual([second, first]);
    expect(list.map((c) => c.title)).toEqual(["Explain error budgets", "What is a heap?"]);
  });

  it("moves a Conversation to the top when it gets a new Message", async () => {
    const older = await createConversation("user-a", "older");
    await tick();
    const newer = await createConversation("user-a", "newer");
    await tick();

    await appendUserMessage("user-a", older, "a follow-up");

    expect((await listConversations("user-a")).map((c) => c.id)).toEqual([older, newer]);
  });

  it("never lists another user's Conversations", async () => {
    await createConversation("user-b", "private");
    const mine = await createConversation("user-a", "mine");

    expect((await listConversations("user-a")).map((c) => c.id)).toEqual([mine]);
  });

  it("returns an empty list for a user with no Conversations", async () => {
    expect(await listConversations("user-a")).toEqual([]);
  });
});

describe("chat ticket 12 — listMyConversations (the sidebar's refresh)", () => {
  it("returns the signed-in user's Conversations, newest first, and nobody else's", async () => {
    await createConversation("user-b", "private");
    const older = await createConversation("user-a", "older");
    await tick();
    const newer = await createConversation("user-a", "newer");

    const list = await listMyConversations();

    expect(list.map((c) => c.id)).toEqual([newer, older]);
  });

  it("requires a session", async () => {
    authAs(null);

    await expect(listMyConversations()).rejects.toThrow();
  });
});

describe("chat ticket 12 — deleteConversation", () => {
  it("deletes the Conversation and every Message in it", async () => {
    const id = await createConversation("user-a", "q");
    const seq = await appendUserMessage("user-a", id, "q");
    await appendAssistantMessage("user-a", id, seq + 1, "a", "complete");
    const kept = await createConversation("user-a", "keep me");

    await expect(deleteConversation(id)).resolves.toEqual({ ok: true });

    expect(await conversationExists("user-a", id)).toBe(false);
    expect(await readTranscript("user-a", id)).toEqual([]); // subcollection gone too
    expect(await conversationExists("user-a", kept)).toBe(true);
  });

  it("refuses another user's Conversation and leaves it intact", async () => {
    const theirs = await createConversation("user-b", "private");
    await appendUserMessage("user-b", theirs, "private");

    await expect(deleteConversation(theirs)).rejects.toThrow();

    expect(await conversationExists("user-b", theirs)).toBe(true);
    expect(await readTranscript("user-b", theirs)).toHaveLength(1);
  });

  it("refuses an unknown Conversation and a path-like id", async () => {
    await expect(deleteConversation("does-not-exist")).rejects.toThrow();
    await expect(deleteConversation("../user-b/conversations/x")).rejects.toThrow();
  });

  it("requires a session", async () => {
    const id = await createConversation("user-a", "q");
    authAs(null);

    await expect(deleteConversation(id)).rejects.toThrow();
    expect(await conversationExists("user-a", id)).toBe(true);
  });
});
