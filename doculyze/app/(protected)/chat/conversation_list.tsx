"use client";

import Link from "next/link";
import type { ConversationSummary } from "@/_lib/conversations";

// The left rail: every saved Conversation, newest activity first. Presentational —
// ChatView owns the list and the actions, so deleting or starting a chat can
// first stop a live stream.
export default function ConversationList({
    conversations,
    activeId,
    onNew,
    onDelete,
}: {
    conversations: ConversationSummary[];
    activeId: string | null;
    onNew: () => void;
    onDelete: (id: string) => void;
}) {
    return (
        <nav aria-label="Conversations" className="hidden md:flex w-64 shrink-0 flex-col border-r border-hairline bg-off-white">
            <div className="p-3 border-b border-hairline">
                <button
                    type="button"
                    className="w-full rounded-full px-4 py-2 bg-orange-primary text-white text-sm transition-all duration-150 hover:bg-orange-deep hover:shadow-md hover:-translate-y-px active:translate-y-0 active:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-primary"
                    onClick={onNew}
                >
                    + New chat
                </button>
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-1">
                {conversations.length === 0 && <li className="px-2 py-3 text-xs text-muted">No saved conversations yet.</li>}
                {conversations.map((c) => (
                    <li key={c.id} className="group flex items-center gap-1">
                        <Link
                            href={`/chat?c=${encodeURIComponent(c.id)}`}
                            aria-current={c.id === activeId ? "page" : undefined}
                            className={
                                "flex-1 min-w-0 truncate rounded-lg px-3 py-2 text-sm " +
                                (c.id === activeId ? "bg-orange-pale text-dark font-medium" : "text-dark hover:bg-hairline")
                            }
                            title={c.title}
                        >
                            {c.title}
                        </Link>
                        <button
                            type="button"
                            aria-label={`Delete conversation: ${c.title}`}
                            className="px-2 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-error"
                            onClick={() => onDelete(c.id)}
                        >
                            ×
                        </button>
                    </li>
                ))}
            </ul>
        </nav>
    );
}
