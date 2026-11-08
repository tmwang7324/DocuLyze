"""Seam: the tenant gateway over Qdrant (issue #29).

All vector-store access flows through write_user_chunks / query_user_chunks so
the userId filter can't be forgotten at a call site. No network: the embedder is
a deterministic fake and the Qdrant client is in-memory (in-memory, per test).
"""

import support

from ingest.chunker import Chunk, chunk_markdown
from retrieval.vector_store import (
    delete_user_chunks,
    get_user_chunks,
    query_user_chunks,
    write_user_chunks,
)

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
        doc_ids=["doc-a"],
    )

    assert results == []


# --- Slice 2b: multi-document Scope (chat ticket 01) ---

def _write_three_docs(client, embed_fn, sparse_fn):
    """One user, three documents sharing a keyword, plus another user's doc."""
    for doc_id, title in (("doc-1", "Recursion"), ("doc-2", "Stacks"), ("doc-3", "Queues")):
        chunks = chunk_markdown(f"# {title}\n\nLecture notes on {title.lower()} for exam.\n", min_tokens=1)
        write_user_chunks(client, embed_fn, sparse_fn, "user-s", doc_id, chunks)
    other = chunk_markdown("# Secret\n\nLecture notes on exam answers.\n", min_tokens=1)
    write_user_chunks(client, embed_fn, sparse_fn, "user-other", "doc-x", other)


def test_scope_returns_only_pinned_documents(qdrant_client, fake_embedder, fake_sparse_embedder):
    _write_three_docs(qdrant_client, fake_embedder, fake_sparse_embedder)

    results = query_user_chunks(
        qdrant_client, fake_embedder, fake_sparse_embedder, "user-s", "lecture notes exam",
        n_results=50, doc_ids=["doc-1", "doc-3"],
    )

    assert {r["metadata"]["docId"] for r in results} == {"doc-1", "doc-3"}


def test_no_scope_searches_all_of_the_users_documents(qdrant_client, fake_embedder, fake_sparse_embedder):
    _write_three_docs(qdrant_client, fake_embedder, fake_sparse_embedder)

    results = query_user_chunks(
        qdrant_client, fake_embedder, fake_sparse_embedder, "user-s", "lecture notes exam", n_results=50
    )

    assert {r["metadata"]["docId"] for r in results} == {"doc-1", "doc-2", "doc-3"}


def test_pinning_another_users_document_returns_nothing_from_it(
    qdrant_client, fake_embedder, fake_sparse_embedder
):
    _write_three_docs(qdrant_client, fake_embedder, fake_sparse_embedder)

    results = query_user_chunks(
        qdrant_client, fake_embedder, fake_sparse_embedder, "user-s", "lecture notes exam",
        n_results=50, doc_ids=["doc-2", "doc-x"],
    )

    assert {r["metadata"]["docId"] for r in results} == {"doc-2"}


