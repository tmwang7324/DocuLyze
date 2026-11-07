"use server";

import { listConversations, type ConversationSummary } from "@/_lib/conversations";
import { requireUid } from "@/_lib/data";

/** The signed-in user's Conversations, newest activity first — the sidebar's refresh. */
export async function listMyConversations(): Promise<ConversationSummary[]> {
    return listConversations(await requireUid());
}
