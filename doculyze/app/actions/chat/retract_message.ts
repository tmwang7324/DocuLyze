"use server";

import { z } from "zod";
import { readUserMessage, truncateFrom } from "@/_lib/conversations";
import { requireUid } from "@/_lib/data";
import { logOperationalEvent, runWithRequestContext } from "@/_lib/operational_logger";

const Input = z.object({
    conversationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    seq: z.number().int().min(0),
});

export type RetractMessageResult = { ok: true };

/**
 * Retract: removes one of the caller's user Messages and everything after it, and
 * generates nothing. The client aborts any live stream first; a reply that still
 * lands afterwards is dropped by the Turn-id guard in appendAssistantMessage.
 */
export async function retractMessage(conversationId: string, seq: number): Promise<RetractMessageResult> {
    return runWithRequestContext(async () => {
        const startedAt = Date.now();
        logOperationalEvent("info", { operation: "retractMessage", lifecycle: "started", seq });
        try {
            const uid = await requireUid();
            const input = Input.parse({ conversationId, seq });
            // Only a user Message can be retracted, and it must exist in the caller's own Conversation.
            if ((await readUserMessage(uid, input.conversationId, input.seq)) === null) throw new Error("No such user message");
            await truncateFrom(uid, input.conversationId, input.seq);
            logOperationalEvent("info", { operation: "retractMessage", lifecycle: "succeeded", durationMs: Date.now() - startedAt, seq: input.seq });
            return { ok: true };
        } catch (error) {
            logOperationalEvent("error", {
                operation: "retractMessage",
                lifecycle: "failed",
                durationMs: Date.now() - startedAt,
                reason: "retract_message_failed",
            });
            throw error;
        }
    });
}
