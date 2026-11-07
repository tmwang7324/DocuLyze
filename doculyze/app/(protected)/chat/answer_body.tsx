"use client";

import type { Source } from "@/_lib/chat_events";
import { citedNumbers, splitCitations } from "@/_lib/citations";

// An assistant answer with its citations (chat ticket 04). Each [n] renders as a
// chip the moment it streams in, because the Sources arrive before the tokens.
// Clicking a chip asks the chat page to show the snapshotted passage in its
// right sidebar — never the raw document, and never inline in the conversation.
export default function AnswerBody({
    content,
    sources,
    openN,
    onToggle,
}: {
    content: string;
    sources: Source[];
    openN: number | null;
    onToggle: (n: number) => void;
}) {
    const cited = citedNumbers(content, sources.length);
    const uncited = sources.filter((s) => !cited.has(s.n));

    const chip = (s: Source, dim = false) => (
        <button
            key={`chip-${s.n}`}
            type="button"
            onClick={() => onToggle(s.n)}
            aria-expanded={openN === s.n}
            aria-label={`Source ${s.n}: ${s.file_name}`}
            className={`inline-flex items-center justify-center min-w-5 h-5 px-1 mx-0.5 align-text-top rounded-full text-[11px] font-semibold ${
                dim ? "bg-hairline text-muted" : "bg-orange-primary text-white"
            } ${openN === s.n ? "ring-2 ring-dark" : ""}`}
        >
            {s.n}
        </button>
    );

    return (
        <>
            {splitCitations(content, sources.length).map((seg, i) =>
                seg.kind === "text" ? <span key={i}>{seg.text}</span> : chip(sources[seg.n - 1])
            )}
            {uncited.length > 0 && content && (
                <div className="mt-2 text-xs text-muted opacity-70">
                    Also searched: {uncited.map((s) => chip(s, true))}
                </div>
            )}
        </>
    );
}
