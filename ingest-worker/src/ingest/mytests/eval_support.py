"""Qdrant + metric helpers shared by the eval scripts (test_reranker, test_uda_eval).

Points are stored the way the production gateway (ingest.vector_store) stores
them, a dense Voyage vector plus a sparse BM25 vector per chunk, so retrieval can
run dense-only or hybrid (RRF). Unlike the gateway, the collection is a
parameter: eval corpora must never land in the production "chunks" collection.
"""

import uuid

from dotenv import load_dotenv

from ingest.config import (
    embedding_dim,
    embedding_model,
    qdrant_api_key,
    qdrant_url,
    voyage_api_key,
)

load_dotenv()  # QDRANT_URL / QDRANT_API_KEY / VOYAGE_API_KEY from DocuLyze/.env (repo root)

TIMEOUT_S = 60
UPSERT_BATCH = 64
HYBRID_PREFETCH_MIN = 20


# ---------------------------------------------------------------------------
# Connection + collection
# ---------------------------------------------------------------------------
def connect():
    from qdrant_client import QdrantClient

    return QdrantClient(
        url=qdrant_url(), api_key=qdrant_api_key(), prefer_grpc=True, timeout=TIMEOUT_S
    )


def recreate_collection(client, name: str, keyword_fields=("userId", "docId")) -> None:
    """Drop and recreate `name` with dense + sparse vectors and keyword indexes."""
    from qdrant_client.models import (
        Distance,
        Modifier,
        PayloadSchemaType,
        SparseVectorParams,
        VectorParams,
    )

    if client.collection_exists(name):
        client.delete_collection(name)
    client.create_collection(
        collection_name=name,
        vectors_config={"dense": VectorParams(size=embedding_dim(), distance=Distance.COSINE)},
        # fastembed's BM25 only supplies term frequency; the server applies IDF.
        sparse_vectors_config={"sparse": SparseVectorParams(modifier=Modifier.IDF)},
    )
    # Qdrant Cloud strict mode rejects filters on unindexed payload fields.
    for field in keyword_fields:
        client.create_payload_index(name, field, PayloadSchemaType.KEYWORD)


# ---------------------------------------------------------------------------
# Embedders
# ---------------------------------------------------------------------------
def create_dense_embedder():
    """Voyage embed_fn(texts, input_type, token_size=None) on the production model pin."""
    import voyageai

    client = voyageai.Client(api_key=voyage_api_key())
    model = embedding_model()
    print(f"Voyage embedding model: {model}")

    def embed(texts: list[str], input_type: str, token_size: list[int] | None = None):
        return client.embed(texts, model=model, input_type=input_type).embeddings

    return embed


def create_sparse_embedder():
    from ingest.embedding import create_sparse_embedder as production_sparse_embedder

    return production_sparse_embedder()


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------
def upsert_chunks(
    client,
    collection: str,
    uid: str,
    doc_id: str,
    chunks,
    dense: list,
    sparse: list,
    start_index: int = 0,
    extra_payload: dict | None = None,
) -> int:
    """Store already-embedded chunks; chunk_index counts up from start_index."""
    from qdrant_client.models import PointStruct

    model = embedding_model()
    points = []
    for offset, (chunk, dense_vec, sparse_vec) in enumerate(zip(chunks, dense, sparse, strict=True)):
        idx = start_index + offset
        points.append(
            PointStruct(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{collection}/{uid}/{doc_id}/{idx}")),
                vector={"dense": dense_vec, "sparse": sparse_vec},
                payload={
                    "userId": uid,
                    "docId": doc_id,
                    "chunk_index": idx,
                    "token_count": chunk.tokens,
                    "embedding_model": model,
                    "breadcrumb": chunk.breadcrumb(),
                    "content": chunk.content,
                    **(extra_payload or {}),
                },
            )
        )
    for i in range(0, len(points), UPSERT_BATCH):
        client.upsert(collection_name=collection, points=points[i : i + UPSERT_BATCH], wait=True)
    return len(points)


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------
def _scope(uid: str, doc_id: str | None):
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    must = [FieldCondition(key="userId", match=MatchValue(value=uid))]
    if doc_id is not None:
        must.append(FieldCondition(key="docId", match=MatchValue(value=doc_id)))
    return Filter(must=must)


def _hits(result) -> list[dict]:
    return [
        {"content": p.payload.get("content"), "metadata": p.payload, "score": p.score}
        for p in result.points
    ]


def query_dense(client, collection, dense_fn, query: str, uid: str, doc_id=None, limit: int = 5):
    """Dense-only (cosine) retrieval — the embedding baseline."""
    vector = dense_fn([query], input_type="query")[0]
    result = client.query_points(
        collection_name=collection,
        query=vector,
        using="dense",
        query_filter=_scope(uid, doc_id),
        limit=limit,
        with_payload=True,
    )
    return _hits(result)


def query_hybrid(client, collection, dense_fn, sparse_fn, query: str, uid: str, doc_id=None, limit: int = 5):
    """Dense + sparse BM25 retrieval fused with RRF, as in production. Score is the RRF score."""
    from qdrant_client.models import Fusion, FusionQuery, Prefetch

    dense_q = dense_fn([query], input_type="query")[0]
    sparse_q = sparse_fn([query], input_type="query")[0]
    scope = _scope(uid, doc_id)
    depth = max(limit * 4, HYBRID_PREFETCH_MIN)
    result = client.query_points(
        collection_name=collection,
        # The filter goes on each prefetch too; a top-level filter alone would
        # not constrain which candidates the prefetch stage picks.
        prefetch=[
            Prefetch(query=dense_q, using="dense", limit=depth, filter=scope),
            Prefetch(query=sparse_q, using="sparse", limit=depth, filter=scope),
        ],
        query=FusionQuery(fusion=Fusion.RRF),
        query_filter=scope,
        limit=limit,
        with_payload=True,
    )
    return _hits(result)


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
def ranked_list_to_relevance(ordered_chunks: list[int]) -> dict[int, int]:
    """[13, 0] -> {13: 2, 0: 1}: earlier in the list = more relevant."""
    n = len(ordered_chunks)
    return {chunk_id: n - i for i, chunk_id in enumerate(ordered_chunks)}


def recall_k(retrieved_ids: list[int], relevant_ids: dict[int, int], k: int) -> float:
    hits = [rid for rid in retrieved_ids[:k] if rid in relevant_ids]
    return len(hits) / len(relevant_ids) if relevant_ids else 0.0


def ndcg_k(retrieved_ids: list[int], relevant_ids: dict[int, int], k: int) -> float:
    import numpy as np

    dcg = sum(
        relevant_ids[rid] / np.log2(i + 2)
        for i, rid in enumerate(retrieved_ids[:k])
        if rid in relevant_ids
    )
    ideal = sorted(relevant_ids.values(), reverse=True)[:k]
    ideal_dcg = sum(rel / np.log2(i + 2) for i, rel in enumerate(ideal))
    return dcg / ideal_dcg if ideal_dcg > 0 else 0.0
