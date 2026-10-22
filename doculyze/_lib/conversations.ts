import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/_lib/admin";

// Conversations and their Messages (ADR-0006: Next owns every Conversation
// read and write; the chat service is stateless).
//
//   users/{uid}/conversations/{conversationId}            { title, nextSeq, createdAt, updatedAt }
//   users/{uid}/conversations/{conversationId}/messages/* { role, content, seq, status?, createdAt }
//
// Every function takes the uid explicitly, like documentRef: the only callers
// are the chat route handler and the chat page, which derive it from the
// session cookie. A tampered conversationId can only reach the caller's own
// namespace.

export type ChatRole = "user" | "assistant";
// complete: the answer finished. stopped: the user pressed Stop; the partial
// text is what they saw. failed: generation or search broke (ticket 05 adds
// Regenerate).
export type MessageStatus = "complete" | "stopped" | "failed";

export type ChatMessage = {
    role: ChatRole;
    content: string;
    seq: number;
    status?: MessageStatus; // assistant Messages only
};

const TITLE_MAX = 80;

function conversationsCol(uid: string) {
    return db.collection("users").doc(uid).collection("conversations");
}

function messagesCol(uid: string, conversationId: string) {
    return conversationsCol(uid).doc(conversationId).collection("messages");
}

// A new, empty Conversation titled after its first question. The id is
// server-generated, never client-supplied.
export async function createConversation(uid: string, firstQuestion: string): Promise<string> {
    const ref = conversationsCol(uid).doc();
    await ref.set({
        title: firstQuestion.slice(0, TITLE_MAX),
        nextSeq: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
}

export async function conversationExists(uid: string, conversationId: string): Promise<boolean> {
    return (await conversationsCol(uid).doc(conversationId).get()).exists;
}

// The full transcript in order — what the chat page renders.
export async function readTranscript(uid: string, conversationId: string): Promise<ChatMessage[]> {
    const snap = await messagesCol(uid, conversationId).orderBy("seq").get();
    return snap.docs.map((d) => {
        const data = d.data();
        return {
            role: data.role as ChatRole,
            content: typeof data.content === "string" ? data.content : "",
            seq: data.seq as number,
            ...(data.status ? { status: data.status as MessageStatus } : {}),
        };
    });
}

// The history sent to the model: the transcript minus failed answers, which
// have no text. A stopped answer stays — its partial text is what the user saw.
export async function readHistory(uid: string, conversationId: string): Promise<ChatMessage[]> {
    return (await readTranscript(uid, conversationId)).filter((m) => m.status !== "failed");
}

// Reserves two consecutive seqs (the user Message and its reply) and writes the
// user Message, in one transaction — so two tabs sending at once can't collide.
// Resolves to the user Message's seq; the reply goes at seq + 1.
export async function appendUserMessage(
    uid: string,
    conversationId: string,
    content: string
): Promise<number> {
    const conversation = conversationsCol(uid).doc(conversationId);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(conversation);
        const seq = (snap.get("nextSeq") as number | undefined) ?? 0;
        tx.update(conversation, { nextSeq: seq + 2, updatedAt: FieldValue.serverTimestamp() });
        tx.create(messagesCol(uid, conversationId).doc(), {
            role: "user",
            content,
            seq,
            createdAt: FieldValue.serverTimestamp(),
        });
        return seq;
    });
}

export async function appendAssistantMessage(
    uid: string,
    conversationId: string,
    seq: number,
    content: string,
    status: MessageStatus
): Promise<void> {
    await messagesCol(uid, conversationId).doc().set({
        role: "assistant",
        content,
        seq,
        status,
        createdAt: FieldValue.serverTimestamp(),
    });
}
