"use server";

import { z } from "zod";
import { deleteConversationTree } from "@/_lib/conversations";
import { requireUid } from "@/_lib/data";
import { logOperationalEvent, runWithRequestContext } from "@/_lib/operational_logger";

// Firestore-generated ids use this alphabet; rejecting path separators keeps the
// caller inside its own Conversations.
const Input = z.object({ conversationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });

export type DeleteConversationResult = { ok: true };

/**
 * Deletes one of the caller's Conversations and all its Messages. The uid comes
 * from the session cookie, never from the caller, so another user's id resolves
 * to "not found" in the caller's own namespace and nothing is touched.
 */
export async function deleteConversation(conversationId: string): Promise<DeleteConversationResult> {
    return runWithRequestContext(async () => {
        const startedAt = Date.now();
        logOperationalEvent("info", { operation: "deleteConversation", lifecycle: "started" });
        try {
            const uid = await requireUid();
            const input = Input.parse({ conversationId });
            if (!(await deleteConversationTree(uid, input.conversationId))) throw new Error("Conversation not found");
            logOperationalEvent("info", { operation: "deleteConversation", lifecycle: "succeeded", durationMs: Date.now() - startedAt });
            return { ok: true };
        } catch (error) {
            logOperationalEvent("error", {
                operation: "deleteConversation",
                lifecycle: "failed",
                durationMs: Date.now() - startedAt,
                reason: "delete_conversation_failed",
            });
            throw error;
        }
    });
}
