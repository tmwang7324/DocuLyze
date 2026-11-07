import type { Source } from "@/_lib/chat_events";

// Inline citations (chat ticket 04): the model writes [n] after a claim, where n
// numbers a Source sent before the tokens. Neutral module — used by the chat page.

export type Segment = { kind: "text"; text: string } | { kind: "cite"; n: number };

const MARKER = /\[(\d{1,3})\]/g;

// Split answer text into plain text and citation segments. A number with no
// matching Source (out of range) stays as literal text rather than a dead chip.
export function splitCitations(text: string, sourceCount: number): Segment[] {
    const out: Segment[] = [];
    let last = 0;
    const pushText = (t: string) => {
        if (!t) return;
        const prev = out[out.length - 1];
        if (prev?.kind === "text") prev.text += t;
        else out.push({ kind: "text", text: t });
    };
    for (const m of text.matchAll(MARKER)) {
        const n = Number(m[1]);
        pushText(text.slice(last, m.index));
        if (n >= 1 && n <= sourceCount) out.push({ kind: "cite", n });
        else pushText(m[0]);
        last = m.index! + m[0].length;
    }
    pushText(text.slice(last));
    return out;
}

export function citedNumbers(text: string, sourceCount: number): Set<number> {
    const cited = new Set<number>();
    for (const s of splitCitations(text, sourceCount)) if (s.kind === "cite") cited.add(s.n);
    return cited;
}

// Which chip is open: the message it sits in (source numbers repeat across
// messages) and its number. The sidebar renders whatever this resolves to.
export type OpenCitation = { messageIndex: number; n: number };

export function resolveOpenSource(
    messages: { sources?: Source[] }[],
    open: OpenCitation | null
): Source | null {
    if (!open) return null;
    return messages[open.messageIndex]?.sources?.find((s) => s.n === open.n) ?? null;
}
