import type { Metadata } from "next";
import { requireUid } from "@/_lib/data";
import { readAnswerMode, readTranscript } from "@/_lib/conversations";
import ChatView from "./chat_view";

export const metadata: Metadata = {
    title: "Chat — DocuLyze",
};

// The chat tracer (ticket 02). `/chat` starts a new Conversation; `/chat?c=<id>`
// reopens one — the page reads the transcript from Firestore, so a reload shows
// exactly what was saved (complete, stopped or failed).
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
    const uid = await requireUid();
    const { c } = await searchParams;
    const storedMode = c ? await readAnswerMode(uid, c) : null;
    const conversationId = storedMode ? c! : null;
    const transcript = conversationId ? await readTranscript(uid, conversationId) : [];

    return (
        <ChatView
            conversationId={conversationId}
            initialMessages={transcript.map(({ role, content, status, sources, plan, answerMode, route }) => ({ role, content, status, sources, plan, answerMode, route }))}
            initialAnswerMode={storedMode ?? "grounded"}
        />
    );
}
