"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSseParser, type AnswerMode, type RetrievalPlan, type Source } from "@/_lib/chat_events";
import { answerBadge } from "@/_lib/answer_mode";
import { setAnswerMode } from "@/app/actions/chat/set_answer_mode";
import { resolveOpenSource, type OpenCitation } from "@/_lib/citations";
import AnswerBody from "./answer_body";

type ViewMessage = {
    role: "user" | "assistant";
    content: string;
    status?: "complete" | "stopped" | "failed" | "streaming";
    error?: string;
    sources?: Source[];
    plan?: RetrievalPlan;
    answerMode?: AnswerMode;
    route?: string;
};

// Minimal chat: a message list and a chat bar. The question goes out as a POST
// and the answer streams back on the same response (fetch + reader — EventSource
// is GET-only). Stop aborts the fetch; the server saves what was shown.
export default function ChatView({
    conversationId: initialConversationId,
    initialMessages,
    initialAnswerMode,
}: {
    conversationId: string | null;
    initialMessages: ViewMessage[];
    initialAnswerMode: AnswerMode;
}) {
    const [answerMode, setMode] = useState<AnswerMode>(initialAnswerMode);
    const [modeError, setModeError] = useState<string | null>(null);
    const [messages, setMessages] = useState<ViewMessage[]>(initialMessages);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [health, setHealth] = useState<"checking" | "available" | "unavailable">("checking");
    const [openCitation, setOpenCitation] = useState<OpenCitation | null>(null);
    const openSource = resolveOpenSource(messages, openCitation);
    const conversationId = useRef(initialConversationId);
    const abort = useRef<AbortController | null>(null);

    const checkHealth = useCallback(async () => {
        setHealth("checking");
        try {
            const res = await fetch("/api/awesome-chat", { cache: "no-store" });
            if (!res.ok) throw new Error(`Health check returned HTTP ${res.status}`);
            setHealth("available");
            console.info("[chat] Chat service is available");
        } catch (error) {
            console.error("[chat] Chat service health check failed", error);
            setHealth("unavailable");
        }
    }, []);

    useEffect(() => { void checkHealth(); }, [checkHealth]);

    // Replace the last (assistant) message — the one currently streaming.
    const updateLast = (fn: (m: ViewMessage) => ViewMessage) =>
        setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

    // Before the first message there is no Conversation to update: the choice just
    // rides along with the first POST. After that, the server action owns it.
    async function toggleMode(open: boolean) {
        const next: AnswerMode = open ? "open" : "grounded";
        const previous = answerMode;
        setMode(next);
        setModeError(null);
        if (!conversationId.current) return;
        try {
            await setAnswerMode(conversationId.current, next);
        } catch (error) {
            console.error("[chat] Failed to change the answer mode", error);
            setMode(previous);
            setModeError("Couldn't change the answer mode. Try again.");
        }
    }

    async function send() {
        const question = input.trim();
        if (!question || streaming || health !== "available") return;
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
                body: JSON.stringify({ question, conversationId: conversationId.current ?? undefined, answerMode }),
                signal: controller.signal,
            });
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

            const id = res.headers.get("X-Conversation-Id");
            if (id && id !== conversationId.current) {
                conversationId.current = id;
                window.history.replaceState(null, "", `/chat?c=${encodeURIComponent(id)}`);
            }

            const parse = createSseParser((event) => {
                if (event.type === "meta") updateLast((m) => ({ ...m, answerMode: event.answerMode, route: event.route }));
                else if (event.type === "plan")
                    updateLast((m) => ({ ...m, plan: { standalone: event.standalone, sub_queries: event.sub_queries, degraded: event.degraded } }));
                else if (event.type === "sources") updateLast((m) => ({ ...m, sources: event.sources }));
                else if (event.type === "token") updateLast((m) => ({ ...m, content: m.content + event.text }));
                else if (event.type === "done") updateLast((m) => ({ ...m, status: "complete" }));
                else if (event.type === "error") {
                    console.error("[chat] Stream error:", event.message);
                    updateLast((m) => ({ ...m, status: "failed", error: event.message }));
                }
            });
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                parse(decoder.decode(value, { stream: true }));
            }
            // Stream ended without done or error: treat as failed.
            updateLast((m) => (m.status === "streaming" ? { ...m, status: "failed", error: "The response ended before completion." } : m));
        } catch (error) {
            if (!controller.signal.aborted) console.error("[chat] Request failed", error);
            updateLast((m) =>
                controller.signal.aborted ? { ...m, status: "stopped" } : { ...m, status: "failed", error: "The chat request failed. Check the browser console." }
            );
        } finally {
            abort.current = null;
            setStreaming(false);
        }
    }

    return (
        <div className="flex h-[calc(100vh-4rem)]">
        <div className="flex flex-col flex-1 min-w-0 max-w-3xl mx-auto px-4">
            <div className="flex items-center justify-between gap-3 py-3 border-b border-hairline text-sm">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={answerMode === "open"}
                        disabled={streaming}
                        onChange={(e) => void toggleMode(e.target.checked)}
                    />
                    Allow general knowledge
                </label>
                <span className="text-muted">
                    {modeError ?? (answerMode === "open" ? "Mode: documents + general knowledge" : "Mode: documents only")}
                </span>
            </div>
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
                            {m.role === "assistant" && m.plan && (
                                <details className="mb-2 text-xs text-muted">
                                    <summary className="cursor-pointer select-none">
                                        {m.plan.sub_queries.length
                                            ? `Searched for: ${m.plan.sub_queries.join(" · ")}`
                                            : "No document search needed"}
                                    </summary>
                                    <div className="mt-1 pl-3">
                                        Understood as: {m.plan.standalone}
                                        {m.plan.degraded && <div className="mt-1">Search planning fell back to a simpler mode for this answer.</div>}
                                    </div>
                                </details>
                            )}
                            {m.role === "assistant" && m.content ? (
                                <AnswerBody
                                    content={m.content}
                                    sources={m.sources ?? []}
                                    openN={openCitation?.messageIndex === i ? openCitation.n : null}
                                    onToggle={(n) => setOpenCitation(openCitation?.messageIndex === i && openCitation.n === n ? null : { messageIndex: i, n })}
                                />
                            ) : m.content || (m.status === "streaming" ? (
                                <span role="status" aria-label="Waiting for answer" className="inline-flex gap-1 items-center h-5 text-orange-primary">
                                    {[0, 150, 300].map((delay) => (
                                        <span key={delay} className="chat-float-dot" style={{ animationDelay: `${delay}ms` }} />
                                    ))}
                                </span>
                            ) : "")}
                            {m.role === "assistant" && m.content && answerBadge(m) && (
                                <div className="mt-2 inline-block rounded-full bg-hairline px-2 py-0.5 text-[11px] font-medium text-muted">
                                    {answerBadge(m)}
                                </div>
                            )}
                            {m.status === "stopped" && (
                                <div className="text-xs text-muted mt-1">Stopped</div>
                            )}
                            {m.status === "failed" && (
                                <div className="text-xs text-error mt-1">{m.error || "Answer failed. Try again."}</div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {health !== "available" && (
                <div role="status" className="text-sm text-muted py-2">
                    {health === "checking" ? "Checking chat service…" : (
                        <>Chat service unavailable. <button type="button" className="underline" onClick={() => void checkHealth()}>Retry</button></>
                    )}
                </div>
            )}
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
                        disabled={!input.trim() || health !== "available"}
                    >
                        Send
                    </button>
                )}
            </form>
        </div>
        {openSource && (
            <aside aria-label={`Source ${openSource.n}`} className="w-96 shrink-0 border-l border-hairline bg-off-white p-5 overflow-y-auto">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <div className="font-semibold text-dark">[{openSource.n}] {openSource.file_name}</div>
                        {openSource.section && <div className="text-xs text-muted mt-0.5">{openSource.section}</div>}
                    </div>
                    <button type="button" aria-label="Close source" className="text-muted hover:text-dark text-lg leading-none" onClick={() => setOpenCitation(null)}>×</button>
                </div>
                <div className="mt-4 text-sm text-dark whitespace-pre-wrap">{openSource.text}</div>
            </aside>
        )}
        </div>
    );
}