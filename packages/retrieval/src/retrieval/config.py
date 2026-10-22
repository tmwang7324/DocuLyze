"""Env-driven configuration for the vector store and embedders.

Moved out of ingest.config (chat grill, ticket 01) so the ingest worker and the
chat service read the same pin and the same cluster — the write side and the
query side must agree on both or retrieval silently returns garbage.
"""

import os


def embedding_model() -> str:
    # The embedding pin (issue #29): recorded alongside every stored chunk.
    # Changing it is an explicit full re-embed migration — mixing vector
    # spaces/dimensions in one collection silently corrupts retrieval.
    return os.environ.get("EMBEDDING_MODEL", "voyage-3.5-lite")


def embedding_dim() -> int:
    # Dense vector size of the pinned model (voyage-3.5-lite = 1024).
    return int(os.environ.get("EMBEDDING_DIM", "1024"))


def qdrant_url() -> str:
    return os.environ["QDRANT_URL"]  # Qdrant Cloud cluster URL; required, fail loudly


def qdrant_api_key() -> str:
    return os.environ["QDRANT_API_KEY"]  # required, fail loudly; from DocuLyze/.env (repo root), passed through by docker-compose


def voyage_api_key() -> str | None:
    # Same var the voyageai SDK resolves itself; read it here so the key stays
    # a config concern and never gets hardcoded at a call site.
    return os.environ.get("VOYAGE_API_KEY")  # from DocuLyze/.env (repo root), passed through by docker-compose
