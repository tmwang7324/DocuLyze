"""Fakes for the run_turn seam: no network, no API keys, no model downloads."""

import hashlib
import os
from dataclasses import dataclass

os.environ.setdefault("EMBEDDING_DIM", "8")  # match EMBED_DIM below

import pytest  # noqa: E402

EMBED_DIM = 8


@dataclass
class FakeChunk:
    """The shape write_user_chunks reads: content, tokens, breadcrumb()."""

    content: str
    tokens: int = 10

    def breadcrumb(self) -> str:
        return "Fixture"


def fake_embedder():
    def embed(texts, input_type, token_size=None):
        return [[hashlib.sha256(t.encode()).digest()[i] / 255.0 for i in range(EMBED_DIM)] for t in texts]

    return embed


def fake_sparse_embedder():
    from qdrant_client.models import SparseVector

    def embed(texts, input_type="document"):
        out = []
        for text in texts:
            counts: dict[int, float] = {}
            for tok in text.lower().split():
                idx = int.from_bytes(hashlib.sha256(tok.encode()).digest()[:2], "big")
                counts[idx] = counts.get(idx, 0.0) + 1.0
            out.append(SparseVector(indices=list(counts), values=list(counts.values())))
        return out

    return embed


@pytest.fixture()
def qdrant():
    from qdrant_client import QdrantClient
    from retrieval.vector_store import _ensure_collection

    client = QdrantClient(":memory:")
    _ensure_collection(client)
    return client


@pytest.fixture()
def write_doc(qdrant):
    from retrieval.vector_store import write_user_chunks

    def write(uid: str, doc_id: str, *texts: str):
        chunks = [FakeChunk(t) for t in texts]
        write_user_chunks(qdrant, fake_embedder(), fake_sparse_embedder(), uid, doc_id, chunks)

    return write
