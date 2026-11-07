import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/_lib/data", () => ({
  requireUid: async () => {
    const uid = (globalThis as Record<string, unknown>).__TEST_UID__;
    if (!uid) throw new Error("Not signed in");
    return uid;
  },
}));

import { retractMessage } from "@/app/actions/chat/retract_message";
import { appendAssistantMessage, appendUserMessage, createConversation, readTranscript, truncateFrom } from "@/_lib/conversations";
import { db } from "@/_lib/admin";
import { authAs, resetEmulators } from "../helpers/harness";

beforeEach(async () => {
  await resetEmulators();
  authAs("user-a");
});

// Three Turns: seqs 0/1, 2/3, 4/5.
async function threeTurns(uid = "user-a") {
  const id = await createConversation(uid, "q0");
  for (const n of [0, 1, 2]) {
    const seq = await appendUserMessage(uid, id, `q${n}`);
    await appendAssistantMessage(uid, id, seq + 1, `a${n}`, "complete");
  }
  return id;
}

const texts = async (uid: string, id: string) => (await readTranscript(uid, id)).map((m) => `${m.seq}:${m.content}`);

describe("chat ticket 05 — truncateFrom", () => {
  it("removes the Message at the seq and every later one, keeping earlier ones", async () => {
    const id = await threeTurns();

    await truncateFrom("user-a", id, 2);

    expect(await texts("user-a", id)).toEqual(["0:q0", "1:a0"]);
  });

  it("resets the sequence so the next Turn lands where the truncation began", async () => {
    const id = await threeTurns();
    await truncateFrom("user-a", id, 2);

    const seq = await appendUserMessage("user-a", id, "replacement");

    expect(seq).toBe(2);
  });

  it("truncating from 0 empties the transcript but keeps the Conversation", async () => {
    const id = await threeTurns();

    await truncateFrom("user-a", id, 0);

    expect(await readTranscript("user-a", id)).toEqual([]);
    expect(await appendUserMessage("user-a", id, "fresh")).toBe(0);
  });

  it("handles more Messages than one Firestore batch holds", async () => {
    const id = await createConversation("user-a", "long");
    const col = db.collection("users").doc("user-a").collection("conversations").doc(id).collection("messages");
    for (let start = 0; start < 1200; start += 400) {
      const batch = db.batch();
      for (let seq = start; seq < start + 400; seq++) batch.set(col.doc(), { role: seq % 2 ? "assistant" : "user", content: `m${seq}`, seq });
      await batch.commit();
    }
    await db.collection("users").doc("user-a").collection("conversations").doc(id).update({ nextSeq: 1200 });

    await truncateFrom("user-a", id, 10);

    expect((await readTranscript("user-a", id)).map((m) => m.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("chat ticket 05 — retractMessage", () => {
  it("removes the user Message and everything after it, and generates nothing", async () => {
    const id = await threeTurns();

    await expect(retractMessage(id, 2)).resolves.toEqual({ ok: true });

    expect(await texts("user-a", id)).toEqual(["0:q0", "1:a0"]);
  });

  it("refuses an assistant Message or a seq that doesn't exist", async () => {
    const id = await threeTurns();

    await expect(retractMessage(id, 3)).rejects.toThrow(); // a1 is the assistant reply
    await expect(retractMessage(id, 99)).rejects.toThrow();

    expect(await readTranscript("user-a", id)).toHaveLength(6);
  });

  it("refuses another user's Conversation and leaves it intact", async () => {
    const theirs = await threeTurns("user-b");

    await expect(retractMessage(theirs, 0)).rejects.toThrow();

    expect(await readTranscript("user-b", theirs)).toHaveLength(6);
  });

  it("rejects bad input and requires a session", async () => {
    const id = await threeTurns();

    await expect(retractMessage("../user-b/conversations/x", 0)).rejects.toThrow();
    await expect(retractMessage(id, -1)).rejects.toThrow();
    await expect(retractMessage(id, 1.5)).rejects.toThrow();
    authAs(null);
    await expect(retractMessage(id, 0)).rejects.toThrow();

    expect(await readTranscript("user-a", id)).toHaveLength(6);
  });
});

describe("chat ticket 05 — a reply can't outlive the Turn it answered", () => {
  it("is written when its Turn's user Message is still there", async () => {
    const id = await createConversation("user-a", "q");
    const seq = await appendUserMessage("user-a", id, "q", "turn-1");

    const written = await appendAssistantMessage("user-a", id, seq + 1, "a", "complete", { turnId: "turn-1" });

    expect(written).toBe(true);
    expect(await texts("user-a", id)).toEqual(["0:q", "1:a"]);
  });

  it("is dropped when its Turn was truncated away before the reply landed", async () => {
    const id = await createConversation("user-a", "q");
    const seq = await appendUserMessage("user-a", id, "q", "turn-1");
    await truncateFrom("user-a", id, 0); // the user retracted while the answer streamed

    const written = await appendAssistantMessage("user-a", id, seq + 1, "late partial", "stopped", { turnId: "turn-1" });

    expect(written).toBe(false);
    expect(await readTranscript("user-a", id)).toEqual([]);
  });

  it("is dropped even when a new Turn has since taken the same seq", async () => {
    const id = await createConversation("user-a", "q");
    const oldSeq = await appendUserMessage("user-a", id, "old question", "turn-old");
    await truncateFrom("user-a", id, 0);
    await appendUserMessage("user-a", id, "edited question", "turn-new"); // lands at seq 0 again

    const written = await appendAssistantMessage("user-a", id, oldSeq + 1, "answer to the OLD question", "stopped", { turnId: "turn-old" });

    expect(written).toBe(false);
    expect(await texts("user-a", id)).toEqual(["0:edited question"]);
  });
});
