// The chat stream's event contract and an incremental SSE parser for it.
//
// Neutral module: no "use client", no `server-only`. The route handler parses
// the chat service's stream with it, and the chat page parses the route's
// stream with it, so both ends of each hop agree on one framing.

// A numbered passage the answer may cite as [n]. Snapshotted on the assistant
// Message, so the citation outlives a re-ingest or delete of its document.
export type Source = { n: number; doc_id: string; file_name: string; section: string; text: string };

// What the Turn searched for (ticket 03): the standalone rewrite and 0–3
// Sub-queries. `degraded` means the planner or reranker fell back.
export type RetrievalPlan = { standalone: string; sub_queries: string[]; degraded: boolean };

// grounded: answers come only from the user's documents. open: the model may add
// general knowledge, clearly labelled. A per-Conversation setting owned by Next.
export const ANSWER_MODES = ["grounded", "open"] as const;
export type AnswerMode = (typeof ANSWER_MODES)[number];
// Phase 1 only ever routes to "retrieve"; the router adds the rest.
export type Route = "retrieve";

export type ChatEvent =
    | ({ type: "plan" } & RetrievalPlan)
    | { type: "meta"; route: Route; answerMode: AnswerMode }
    | { type: "sources"; sources: Source[] }
    | { type: "token"; text: string }
    | { type: "done" }
    | { type: "error"; message: string };

// Feed decoded text as it arrives; each complete `data:` frame is parsed and
// handed to onEvent. Comment frames (": keepalive") and malformed frames are
// skipped. Frames can split across network chunks, hence the buffer.
export function createSseParser(onEvent: (event: ChatEvent) => void): (text: string) => void {
    let buffer = "";
    return (text: string) => {
        buffer += text.replace(/\r\n/g, "\n");
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const data = frame
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n");
            if (!data) continue;
            try {
                onEvent(JSON.parse(data) as ChatEvent);
            } catch {
                // not JSON — not ours
            }
        }
    };
}

export function sseFrame(event: ChatEvent): string {
    return `data: ${JSON.stringify(event)}\n\n`;
}
