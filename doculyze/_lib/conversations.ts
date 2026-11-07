import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/_lib/admin";
import type { AnswerMode, RetrievalPlan, Route, Source } from "@/_lib/chat_events";
import { logOperationalEvent } from "@/_lib/operational_logger";
import type { ScopeDocument } from "@/_lib/scope";

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
    sources?: Source[]; // assistant Messages only, when anything was retrieved
    plan?: RetrievalPlan; // assistant Messages only
    // The mode and route in effect when this answer was generated. The mode can
    // change mid-Conversation, so the Message — not the Conversation — is the record.
    answerMode?: AnswerMode;
    route?: Route;
};

// What an assistant Message keeps besides its text.
export type ReplyExtras = { sources?: Source[]; plan?: RetrievalPlan; answerMode?: AnswerMode; route?: Route };

// A document a Turn may search, as the chat service needs it.
export type { ScopeDocument };

const TITLE_MAX = 80;

function conversationsCol(uid: string) {
    return db.collection("users").doc(uid).collection("conversations");
}

function messagesCol(uid: string, conversationId: string) {
    return conversationsCol(uid).doc(conversationId).collection("messages");
}

// A new, empty Conversation titled after its first question. The id is
// server-generated, never client-supplied.
//
// `scope` is the ids of the documents the Conversation is pinned to (chat ticket
// 08); absent means the whole library. The caller has already limited it to the
// user's own ready documents.
export async function createConversation(
    uid: string,
    firstQuestion: string,
    answerMode: AnswerMode = "grounded",
    scope: string[] = []
): Promise<string> {
    const ref = conversationsCol(uid).doc();
    await ref.set({
        title: firstQuestion.slice(0, TITLE_MAX),
        answerMode,
        ...(scope.length ? { scope } : {}),
        nextSeq: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
}

// The Conversation's answer mode, or null when it doesn't exist. A missing field
// (a Conversation from before the setting) means grounded — no migration.
export async function readAnswerMode(uid: string, conversationId: string): Promise<AnswerMode | null> {
    const snap = await conversationsCol(uid).doc(conversationId).get();
    if (!snap.exists) return null;
    return snap.get("answerMode") === "open" ? "open" : "grounded";
}

// What a Turn needs to know about its Conversation, or null when it doesn't exist.
// `scope` is the pinned document ids (empty = all); it is resolved against the
// user's ready documents at read time, so deleted documents drop out.
export async function readConversation(
    uid: string,
    conversationId: string
): Promise<{ answerMode: AnswerMode; scope: string[] } | null> {
    const snap = await conversationsCol(uid).doc(conversationId).get();
    if (!snap.exists) return null;
    const scope = snap.get("scope");
    return {
        answerMode: snap.get("answerMode") === "open" ? "open" : "grounded",
        scope: Array.isArray(scope) ? scope.filter((s): s is string => typeof s === "string") : [],
    };
}

export async function conversationExists(uid: string, conversationId: string): Promise<boolean> {
    return (await conversationsCol(uid).doc(conversationId).get()).exists;
}

// One row in the Conversation list.
export type ConversationSummary = { id: string; title: string; updatedAt: number };

const LIST_LIMIT = 50;

// The caller's Conversations, most recently active first. Every Message append
// bumps `updatedAt`, so a Conversation moves to the top when it's used.
export async function listConversations(uid: string): Promise<ConversationSummary[]> {
    const startedAt = Date.now();
    const snap = await conversationsCol(uid).orderBy("updatedAt", "desc").limit(LIST_LIMIT).get();
    const list = snap.docs.map((d) => ({
        id: d.id,
        title: (d.get("title") as string) || "Untitled conversation",
        updatedAt: (d.get("updatedAt") as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0,
    }));
    logOperationalEvent("info", { operation: "listConversations", lifecycle: "succeeded", durationMs: Date.now() - startedAt, count: list.length });
    return list;
}

// Removes the Conversation and its Messages: Firestore doesn't cascade to a
// subcollection, so the Messages are deleted explicitly. False if it didn't exist.
export async function deleteConversationTree(uid: string, conversationId: string): Promise<boolean> {
    const ref = conversationsCol(uid).doc(conversationId);
    if (!(await ref.get()).exists) return false;
    await db.recursiveDelete(ref);
    return true;
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
            ...(Array.isArray(data.sources) && data.sources.length ? { sources: data.sources as Source[] } : {}),
            ...(data.plan ? { plan: data.plan as RetrievalPlan } : {}),
            ...(data.answerMode ? { answerMode: data.answerMode as AnswerMode } : {}),
            ...(data.route ? { route: data.route as Route } : {}),
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
//
// `turnId` is an opaque id for this Turn, stored on the user Message and passed
// back with the reply. After an Edit or Retract the same seq can be reused by a
// different Turn, so the seq alone can't say whose reply a late write is.
export async function appendUserMessage(
    uid: string,
    conversationId: string,
    content: string,
    turnId?: string
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
            ...(turnId ? { turnId } : {}),
            createdAt: FieldValue.serverTimestamp(),
        });
        return seq;
    });
}

