"use server";

import { z } from "zod";
import { ANSWER_MODES, type AnswerMode } from "@/_lib/chat_events";
import { updateAnswerMode } from "@/_lib/conversations";
import { requireUid } from "@/_lib/data";
import { logOperationalEvent, runWithRequestContext } from "@/_lib/operational_logger";

// Firestore-generated ids use this alphabet; rejecting path separators keeps the
// caller inside its own Conversations.
const Input = z.object({
    conversationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    answerMode: z.enum(ANSWER_MODES),
});

export type SetAnswerModeResult = { ok: true; answerMode: AnswerMode };

/**
 * The only writer of a Conversation's answer mode after creation. The uid comes
 * from the session cookie, never from the caller, so a tampered conversationId
 * can only ever reach the caller's own namespace.
 */
export async function setAnswerMode(conversationId: string, answerMode: AnswerMode): Promise<SetAnswerModeResult> {
    return runWithRequestContext(async () => {
        const startedAt = Date.now();
        logOperationalEvent("info", { operation: "setAnswerMode", lifecycle: "started", answerMode });
        try {
            const uid = await requireUid();
            const input = Input.parse({ conversationId, answerMode });
            await updateAnswerMode(uid, input.conversationId, input.answerMode);
            logOperationalEvent("info", {
                operation: "setAnswerMode",
                lifecycle: "succeeded",
                durationMs: Date.now() - startedAt,
                answerMode: input.answerMode,
            });
            return { ok: true, answerMode: input.answerMode };
        } catch (error) {
            logOperationalEvent("error", {
                operation: "setAnswerMode",
                lifecycle: "failed",
                durationMs: Date.now() - startedAt,
                reason: "set_answer_mode_failed",
            });
            throw error;
        }
    });
}
