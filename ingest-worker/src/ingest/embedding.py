"""The embedding-client boundary (issue #29) — the only place Voyage is called.

Everything downstream takes an `embed_fn(texts, input_type) -> list[vector]`
callable, so this is exactly the seam the tests fake: no test needs a network,
an API key, or the voyageai package's behavior.

The model comes from config, never from a call site — that is the embedding pin,
recorded on every stored chunk. `input_type` matters: Voyage embeds the same text
differently for "document" (indexing) and "query" (retrieval).
"""

import logging

from ingest.config import embedding_model, voyage_api_key

log = logging.getLogger("ingest")


def create_embedder():
    """Return an embed_fn bound to the configured model and API key."""
    import voyageai

    client = voyageai.Client(api_key=voyage_api_key())
    model = embedding_model()
    log.info("embedder created: model=%s", model)

    def embed(texts: list[str], input_type: str) -> list[list[float]]:
        return client.embed(texts, model=model, input_type=input_type).embeddings

    return embed
