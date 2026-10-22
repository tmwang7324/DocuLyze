"""The tenant gateway over Qdrant Cloud (issue #29) — "one place, can't drift".

All vector-store access flows through write/get/query_user_chunks, and each
injects the caller's tenant filter itself: no call site ever passes a filter, so
none can forget one and read or write across users.

Each chunk is stored with a dense vector (Voyage) and a sparse BM25 vector
(fastembed); queries fuse both with RRF. Writes are delete-then-upsert on
(userId, docId) so a replayed job replaces its document's vectors instead of
duplicating them. Every chunk records the embedding pin.
"""

import logging
import uuid

from retrieval.config import embedding_dim, embedding_model, qdrant_api_key, qdrant_url

log = logging.getLogger("retrieval")

COLLECTION = "chunks"
EMBED_BATCH = 128  # Voyage's per-request text cap
UPSERT_BATCH = 64
TIMEOUT_S = 30

q_client = None


def qdrant_client():
    """Connect to Qdrant Cloud exactly once, ensure the collection, return the client."""
    global q_client
    if q_client is None:
        from qdrant_client import QdrantClient

        client = QdrantClient(
            url=qdrant_url(), api_key=qdrant_api_key(), prefer_grpc=True, timeout=TIMEOUT_S
        )
        _ensure_collection(client)
        q_client = client
        log.info("qdrant client connected: url=%s", qdrant_url())
    return q_client


def _ensure_collection(client) -> None:
    from qdrant_client.models import (
        Distance,
        Modifier,
        PayloadSchemaType,
        SparseVectorParams,
        VectorParams,
    )

    if not client.collection_exists(COLLECTION):
        client.create_collection(
            collection_name=COLLECTION,
            vectors_config={"dense": VectorParams(size=embedding_dim(), distance=Distance.COSINE)},
            # fastembed's BM25 only supplies term frequency; the server applies IDF.
            sparse_vectors_config={"sparse": SparseVectorParams(modifier=Modifier.IDF)},
        )
    # Qdrant Cloud rejects filtering on unindexed payload fields in strict mode
    # and scans otherwise; index the two tenant keys (idempotent).
    for field in ("userId", "docId"):
        client.create_payload_index(COLLECTION, field, PayloadSchemaType.KEYWORD)


def _point_id(uid: str, doc_id: str, idx: int) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{uid}/{doc_id}/{idx}"))


def _tenant_filter(uid: str, doc_ids: list[str] | None = None):
    """userId always; docId narrows to "any of" doc_ids when given. The two AND,
    so a doc id belonging to another user can only ever shrink the result."""
    from qdrant_client.models import FieldCondition, Filter, MatchAny, MatchValue

    must = [FieldCondition(key="userId", match=MatchValue(value=uid))]
    if doc_ids is not None:
        must.append(FieldCondition(key="docId", match=MatchAny(any=list(doc_ids))))
    return Filter(must=must)


def write_user_chunks(client, embed_fn, sparse_embed_fn, uid: str, doc_id: str, chunks) -> None:
    """Replace this document's vectors with `chunks`, tenant-tagged."""
    from qdrant_client.models import FilterSelector, PointStruct

    client.delete(
        collection_name=COLLECTION,
        points_selector=FilterSelector(filter=_tenant_filter(uid, [doc_id])),
    )
    if not chunks:
        return

    contents = [c.content for c in chunks]
    dense: list = []
    for i in range(0, len(chunks), EMBED_BATCH):
        batch = slice(i, i + EMBED_BATCH)
        dense.extend(
            embed_fn(
                contents[batch],
                token_size=[c.tokens for c in chunks[batch]],
                input_type="document",
            )
        )
    sparse = sparse_embed_fn(contents, input_type="document")

    model = embedding_model()
    points = [
        PointStruct(
            id=_point_id(uid, doc_id, idx),
            vector={"dense": dense[idx], "sparse": sparse[idx]},
            payload={
                "userId": uid,
                "docId": doc_id,
                "chunk_index": idx,
                "token_count": c.tokens,
                "embedding_model": model,
                "breadcrumb": c.breadcrumb(),
                "content": c.content,
            },
        )
        for idx, c in enumerate(chunks)
    ]
    for i in range(0, len(points), UPSERT_BATCH):
        client.upsert(collection_name=COLLECTION, points=points[i : i + UPSERT_BATCH], wait=True)
    log.info("wrote %d chunks to qdrant for user=%s doc=%s", len(points), uid, doc_id)


def delete_user_chunks(client, uid: str, doc_id: str) -> None:
    """Delete one document's vectors, constrained by both tenant keys.

    Qdrant filter deletion is idempotent: a replay against an already-empty
    document succeeds. ``wait=True`` is required for the deletion worker—the
    Firestore tombstone must not disappear before Qdrant confirms cleanup.
    """
    from qdrant_client.models import FilterSelector

    client.delete(
        collection_name=COLLECTION,
        points_selector=FilterSelector(filter=_tenant_filter(uid, [doc_id])),
        wait=True,
    )
    log.info("deleted qdrant chunks for user=%s doc=%s", uid, doc_id)


def get_user_chunks(client, uid: str, doc_id: str):
    """Every stored chunk of one document — a filter read, no similarity."""
    out: list = []
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=COLLECTION,
            scroll_filter=_tenant_filter(uid, [doc_id]),
            with_payload=True,
            with_vectors=False,
            limit=256,
            offset=offset,
        )
        out.extend({"content": p.payload.get("content"), "metadata": p.payload} for p in points)
        if offset is None:
            return out


