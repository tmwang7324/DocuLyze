// The chat stream's event contract and an incremental SSE parser for it.
//
// Neutral module: no "use client", no `server-only`. The route handler parses
// the chat service's stream with it, and the chat page parses the route's
// stream with it, so both ends of each hop agree on one framing.

export type ChatEvent =
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