// Resolves to whether the reply was written. With a `turnId` the write only
// happens if the Turn's user Message (at seq - 1) still exists with that id: a
// Stopped or failed reply that lands after the user Edited or Retracted would
// otherwise reappear as an orphan, or attach to the Turn that replaced it.
export async function appendAssistantMessage(
    uid: string,
    conversationId: string,
    seq: number,
    content: string,
    status: MessageStatus,
    { sources = [], plan, answerMode, route, turnId }: ReplyExtras & { turnId?: string } = {}
): Promise<boolean> {
    const reply = messagesCol(uid, conversationId).doc();
    const data = {
        role: "assistant",
        content,
        seq,
        status,
        ...(sources.length ? { sources } : {}),
        ...(plan ? { plan } : {}),
        ...(answerMode ? { answerMode } : {}),
        ...(route ? { route } : {}),
        createdAt: FieldValue.serverTimestamp(),
    };
    if (!turnId) {
        await reply.set(data);
        return true;
    }
    return db.runTransaction(async (tx) => {
        const asked = await tx.get(messagesCol(uid, conversationId).where("seq", "==", seq - 1).limit(1));
        const question = asked.docs[0];
        if (!question || question.get("role") !== "user" || question.get("turnId") !== turnId) return false;
        tx.create(reply, data);
        return true;
    });
}

// A user Message's text, or null if there's no user Message at that seq (it was
// never written, it's an assistant reply, or it was already removed).
export async function readUserMessage(uid: string, conversationId: string, seq: number): Promise<string | null> {
    const snap = await messagesCol(uid, conversationId).where("seq", "==", seq).limit(1).get();
    const doc = snap.docs[0];
    if (!doc || doc.get("role") !== "user") return null;
    return typeof doc.get("content") === "string" ? doc.get("content") : "";
}

// Editing the first Message changes what the Conversation is about.
export async function setConversationTitle(uid: string, conversationId: string, firstQuestion: string): Promise<void> {
    await conversationsCol(uid).doc(conversationId).update({ title: firstQuestion.slice(0, TITLE_MAX) });
}

const BATCH_MAX = 400; // Firestore allows 500 writes per batch; leave headroom

// Edit and Retract both start here (ADR-0006: history is linear). Removes the
// Message at `fromSeq` and every later one, and rewinds the sequence so the next
// Turn lands at `fromSeq`. Deleted newest-first, with the sequence reset in the
// last batch: if a very long Conversation is interrupted midway, what survives
// is still an unbroken prefix and the sequence is never behind it.
export async function truncateFrom(uid: string, conversationId: string, fromSeq: number): Promise<void> {
    const conversation = conversationsCol(uid).doc(conversationId);
    const snap = await messagesCol(uid, conversationId).where("seq", ">=", fromSeq).orderBy("seq", "desc").get();
    const refs = snap.docs.map((d) => d.ref);
    for (let i = 0; ; i += BATCH_MAX) {
        const batch = db.batch();
        refs.slice(i, i + BATCH_MAX).forEach((ref) => batch.delete(ref));
        const last = i + BATCH_MAX >= refs.length;
        if (last) batch.update(conversation, { nextSeq: fromSeq, updatedAt: FieldValue.serverTimestamp() });
        await batch.commit();
        if (last) break;
    }
}

// The caller's ready documents — what a Turn may search. Only `ready` documents:
// anything still processing has no (or partial) chunks yet.
export async function listReadyDocuments(uid: string): Promise<ScopeDocument[]> {
    const snap = await db.collection("users").doc(uid).collection("documents").where("status", "==", "ready").get();
    return snap.docs.map((d) => ({
        doc_id: d.id,
        file_name: (d.get("title") as string) || (d.get("file_name") as string) || "Untitled document",
    }));
}

// Changes a Conversation's answer mode. `update` fails on a missing document, so
// this can never create one; the uid is explicit, so it can only reach the
// caller's own namespace.
export async function updateAnswerMode(uid: string, conversationId: string, answerMode: AnswerMode): Promise<void> {
    await conversationsCol(uid).doc(conversationId).update({
        answerMode,
        updatedAt: FieldValue.serverTimestamp(),
    });
}
