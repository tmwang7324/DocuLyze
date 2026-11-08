"""Seam: context_header(metadata, content) — the heading path embedded with each chunk.

Pure functions, no I/O. The chunker decides chunk boundaries; this decides what text
the embedders see, so changing it never touches the chunker the evaluation labels pin.
"""

from retrieval.context import context_header, embedding_text


def test_context_header_is_the_heading_path_only():
    # Not the breadcrumb: no opaque doc id (`source`), no token count.
    meta = {"title": "Acme 10-K", "section_title": "Results", "subsection_title": "Goodwill",
            "source": "doc-9f2c", "chunk_index": 4}
    header = context_header(meta, "body")
    assert header == "Acme 10-K > Results > Goodwill"
    assert "doc-9f2c" not in header and "tokens" not in header


def test_context_header_is_empty_when_the_chunk_has_no_headings():
    assert context_header({"source": "doc-9f2c"}, "body") == ""


def test_context_header_lists_every_section_of_a_merged_chunk():
    # Chunk.append turns differing metadata into lists when small chunks merge.
    assert context_header({"title": "Doc", "section_title": ["Results", "Outlook"]}, "x") == "Doc > Results > Outlook"


def test_context_header_does_not_repeat_a_name():
    meta = {"title": "Cisco", "section_title": "Cisco", "subsection_title": "Risks"}
    assert context_header(meta, "body") == "Cisco > Risks"


def test_context_header_skips_headings_the_chunk_text_already_has():
    # The first chunk under a heading keeps its `#` lines (strip_headers=False): don't say it twice.
    meta = {"title": "Acme", "section_title": "Results"}
    assert context_header(meta, "# Acme\n\n## Results  \nNet sales rose.") == ""
    assert context_header(meta, "## Results\nNet sales rose.") == "Acme"
    # A mere mention in the prose is not a heading line, and a short name never matches loosely.
    assert context_header({"title": "Acme", "section_title": "A"}, "Acme results were a strong year.") == "Acme > A"


def test_embedding_text_puts_the_header_first_and_never_invents_one():
    assert embedding_text("Acme > Results", "Net sales rose.") == "Acme > Results\n\nNet sales rose."
    assert embedding_text("", "Net sales rose.") == "Net sales rose."
