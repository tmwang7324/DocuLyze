"use client";

import { useRef, useState } from "react";
import { createSseParser } from "@/_lib/chat_events";

type ViewMessage = {
    role: "user" | "assistant";
    content: string;
    status?: "complete" | "stopped" | "failed" | "streaming";
};

// Minimal chat: a message list and a chat bar. The question goes out as a POST
// and the answer streams back on the same response (fetch + reader — EventSource
// is GET-only). Stop aborts the fetch; the server saves what was shown.
export default function ChatView({
    conversationId: initialConversationId,
    initialMessages,
}: {
    conversationId: string | null;
    initialMessages: ViewMessage[];
}) {
    const [messages, setMessages] = useState<ViewMessage[]>(initialMessages);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const conversationId = useRef(initialConversationId);
    const abort = useRef<AbortController | null>(null);

    // Replace the last (assistant) message — the one currently streaming.
    const updateLast = (fn: (m: ViewMessage) => ViewMessage) =>
        setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

    async function send() {
        const question = input.trim();
        if (!question || streaming) return;
        setInput("");
        setStreaming(true);
        setMessages((prev) => [
            ...prev,
            { role: "user", content: question },
            { role: "assistant", content: "", status: "streaming" },
        ]);

        const controller = new AbortController();
        abort.current = controller;
        try {
            const res = await fetch("/api/awesome-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question, conversationId: conversationId.current ?? undefined }),
                signal: controller.signal,
            });
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

            const id = res.headers.get("X-Conversation-Id");
            if (id && id !== conversationId.current) {
                conversationId.current = id;
                window.history.replaceState(null, "", `/chat?c=${encodeURIComponent(id)}`);
            }

            const parse = createSseParser((event) => {
                if (event.type === "token") updateLast((m) => ({ ...m, content: m.content + event.text }));
                else if (event.type === "done") updateLast((m) => ({ ...m, status: "complete" }));
                else if (event.type === "error") updateLast((m) => ({ ...m, content: "", status: "failed" }));
            });
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                parse(decoder.decode(value, { stream: true }));
            }
            // Stream ended without done or error: treat as failed.
            updateLast((m) => (m.status === "streaming" ? { ...m, content: "", status: "failed" } : m));
        } catch {
            updateLast((m) =>
                controller.signal.aborted ? { ...m, status: "stopped" } : { ...m, content: "", status: "failed" }
            );
        } finally {
            abort.current = null;
            setStreaming(false);
        }
    }

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] max-w-3xl mx-auto px-4">
            <div className="flex-1 overflow-y-auto py-8 space-y-4">
                {messages.length === 0 && (
                    <p className="text-muted text-center mt-24">Ask a question about your documents.</p>
                )}
                {messages.map((m, i) => (
                    <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                        <div
                            className={
                                m.role === "user"
                                    ? "bg-dark text-off-white rounded-2xl px-4 py-2 max-w-[80%] whitespace-pre-wrap"
                                    : "bg-orange-pale text-dark rounded-2xl px-4 py-2 max-w-[80%] whitespace-pre-wrap"
                            }
                        >
                            {m.content || (m.status === "streaming" ? "…" : "")}
                            {m.status === "stopped" && (
                                <div className="text-xs text-muted mt-1">Stopped</div>
                            )}
                            {m.status === "failed" && (
                                <div className="text-xs text-error mt-1">Answer failed. Try again.</div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <form
                className="flex gap-2 py-4 border-t border-hairline"
                onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                }}
            >
                <input
                    className="flex-1 border border-hairline rounded-full px-4 py-2 outline-none focus:border-orange-primary"
                    placeholder="Ask about your documents…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={streaming}
                />
                {streaming ? (
                    <button
                        type="button"
                        className="rounded-full px-5 py-2 bg-dark text-off-white"
                        onClick={() => abort.current?.abort()}
                    >
                        Stop
                    </button>
                ) : (
                    <button
                        type="submit"
                        className="rounded-full px-5 py-2 bg-orange-primary text-white disabled:opacity-50"
                        disabled={!input.trim()}
                    >
                        Send
                    </button>
                )}
            </form>
        </div>
    );
}
