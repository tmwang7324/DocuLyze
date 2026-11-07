"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSseParser, type AnswerMode, type RetrievalPlan, type Source } from "@/_lib/chat_events";
import { answerBadge } from "@/_lib/answer_mode";
import { setAnswerMode } from "@/app/actions/chat/set_answer_mode";
import { deleteConversation } from "@/app/actions/chat/delete_conversation";
import { listMyConversations } from "@/app/actions/chat/list_conversations";
import { retractMessage } from "@/app/actions/chat/retract_message";
import { resolveOpenSource, type OpenCitation } from "@/_lib/citations";
import type { ConversationSummary } from "@/_lib/conversations";
import type { ScopeDocument } from "@/_lib/scope";
import AnswerBody from "./answer_body";
import ConversationList from "./conversation_list";

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

// `names` is the pinned documents' file names, or null when the Conversation
// searches everything. `widened`: it was pinned, but every pinned document is gone.
export type ScopeInfo = { names: string[] | null; widened: boolean };

// Scope pinning (chat ticket 08) is archived until after the demo: the picker is
// hidden, but the route, the stored `scope` field and the tests all stay. Flip this
// to bring the picker back — nothing else needs to change.
const SCOPE_PINNING_ENABLED = false;

// A message's seq is its index in the list: a Conversation's Messages are written
// as contiguous user/assistant pairs from 0, and Edit/Retract rewind to a seq.
// The server re-checks that the seq is one of the caller's own user Messages.

