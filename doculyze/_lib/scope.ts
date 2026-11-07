// A Conversation's Scope (chat ticket 08, CONTEXT.md): the documents a Turn may
// search. Pure — the caller supplies the user's ready documents, so a pinned id
// that isn't one of them (deleted, still processing, or someone else's) simply
// can't be in Scope. The tenant filter in the chat service is a second wall.

export type ScopeDocument = { doc_id: string; file_name: string };

export type ResolvedScope = {
    documents: ScopeDocument[];
    // True when documents were pinned but none of them is left, so the search
    // fell back to the whole library. The UI says so; it never searches zero.
    widened: boolean;
};

export function resolveScope(pinned: string[] | undefined, ready: ScopeDocument[]): ResolvedScope {
    if (!pinned?.length) return { documents: ready, widened: false };
    const wanted = new Set(pinned);
    const kept = ready.filter((d) => wanted.has(d.doc_id));
    if (kept.length) return { documents: kept, widened: false };
    return { documents: ready, widened: ready.length > 0 };
}
