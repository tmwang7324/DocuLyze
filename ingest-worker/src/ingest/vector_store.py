"""The tenant gateway over ChromaDB (issue #29) — "one place, can't drift".

All vector-store access flows through this function pair, and each half injects
the caller's tenant filter itself: no call site ever passes a `where` clause, so
none can forget one and read or write across users. This is the vector-store
analogue of the single canonical storage-path formula.

Writes are delete-then-add on (userId, docId) so a replayed job replaces its
document's vectors instead of duplicating them. Every stored chunk records the
embedding pin — changing the model is an explicit full re-embed migration.
"""

import logging

from ingest.config import chroma_host, chroma_port, embedding_model

log = logging.getLogger("ingest")

COLLECTION = "chunks"

_client = None


def chroma_client():
    """Connect to the Chroma server exactly once and return the client."""
    global _client
    if _client is None:
        import chromadb

        host, port = chroma_host(), chroma_port()
        _client = chromadb.HttpClient(host=host, port=port)
        log.info("chroma client connected: host=%s port=%s", host, port)
    return _client


def _collection(client):
    return client.get_or_create_collection(COLLECTION)


def write_user_chunks(client, embed_fn, uid: str, doc_id: str, chunks) -> None:
    """Replace this document's vectors with `chunks`, tenant-tagged."""
    coll = _collection(client)
    # Chroma requires $and for a multi-key where filter.
    coll.delete(where={"$and": [{"userId": uid}, {"docId": doc_id}]})

    contents = [c.content for c in chunks]
    embeddings = embed_fn(contents, input_type="document")
    model = embedding_model()
    coll.add(
        ids=[f"{uid}/{doc_id}/{idx}" for idx, _ in enumerate(chunks)],
        embeddings=embeddings,
        documents=contents,
        metadatas=[
            {
                "userId": uid,
                "docId": doc_id,
                "chunk_index": idx,
                "token_count": c.tokens,
                "embedding_model": model,
                # A flat string: c.metadata can hold lists, which Chroma rejects.
                "breadcrumb": c.breadcrumb(),
            }
            for idx, c in enumerate(chunks)
        ],
    )
    log.info("wrote %d chunks to chroma for user=%s doc=%s", len(contents), uid, doc_id)


def get_user_chunks(client, uid: str, doc_id: str):
    """Every stored chunk of one document — a filter read, no similarity."""
    res = _collection(client).get(
        where={"$and": [{"userId": uid}, {"docId": doc_id}]},
        include=["documents", "metadatas"],
    )
    return [
        {"content": content, "metadata": metadata}
        for content, metadata in zip(res["documents"], res["metadatas"])
    ]


def query_user_chunks(
    client, embed_fn, uid: str, query_text: str, n_results: int = 5, doc_id: str | None = None
):
    """Nearest chunks for `query_text`, scoped to this user (and doc, if given)."""
    coll = _collection(client)
    embeddings = embed_fn([query_text], input_type="query")
    where = (
        {"$and": [{"userId": uid}, {"docId": doc_id}]}
        if doc_id is not None
        else {"userId": uid}
    )
    res = coll.query(
        query_embeddings=embeddings,
        n_results=n_results,
        where=where,
        include=["documents", "metadatas", "distances"],
    )
    documents = res["documents"][0]
    metadatas = res["metadatas"][0]
    distances = res["distances"][0]
    return [
        {"content": content, "metadata": metadata, "distance": distance}
        for content, metadata, distance in zip(documents, metadatas, distances)
    ]
