import { beforeEach, describe, expect, it, vi } from "vitest";

// Session is the only mock; Firestore is the real emulator, because the point of
// this action is that it can only touch the signed-in user's own Conversation.
vi.mock("@/_lib/data", () => ({
  requireUid: async () => {
    const uid = (globalThis as Record<string, unknown>).__TEST_UID__;
    if (!uid) throw new Error("Not signed in");
    return uid;
  },
}));

import { setAnswerMode } from "@/app/actions/chat/set_answer_mode";
import { createConversation, readAnswerMode } from "@/_lib/conversations";
import { authAs, resetEmulators } from "../helpers/harness";

beforeEach(async () => {
  await resetEmulators();
  authAs("user-a");
});

describe("setAnswerMode", () => {
  it("changes the mode of the caller's own Conversation", async () => {
    const id = await createConversation("user-a", "q");

    await expect(setAnswerMode(id, "open")).resolves.toEqual({ ok: true, answerMode: "open" });

    expect(await readAnswerMode("user-a", id)).toBe("open");
    await setAnswerMode(id, "grounded");
    expect(await readAnswerMode("user-a", id)).toBe("grounded");
  });

  it("refuses another user's Conversation and leaves it unchanged", async () => {
    const theirs = await createConversation("user-b", "private");

    await expect(setAnswerMode(theirs, "open")).rejects.toThrow();

    expect(await readAnswerMode("user-b", theirs)).toBe("grounded");
  });

  it("refuses an unknown Conversation without creating one", async () => {
    await expect(setAnswerMode("does-not-exist", "open")).rejects.toThrow();

    expect(await readAnswerMode("user-a", "does-not-exist")).toBeNull();
  });

  it("rejects an invalid mode or a path-like Conversation id", async () => {
    const id = await createConversation("user-a", "q");

    await expect(setAnswerMode(id, "anything-goes" as never)).rejects.toThrow();
    await expect(setAnswerMode("../user-b/conversations/x", "open")).rejects.toThrow();

    expect(await readAnswerMode("user-a", id)).toBe("grounded");
  });

  it("requires a session", async () => {
    const id = await createConversation("user-a", "q");
    authAs(null);

    await expect(setAnswerMode(id, "open")).rejects.toThrow();
  });
});
