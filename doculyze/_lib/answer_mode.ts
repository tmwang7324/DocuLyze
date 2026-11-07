import type { AnswerMode } from "@/_lib/chat_events";

// The label under an assistant answer, from the mode and route it was generated
// under (both stored on the Message). Grounded answers, and Messages from before
// the setting existed, carry none. `route` is a plain string: the router (Phase 2)
// adds routes this module shouldn't need recompiling for.
export function answerBadge({ answerMode, route }: { answerMode?: AnswerMode; route?: string }): string | null {
    if (answerMode !== "open") return null;
    return route === "out_of_scope" ? "General knowledge" : "May include general knowledge";
}
