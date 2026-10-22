"""The embedding-client boundary (issue #29) — the only place Voyage is called.

Everything downstream takes an `embed_fn(texts, input_type, token_size=None) ->
list[vector]` callable, so this is exactly the seam the tests fake: no test
needs a network, an API key, or the voyageai package's behavior.

The model comes from config, never from a call site — that is the embedding pin,
recorded on every stored chunk. `input_type` matters: Voyage embeds the same text
differently for "document" (indexing) and "query" (retrieval). `token_size` is
optional (write callers pass it for the batch-cap warning below; query callers,
embedding a single short string, don't need it).
"""

import logging

from retrieval.config import embedding_model, voyage_api_key

log = logging.getLogger("retrieval")


def create_embedder_voyage():
    """Return an embed_fn bound to the configured model and API key."""
    import voyageai

    client = voyageai.Client(api_key=voyage_api_key())
    model = embedding_model()
    log.info("embedder created: model=%s", model)

    def embed(
        texts: list[str], input_type: str, token_size: list[int] | None = None
    ) -> list[list[float]]:
        if token_size and sum(token_size) > 30000:  # voyage's 32k token context window
            log.warning(
                "embedding %d chunks with total token size %d exceeds 100k limit; "
                "Voyage may fail or truncate",
                len(texts),
                sum(token_size),
            )
        return client.embed(texts, model=model, input_type=input_type).embeddings

    return embed


def create_embedder_bge():
    """Return an embed_fn bound to the configured model and API key."""
    return


def create_embedder():
    """The embedder job.py actually calls — currently always Voyage.

    A second provider (BGE, local/offline) is a real future direction but
    create_embedder_bge() above is an unfinished stub; wiring provider choice
    through here (e.g. by embedding_model()'s value) is a separate migration.
    """
    return create_embedder_voyage()


# --- Qdrant migration: sparse (BM25) embedder, alongside the dense one above ---
# fastembed's `Qdrant/bm25` computes term-weighted sparse vectors per text with
# no corpus-wide fit step (unlike classic rank_bm25, which needs the whole
# corpus up front) — a good match for this per-document streaming pipeline.
# Like the dense embedder, it distinguishes "document" (indexing) vs "query"
# (retrieval) — fastembed exposes that as two methods, not an `input_type` you
# pass a shared `.embed()`, so this wrapper folds that into the same
# `input_type`-kwarg shape as create_embedder()'s dense embed_fn.
def create_sparse_embedder():
    """Return a sparse_embed_fn(texts, input_type) -> list[SparseVector]."""
    from fastembed import SparseTextEmbedding
    from qdrant_client.models import SparseVector

    model = SparseTextEmbedding(model_name="Qdrant/bm25")
    log.info("sparse embedder created: model=Qdrant/bm25")

    def sparse_embed(texts: list[str], input_type: str = "document") -> list[SparseVector]:
        vectors = model.query_embed(texts) if input_type == "query" else model.embed(texts)
        return [
            SparseVector(indices=v.indices.tolist(), values=v.values.tolist())
            for v in vectors
        ]

    return sparse_embed 