// Minimal chat: a message list and a chat bar. The question goes out as a POST
// and the answer streams back on the same response (fetch + reader — EventSource
// is GET-only). Stop aborts the fetch; the server saves what was shown.
export default function ChatView({
    conversationId: initialConversationId,
    initialMessages,
    initialAnswerMode,
    initialConversations,
    library,
    initialScope,
}: {
    conversationId: string | null;
    initialMessages: ViewMessage[];
    initialAnswerMode: AnswerMode;
    initialConversations: ConversationSummary[];
    library: ScopeDocument[];
    initialScope: ScopeInfo;
}) {
    const router = useRouter();
    const [answerMode, setMode] = useState<AnswerMode>(initialAnswerMode);
    const [modeError, setModeError] = useState<string | null>(null);
    const [messages, setMessages] = useState<ViewMessage[]>(initialMessages);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [health, setHealth] = useState<"checking" | "available" | "unavailable">("checking");
    const [openCitation, setOpenCitation] = useState<OpenCitation | null>(null);
    const [conversations, setConversations] = useState(initialConversations);
    const [activeId, setActiveId] = useState(initialConversationId);
    const [scope, setScope] = useState(initialScope);
    const [picked, setPicked] = useState<Set<string>>(new Set()); // documents chosen for a NEW Conversation
    const [choosing, setChoosing] = useState(false);
    const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const openSource = resolveOpenSource(messages, openCitation);
    const conversationId = useRef(initialConversationId);
    const abort = useRef<AbortController | null>(null);
    const inflight = useRef<Promise<void> | null>(null);

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

    const refreshConversations = useCallback(async () => {
        try {
            setConversations(await listMyConversations());
        } catch (error) {
            console.error("[chat] Failed to refresh the conversation list", error);
        }
    }, []);

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

    // One Turn: a new question, or (with editSeq) a replacement for the user Message
    // at that seq and everything after it — which is also what Regenerate is.
    async function runTurn(question: string, editSeq?: number) {
        let finished!: () => void;
        inflight.current = new Promise<void>((resolve) => (finished = resolve));
        const firstTurn = !conversationId.current;
        setActionError(null);
        setStreaming(true);
        setMessages((prev) => [
            ...(editSeq === undefined ? prev : prev.slice(0, editSeq)),
            { role: "user", content: question },
            { role: "assistant", content: "", status: "streaming" },
        ]);

        const controller = new AbortController();
        abort.current = controller;
        try {
            const res = await fetch("/api/awesome-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    question,
                    conversationId: conversationId.current ?? undefined,
                    answerMode,
                    ...(editSeq === undefined ? {} : { editSeq }),
                    ...(firstTurn && picked.size ? { scope: [...picked] } : {}),
                }),
                signal: controller.signal,
            });
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

            const id = res.headers.get("X-Conversation-Id");
            if (id && id !== conversationId.current) {
                conversationId.current = id;
                setActiveId(id);
                window.history.replaceState(null, "", `/chat?c=${encodeURIComponent(id)}`);
                // The Scope was fixed when the Conversation was created.
                const names = library.filter((d) => picked.has(d.doc_id)).map((d) => d.file_name);
                setScope({ names: names.length ? names : null, widened: false });
                setChoosing(false);
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
            inflight.current = null;
            setStreaming(false);
            finished();
            void refreshConversations(); // the title / order may have changed
        }
    }

    async function send() {
        const question = input.trim();
        if (!question || streaming || health !== "available") return;
        setInput("");
        await runTurn(question);
    }

    // Edit, Retract and delete all discard Messages, so a live stream is aborted and
    // allowed to settle first. A reply that still lands afterwards is dropped by the
    // server (it no longer matches a Turn in the Conversation).
    async function interrupt() {
        const pending = inflight.current;
        if (!pending) return;
        abort.current?.abort();
        await pending;
    }

    async function submitEdit(index: number, text: string) {
        const question = text.trim();
        if (!question || health !== "available") return;
        setEditing(null);
        await interrupt();
        await runTurn(question, index);
    }

    async function retract(index: number) {
        if (!conversationId.current) return;
        await interrupt();
        try {
            await retractMessage(conversationId.current, index);
            setMessages((prev) => prev.slice(0, index));
            setOpenCitation(null);
            void refreshConversations();
        } catch (error) {
            console.error("[chat] Failed to retract a message", error);
            setActionError("Couldn't retract that message. Try again.");
        }
    }

    // Regenerate is an Edit with the same text.
    async function regenerate(assistantIndex: number) {
        const question = messages[assistantIndex - 1]?.content;
        if (!question || health !== "available") return;
        await interrupt();
        await runTurn(question, assistantIndex - 1);
    }

    async function startNewChat() {
        await interrupt();
        router.push(`/chat?n=${Date.now()}`);
    }

    async function removeConversation(id: string) {
        if (!window.confirm("Delete this conversation? This can't be undone.")) return;
        if (id === conversationId.current) await interrupt();
        try {
            await deleteConversation(id);
            setConversations((prev) => prev.filter((c) => c.id !== id));
            if (id === conversationId.current) router.push(`/chat?n=${Date.now()}`);
        } catch (error) {
            console.error("[chat] Failed to delete a conversation", error);
            setActionError("Couldn't delete that conversation. Try again.");
        }
    }

    function togglePicked(docId: string) {
        setPicked((prev) => {
            const next = new Set(prev);
            if (!next.delete(docId)) next.add(docId);
            return next;
        });
    }

    const scopeText = scope.names ? `Searching: ${scope.names.join(", ")}` : "Searching: all documents";

    return (
        <div className="flex h-[calc(100vh-4rem)]">
        <ConversationList conversations={conversations} activeId={activeId} onNew={() => void startNewChat()} onDelete={(id) => void removeConversation(id)} />
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
                <span className="text-muted text-right">
                    {modeError ?? (answerMode === "open" ? "Mode: documents + general knowledge" : "Mode: documents only")}
                </span>
            </div>
            {activeId && (scope.names || scope.widened || SCOPE_PINNING_ENABLED) && (
                <div className="py-1.5 text-xs text-muted border-b border-hairline">
                    {scopeText}
                    {scope.widened && " — the documents this chat was pinned to were deleted, so it searches all documents."}
                </div>
            )}
            {actionError && <div role="alert" className="py-1.5 text-xs text-error">{actionError}</div>}
            <div className="flex-1 overflow-y-auto py-8 space-y-4">
                {messages.length === 0 && (
                    <div className="text-center mt-24 space-y-4">
                        <p className="text-muted">Ask a question about your documents.</p>
                        {/* The Scope is fixed when a Conversation is created, so only a new one offers the choice. */}
                        {SCOPE_PINNING_ENABLED && !activeId && library.length > 0 && (
                            <div className="inline-block text-left text-sm">
                                <div className="flex items-center gap-4 justify-center">
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input type="radio" name="scope" checked={!choosing} onChange={() => { setChoosing(false); setPicked(new Set()); }} />
                                        All documents
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input type="radio" name="scope" checked={choosing} onChange={() => setChoosing(true)} />
                                        Choose documents
                                    </label>
                                </div>
                                {choosing && (
                                    <ul aria-label="Documents to search" className="mt-3 max-h-48 overflow-y-auto space-y-1 border border-hairline rounded-lg p-3">
                                        {library.map((d) => (
                                            <li key={d.doc_id}>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox" checked={picked.has(d.doc_id)} onChange={() => togglePicked(d.doc_id)} />
                                                    {d.file_name}
                                                </label>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {messages.map((m, i) => (
                    <div key={i} className={m.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"}>
                        {m.role === "user" && editing?.index === i ? (
                            <form
                                className="w-full max-w-[80%] space-y-2"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    void submitEdit(i, editing.text);
                                }}
                            >
                                <textarea
                                    aria-label="Edit message"
                                    className="w-full border border-hairline rounded-2xl px-4 py-2 outline-none focus:border-orange-primary"
                                    rows={3}
                                    value={editing.text}
                                    onChange={(e) => setEditing({ index: i, text: e.target.value })}
                                    autoFocus
                                />
                                <div className="flex justify-end gap-2 text-sm">
                                    <button type="button" className="px-3 py-1 text-muted" onClick={() => setEditing(null)}>Cancel</button>
                                    <button type="submit" className="rounded-full px-4 py-1 bg-orange-primary text-white disabled:opacity-50" disabled={!editing.text.trim() || health !== "available"}>
                                        Save & resend
                                    </button>
                                </div>
                            </form>
                        ) : (
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
                                <div className="text-xs text-error mt-1">
                                    {m.error || "Answer failed."}
                                    {activeId && messages[i - 1]?.role === "user" && (
                                        <>
                                            {" — "}
                                            <button type="button" className="underline" disabled={health !== "available"} onClick={() => void regenerate(i)}>
                                                Regenerate
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                        )}
                        {m.role === "user" && activeId && editing?.index !== i && (
                            <div className="mt-1 flex gap-3 text-xs text-muted">
                                <button type="button" className="hover:text-dark" onClick={() => setEditing({ index: i, text: m.content })}>Edit</button>
                                <button type="button" className="hover:text-error" onClick={() => void retract(i)}>Retract</button>
                            </div>
                        )}
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
