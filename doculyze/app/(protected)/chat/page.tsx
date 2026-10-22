import type { Metadata } from "next";
import { requireUid } from "@/_lib/data";
import { conversationExists, readTranscript } from "@/_lib/conversations";
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
    const conversationId = c && (await conversationExists(uid, c)) ? c : null;
    const transcript = conversationId ? await readTranscript(uid, conversationId) : [];

    return (
        <ChatView
            conversationId={conversationId}
            initialMessages={transcript.map(({ role, content, status }) => ({ role, content, status }))}
        />
    );
}