def test_empty_scope_searches_nothing(qdrant_client, fake_embedder, fake_sparse_embedder):
    # Widening an emptied Scope back to everything is the caller's call, not the gateway's.
    _write_three_docs(qdrant_client, fake_embedder, fake_sparse_embedder)

    results = query_user_chunks(
        qdrant_client, fake_embedder, fake_sparse_embedder, "user-s", "lecture notes exam",
        n_results=50, doc_ids=[],
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
    from retrieval.config import embedding_model

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


def test_delete_removes_only_the_target_users_document(
    qdrant_client, fake_embedder, fake_sparse_embedder
):
    _write_two_tenants(qdrant_client, fake_embedder, fake_sparse_embedder)

    delete_user_chunks(qdrant_client, "user-a", "doc-a")
    delete_user_chunks(qdrant_client, "user-a", "doc-a")  # replay is harmless

    assert get_user_chunks(qdrant_client, "user-a", "doc-a") == []
    assert get_user_chunks(qdrant_client, "user-b", "doc-b")


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


# --- Slice 6: contextual headers — the section path is part of what gets embedded ---
# Real corpora (UDA: 92% of chunks) split a section into several chunks and only the
# first keeps its `#` lines, so most chunks have no idea which company or section they
# belong to. These chunks are built directly with the metadata the chunker gives them.

def _recording(embed):
    """Wrap an embedder so a test can see exactly which texts were sent to it."""
    calls = []

    def wrapped(texts, *args, **kwargs):
        calls.append(list(texts))
        return embed(texts, *args, **kwargs)

    return wrapped, calls


def _acme_chunk(body="Net sales were 5.4 billion.", **metadata):
    meta = {"title": "Acme Corp Annual Report", "section_title": "Results", **metadata}
    return Chunk(body, meta, 0, "doc-1")


def test_embeddings_cover_the_section_path_and_the_content(qdrant_client, fake_embedder, fake_sparse_embedder):
    dense, dense_calls = _recording(fake_embedder)
    sparse, sparse_calls = _recording(fake_sparse_embedder)
    chunk = _acme_chunk()

    write_user_chunks(qdrant_client, dense, sparse, "user-ctx", "doc-1", [chunk])

    # Both the dense (Voyage) and the sparse (BM25) side see header + body.
    for calls in (dense_calls, sparse_calls):
        assert calls == [["Acme Corp Annual Report > Results\n\nNet sales were 5.4 billion."]]
    # The stored content stays the raw chunk: Sources and citations show what the document says.
    (stored,) = get_user_chunks(qdrant_client, "user-ctx", "doc-1")
    assert stored["content"] == "Net sales were 5.4 billion."


def test_a_word_only_in_the_header_finds_the_chunk(qdrant_client, fake_embedder, fake_sparse_embedder):
    # "Which company?" lives in the title, not in the chunk text: the failure
    # contextual headers fix. Same-shaped bodies, different companies.
    companies = ["Globex", "Initech", "Umbrella", "Hooli", "Stark", "Wayne", "Acme"]
    for number, company in enumerate(companies):
        doc_id = f"doc-{company.lower()}"
        sales = "8.8" if company == "Acme" else f"{number}.4"  # values chosen so the dense side alone ranks Acme 6th of 7
        chunk = Chunk(f"Net sales were {sales} billion.", {"title": f"{company} Annual Report"}, 0, doc_id)
        write_user_chunks(qdrant_client, fake_embedder, fake_sparse_embedder, "user-ctx", doc_id, [chunk])

    results = query_user_chunks(qdrant_client, fake_embedder, fake_sparse_embedder, "user-ctx", "Acme", n_results=1)

    assert [r["metadata"]["docId"] for r in results] == ["doc-acme"]


def test_each_point_records_its_embedding_format_and_header(qdrant_client, fake_embedder, fake_sparse_embedder):
    # Chunks written before contextual headers carry neither field, so a re-embed
    # migration can find exactly the rows still embedded the old way.
    chunks = [_acme_chunk(), Chunk("A paragraph with no headings.", {}, 1, "doc-1")]

    write_user_chunks(qdrant_client, fake_embedder, fake_sparse_embedder, "user-ctx", "doc-1", chunks)

    stored = {s["metadata"]["chunk_index"]: s["metadata"] for s in get_user_chunks(qdrant_client, "user-ctx", "doc-1")}
    assert stored[0]["embedding_format"] == "contextual-v1"
    assert stored[0]["context_header"] == "Acme Corp Annual Report > Results"
    assert stored[1]["embedding_format"] == "contextual-v1"
    assert stored[1]["context_header"] == ""


def test_write_logs_how_many_chunks_got_a_header(qdrant_client, fake_embedder, fake_sparse_embedder, caplog):
    import logging

    chunks = [_acme_chunk(), _acme_chunk("Operating income was 1.1 billion."), Chunk("No headings here.", {}, 2, "doc-1")]

    with caplog.at_level(logging.DEBUG, logger="retrieval"):
        write_user_chunks(qdrant_client, fake_embedder, fake_sparse_embedder, "user-log", "doc-log", chunks)

    lines = [r.getMessage() for r in caplog.records if r.name == "retrieval"]
    summary = next(m for m in lines if "contextual headers" in m)
    assert "user=user-log" in summary and "doc=doc-log" in summary
    assert "2/3 chunks" in summary and "format=contextual-v1" in summary
    assert "avg header 33 chars" in summary  # len("Acme Corp Annual Report > Results"), over the 2 headed chunks
    sample = next(m for m in lines if "embedding input sample" in m)
    assert "Acme Corp Annual Report > Results" in sample and "Net sales were 5.4 billion." in sample
