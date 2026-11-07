import type { Metadata } from "next";
import { requireUid } from "@/_lib/data";
import { listConversations, listReadyDocuments, readConversation, readTranscript } from "@/_lib/conversations";
import { resolveScope } from "@/_lib/scope";
import ChatView from "./chat_view";

export const metadata: Metadata = {
    title: "Chat — DocuLyze",
};

// `/chat` starts a new Conversation; `/chat?c=<id>` reopens one — the page reads the
// transcript from Firestore, so a reload shows exactly what was saved (complete,
// stopped or failed). `n` is only a nonce: "New chat" navigates to a fresh `n` so
// the view remounts empty even when the previous chat's URL was rewritten in place.
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string; n?: string }> }) {
    const uid = await requireUid();
    const { c, n } = await searchParams;
    const stored = c ? await readConversation(uid, c) : null;
    const conversationId = stored ? c! : null;
    const [transcript, conversations, library] = await Promise.all([
        conversationId ? readTranscript(uid, conversationId) : Promise.resolve([]),
        listConversations(uid),
        listReadyDocuments(uid),
    ]);
    const { documents, widened } = resolveScope(stored?.scope, library);
    const pinned = !!stored?.scope.length && !widened;

    return (
        <ChatView
            key={conversationId ?? `new-${n ?? ""}`}
            conversationId={conversationId}
            initialMessages={transcript.map(({ role, content, status, sources, plan, answerMode, route }) => ({ role, content, status, sources, plan, answerMode, route }))}
            initialAnswerMode={stored?.answerMode ?? "grounded"}
            initialConversations={conversations}
            library={library}
            initialScope={{ names: pinned ? documents.map((d) => d.file_name) : null, widened }}
        />
    );
}