def query_user_chunks(
    client,
    embed_fn,
    sparse_embed_fn,
    uid: str,
    query_text: str,
    n_results: int = 5,
    doc_ids: list[str] | None = None,
):
    """Best chunks for `query_text` (dense + sparse, RRF-fused), scoped to this user
    and, if given, to any of `doc_ids` (a Conversation's Scope). None searches all
    of the user's chunks; an empty list searches nothing — widening an emptied
    Scope back to everything is the caller's decision, not the gateway's.
    `distance` is the RRF score: higher is better."""
    from qdrant_client.models import Fusion, FusionQuery, Prefetch

    if doc_ids is not None and not doc_ids:
        return []
    dense_q = embed_fn([query_text], input_type="query")[0]
    sparse_q = sparse_embed_fn([query_text], input_type="query")[0]
    tenant = _tenant_filter(uid, doc_ids)
    depth = max(n_results * 4, 20)
    result = client.query_points(
        collection_name=COLLECTION,
        # The tenant filter goes on each prefetch too: a top-level filter alone
        # would not constrain which candidates the prefetch stage picks.
        prefetch=[
            Prefetch(query=dense_q, using="dense", limit=depth, filter=tenant),
            Prefetch(query=sparse_q, using="sparse", limit=depth, filter=tenant),
        ],
        query=FusionQuery(fusion=Fusion.RRF),
        query_filter=tenant,
        limit=n_results,
        with_payload=True,
    )
    return [
        {"content": p.payload.get("content"), "metadata": p.payload, "distance": p.score}
        for p in result.points
    ]


# --- LEGACY (ChromaDB, kept for review, see ADR-0004) ---
# """The tenant gateway over ChromaDB (issue #29) — "one place, can't drift".
#
# All vector-store access flows through this function pair, and each half injects
# the caller's tenant filter itself: no call site ever passes a `where` clause, so
# none can forget one and read or write across users. This is the vector-store
# analogue of the single canonical storage-path formula.
#
# Writes are delete-then-add on (userId, docId) so a replayed job replaces its
# document's vectors instead of duplicating them. Every stored chunk records the
# embedding pin — changing the model is an explicit full re-embed migration.
# """
#
# import logging
#
# from ingest.config import chroma_host, chroma_port, embedding_model
#
# log = logging.getLogger("ingest")
#
# COLLECTION = "chunks"
#
# c_client = None
#
#
# def chroma_client():
#     """Connect to the Chroma server exactly once and return the client."""
#     global c_client
#     if c_client is None:
#         import chromadb
#
#         host, port = chroma_host(), chroma_port()
#         c_client = chromadb.HttpClient(host=host, port=port)
#         log.info("chroma client connected: host=%s port=%s", host, port)
#     return c_client
#
#
# def get_collection(client):
#     return client.get_or_create_collection(COLLECTION)
#
#
# def write_user_chunks(client, embed_fn, uid: str, doc_id: str, chunks: list[str]) -> None:
#     """Replace this document's vectors with `chunks`, tenant-tagged."""
#     coll = get_collection(client)
#     # Chroma requires $and for a multi-key where filter.
#     coll.delete(where={"$and": [{"userId": uid}, {"docId": doc_id}]})
#
#     contents = [c.content for c in chunks]
#     token_sizes = [c.tokens for c in chunks]
#     embeddings = embed_fn(contents, token_size=token_sizes, input_type="document")
#     print(f"sample created embedding {embeddings[0] if embeddings else None}")
#     model = embedding_model()
#     coll.add(
#         ids=[f"{uid}/{doc_id}/{idx}" for idx, _ in enumerate(chunks)],
#         embeddings=embeddings,
#         documents=contents,
#         metadatas=[
#             {
#                 "userId": uid,
#                 "docId": doc_id,
#                 "chunk_index": idx,
#                 "token_count": c.tokens,
#                 "embedding_model": model,
#                 # A flat string: c.metadata can hold lists, which Chroma rejects.
#                 "breadcrumb": c.breadcrumb(),
#             }
#             for idx, c in enumerate(chunks)
#         ],
#     )
#     log.info("wrote %d chunks to chroma for user=%s doc=%s", len(contents), uid, doc_id)
#
#
# def get_user_chunks(client, uid: str, doc_id: str):
#     """Every stored chunk of one document — a filter read, no similarity."""
#     res = get_collection(client).get(
#         where={"$and": [{"userId": uid}, {"docId": doc_id}]},
#         include=["documents", "metadatas"],
#     )
#     return [
#         {"content": content, "metadata": metadata}
#         for content, metadata in zip(res["documents"], res["metadatas"])
#     ]
#
#
# def query_user_chunks(
#     client, embed_fn, uid: str, query_text: str, n_results: int = 5, doc_id: str | None = None
# ):
#     """Nearest chunks for `query_text`, scoped to this user (and doc, if given)."""
#     coll = get_collection(client)
#     embeddings = embed_fn([query_text], input_type="query")
#     where = (
#         {"$and": [{"userId": uid}, {"docId": doc_id}]}
#         if doc_id is not None
#         else {"userId": uid}
#     )
#     res = coll.query(
#         query_embeddings=embeddings,
#         n_results=n_results,
#         where=where,
#         include=["documents", "metadatas", "distances"],
#     )
#     documents = res["documents"][0]
#     metadatas = res["metadatas"][0]
#     distances = res["distances"][0]
#     return [
#         {"content": content, "metadata": metadata, "distance": distance}
#         for content, metadata, distance in zip(documents, metadatas, distances)
#     ]
#
# --- END LEGACY ---
