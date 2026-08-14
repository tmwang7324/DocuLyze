"""Seam: chunk_markdown(markdown_text) -> list[Chunk].

Pure-function tests — no emulators, no I/O. Verifies header-based splitting,
token limits, table atomicity, small-chunk merging, and edge cases.
"""

import pytest

from ingest.chunker import Chunk, chunk_markdown


# --- Slice 1: basic header splitting ---

def test_splits_by_markdown_headers():
    md = "# A\n\nParagraph under A.\n\n## B\n\nParagraph under B."
    chunks = chunk_markdown(md, min_tokens=1)
    assert len(chunks) >= 2
    assert any("Paragraph under A" in c.content for c in chunks)
    assert any("Paragraph under B" in c.content for c in chunks)


# --- Slice 2: table atomicity ---

def test_table_is_not_split_across_chunks():
    header = "| Col A | Col B |\n| --- | --- |"
    rows = "\n".join(f"| val{i} | val{i} |" for i in range(20))
    md = f"# Section\n\n{header}\n{rows}"
    chunks = chunk_markdown(md, max_tokens=64)
    table_chunks = [c for c in chunks if "|" in c.content and "---" in c.content]
    assert len(table_chunks) == 1


# --- Slice 3: small-chunk merging ---

def test_small_chunks_are_merged():
    md = "# A\n\nTiny.\n\n## B\n\nAlso tiny."
    chunks = chunk_markdown(md, min_tokens=128)
    assert len(chunks) == 1


# --- Slice 4: oversized prose is sub-split ---

def test_long_prose_is_split_to_respect_max_tokens():
    long_text = " ".join(["word"] * 2000)
    md = f"# Big\n\n{long_text}"
    chunks = chunk_markdown(md, max_tokens=256)
    assert len(chunks) > 1
    for c in chunks:
        assert c.tokens <= 256 + 32  # allow overlap tolerance


# --- Slice 5: empty / trivial input ---

def test_empty_input_returns_empty_list():
    assert chunk_markdown("") == []


def test_whitespace_only_returns_empty_list():
    assert chunk_markdown("   \n\n  ") == []


# --- Slice 6: Chunk metadata ---

def test_chunk_metadata_includes_header_breadcrumbs():
    md = "# Doc Title\n\n## Section One\n\nSome content here."
    chunks = chunk_markdown(md, min_tokens=1)
    assert len(chunks) >= 1
    last = chunks[-1]
    assert last.metadata.get("title") == "Doc Title"
    assert "Section One" in last.breadcrumb()


def test_chunk_index_is_sequential():
    md = "# A\n\nFirst.\n\n## B\n\nSecond.\n\n## C\n\nThird."
    chunks = chunk_markdown(md, min_tokens=1)
    indices = [c.metadata["chunk_index"] for c in chunks]
    assert indices == list(range(len(chunks)))
