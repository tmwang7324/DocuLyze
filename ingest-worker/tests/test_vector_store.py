"""Seam: the tenant gateway over Qdrant (issue #29).

All vector-store access flows through write_user_chunks / query_user_chunks so
the userId filter can't be forgotten at a call site. No network: the embedder is
a deterministic fake and the Qdrant client is in-memory (in-memory, per test).
"""

import support

from ingest.chunker import Chunk, chunk_markdown
from ingest.vector_store import get_user_chunks, query_user_chunks, write_user_chunks

# `qdrant_client`, `fake_embedder`, `fake_sparse_embedder` are conftest fixtures (support.py).


# --- Slice 1: tracer bullet — write then read back through the gateway ---

def test_written_chunks_are_retrievable_through_query(qdrant_client, fake_embedder, fake_sparse_embedder):
    uid = "user-abc"
    doc_id = "doc-123"
    md = (
        "# Quarterly Report\n\n"
        "Revenue grew across every segment this quarter.\n\n"
        "## Outlook\n\n"
        "Management expects continued expansion into the next fiscal year.\n"
    )
    chunks = chunk_markdown(md, min_tokens=1)
    assert chunks, "fixture markdown should produce at least one chunk"

    write_user_chunks(qdrant_client, fake_embedder, fake_sparse_embedder, uid, doc_id, chunks)

    results = query_user_chunks(qdrant_client, fake_embedder, fake_sparse_embedder, uid, "revenue outlook")

    assert results
    for r in results:
        assert r["metadata"]["userId"] == uid
        assert r["metadata"]["docId"] == doc_id
    assert results[0]["content"] in [c.content for c in chunks]


# --- Slice 2: tenant isolation — the gateway injects userId, always ---

def _write_two_tenants(client, embed_fn, sparse_fn):
    """Two users' documents in ONE collection. Returns (a_contents, b_contents)."""
    a = chunk_markdown(
        "# Alice Payroll\n\nAlice salary bands and compensation review notes.\n",
        min_tokens=1,
    )
    b = chunk_markdown(
        "# Bob Recipes\n\nBob braised short rib with root vegetables.\n",
        min_tokens=1,
    )
    write_user_chunks(client, embed_fn, sparse_fn, "user-a", "doc-a", a)
    write_user_chunks(client, embed_fn, sparse_fn, "user-b", "doc-b", b)
    return [c.content for c in a], [c.content for c in b]


def test_query_never_returns_another_users_chunks(qdrant_client, fake_embedder, fake_sparse_embedder):
    a_contents, b_contents = _write_two_tenants(qdrant_client, fake_embedder, fake_sparse_embedder)

    results = query_user_chunks(
        qdrant_client, fake_embedder, fake_sparse_embedder, "user-b", "salary compensation", n_results=50
    )

    assert results
    for r in results:
        assert r["metadata"]["userId"] == "user-b"
        assert r["content"] not in a_contents
        assert r["content"] in b_contents


def test_doc_id_filter_cannot_reach_another_users_document(qdrant_client, fake_embedder, fake_sparse_embedder):
    _write_two_tenants(qdrant_client, fake_embedder, fake_sparse_embedder)

    # Caller asks for A's doc while authenticated as B: the injected tenant
    # filter ANDs with the doc filter, so the intersection is empty.
    results = query_user_chunks(
        qdrant_client,
        fake_embedder,
        fake_sparse_embedder,
        "user-b",
        "salary compensation",
        n_results=50,
        doc_id="doc-a",
    )

    assert results == []


# --- Slice 3: the embedding pin is recorded, and read from config ---

def test_stored_chunks_record_the_configured_embedding_model(
    qdrant_client, fake_embedder, fake_sparse_embedder, monkeypatch
):
    # A sentinel no one would hardcode: proves the pin comes from config, not
    # a literal in vector_store. Changing the model is a re-embed migration,
    # so every row has to say which space it was embedded in.
    monkeypatch.setenv("EMBEDDING_MODEL", "sentinel-embed-v0")
    from ingest.config import embedding_model

    chunks = chunk_markdown("# Pin\n\nA short paragraph to embed.\n", min_tokens=1)
    write_user_chunks(qdrant_client, fake_embedder, fake_sparse_embedder, "user-pin", "doc-pin", chunks)

    results = query_user_chunks(
        qdrant_client, fake_embedder, fake_sparse_embedder, "user-pin", "paragraph", n_results=50
    )

    assert results
    for r in results:
        assert r["metadata"]["embedding_model"] == "sentinel-embed-v0"
        assert r["metadata"]["embedding_model"] == embedding_model()


# --- Slice 4: replay replaces a document's vectors (delete-then-upsert) ---

def test_rewriting_a_document_replaces_its_chunks(qdrant_client, fake_embedder, fake_sparse_embedder):
    uid, doc_id = "user-replay", "doc-1"
    first = chunk_markdown(
        "# V1\n\nOriginal opening paragraph.\n\n## V1 Detail\n\n"
        "Original supporting detail paragraph.\n\n## V1 Extra\n\n"
        "Original trailing paragraph.\n",
        min_tokens=1,
    )
    write_user_chunks(qdrant_client, fake_embedder, fake_sparse_embedder, uid, doc_id, first)

    second = chunk_markdown("# V2\n\nRewritten single paragraph.\n", min_tokens=1)
    assert len(second) < len(first), "second write must be strictly smaller"
    write_user_chunks(qdrant_client, fake_embedder, fake_sparse_embedder, uid, doc_id, second)

    results = query_user_chunks(
        qdrant_client, fake_embedder, fake_sparse_embedder, uid, "paragraph", n_results=50
    )

    # No duplicates from the re-add, no survivors from the first write.
    assert len(results) == len(second)
    assert {r["content"] for r in results} == {c.content for c in second}


# --- Slice 5: embed calls respect the provider's per-request batch cap ---

MAX_EMBED_BATCH = 128


def test_large_document_is_embedded_within_the_batch_cap(qdrant_client, fake_sparse_embedder):
    # Voyage rejects a request carrying more texts/tokens than it allows, so a
    # long document cannot go out as one call. The fake enforces that boundary
    # contract instead of counting calls: how the gateway batches is its own
    # business, only "no oversized request, nothing dropped" is the behavior.
    def capped_embed(texts, input_type, token_size=None):
        assert len(texts) <= MAX_EMBED_BATCH, f"oversized embed call: {len(texts)} texts"
        return support.fake_embedder()(texts, input_type)

    # Built directly (not via chunk_markdown) so the count is exactly 300 and
    # the test stays fast — merging rules aren't what's under test here.
    chunks = [Chunk(f"Paragraph {i} covering topic number {i}.", {}, i, "") for i in range(300)]

    write_user_chunks(qdrant_client, capped_embed, fake_sparse_embedder, "user-big", "doc-big", chunks)

    stored = get_user_chunks(qdrant_client, "user-big", "doc-big")
    assert len(stored) == 300  # every chunk embedded and stored, no batch lost
