"""Text-less-PDF OCR fallback (ticket #18): predicate, registry, budget, exec.

The un-gated tests are fast and must not pull docling into the test process —
`needs_ocr_fallback` is pure string logic and the registry/timeout checks are
parent-side lookups. The two "fast pass" tests DO run pymupdf4llm in-process
(same as test_job.py building fixtures) to pin the #18 contract that the fast
PDF pass never OCRs: if PDFParser ever re-enables pymupdf4llm's implicit OCR,
the text-less fixture would come back with recovered text and
`needs_ocr_fallback` would flip to False.

The OCR-exec test at the bottom is gated behind DOCULYZE_RUN_DOCLING like the
other Docling-exec tests: it runs the full Docling PDF + RapidOCR pipeline
(layout + OCR models resolve from DOCLING_ARTIFACTS_PATH when baked, else the
local caches — the first un-baked run downloads models and needs network).
"""

import io
import os
import subprocess
import sys

import pytest

from support import textless_pdf_fixture

from ingest import config
from ingest.parsers import (
    _PARSER_BY_TYPE,
    PARSERS,
    PDFOCRParser,
    needs_ocr_fallback,
    parse_timeout_for,
)


# --- needs_ocr_fallback (un-gated: pure string logic) -------------------------

def test_empty_text_needs_fallback():
    assert needs_ocr_fallback("") is True


def test_whitespace_only_needs_fallback():
    # The real trigger output: pymupdf4llm on a vector-glyph PDF returns only newlines.
    assert needs_ocr_fallback("\n\n\n\n\n\n") is True


def test_page_separators_only_needs_fallback():
    assert needs_ocr_fallback("-----\n\n-----\n\n") is True


def test_markdown_skeleton_only_needs_fallback():
    # Headings/table/blockquote/emphasis markers without content are not text.
    assert needs_ocr_fallback("# \n\n| --- | --- |\n> *_`\n") is True


def test_real_text_does_not_need_fallback():
    assert needs_ocr_fallback("# Report\n\nRevenue grew 12 percent.\n") is False


def test_threshold_boundary():
    # Default PDF_OCR_MIN_CHARS=16: strictly-below trips the fallback, at-threshold passes.
    assert needs_ocr_fallback("a" * 15) is True
    assert needs_ocr_fallback("a" * 16) is False


def test_threshold_reads_env_at_call_time(monkeypatch):
    monkeypatch.setenv("PDF_OCR_MIN_CHARS", "3")
    assert needs_ocr_fallback("ab") is True
    assert needs_ocr_fallback("abc") is False


# --- fast-pass contract (un-gated: pymupdf4llm in-process, no docling) --------

def test_fast_pdf_pass_on_textless_pdf_is_near_empty():
    # #18: the fast pass must NOT OCR (pymupdf4llm's implicit OCR is disabled),
    # so a text-less PDF comes back near-empty and trips the fallback predicate.
    md = PARSERS["pdf"].parse(textless_pdf_fixture())
    assert needs_ocr_fallback(md) is True, md


def test_fast_pdf_pass_on_text_pdf_is_not_near_empty():
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page(width=400, height=200)
    page.insert_textbox(
        pymupdf.Rect(20, 20, 380, 180), "Regular text body content here.", fontsize=14
    )
    buf = io.BytesIO()
    doc.save(buf)

    md = PARSERS["pdf"].parse(buf.getvalue())
    assert "Regular text body content here." in md
    assert needs_ocr_fallback(md) is False


def test_fast_pdf_parse_never_imports_docling():
    # #18 acceptance: "a normal text PDF is parsed by PyMuPDF only and never
    # imports Docling" — run the ACTUAL fast parse in a fresh interpreter (the
    # same shape the sandbox child sees) and assert docling never loaded.
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = os.path.join(root, "src")
    code = (
        "import sys; from ingest.parsers import PARSERS; "
        "PARSERS['pdf'].parse(sys.stdin.buffer.read()); "
        "leaked = sorted(m for m in sys.modules "
        "if m == 'docling' or m.startswith('docling.')); "
        "assert not leaked, leaked"
    )
    env = dict(os.environ, PYTHONPATH=src)
    proc = subprocess.run(
        [sys.executable, "-c", code],
        input=textless_pdf_fixture(),
        env=env,
        capture_output=True,
    )
    assert proc.returncode == 0, proc.stderr.decode("utf-8", "replace")


# --- registry + budget (un-gated: parent-side lookups) ------------------------

def test_pdf_ocr_registered_with_docling_and_ocr_flags():
    parser = PARSERS["pdf_ocr"]
    assert isinstance(parser, PDFOCRParser)
    assert parser.docling is True
    assert parser.ocr is True


def test_pdf_ocr_is_not_a_routing_target():
    # No contentType routes to pdf_ocr — only the job triggers it, after the
    # fast pdf pass came back near-empty.
    assert "pdf_ocr" not in set(_PARSER_BY_TYPE.values())


def test_only_pdf_ocr_carries_the_ocr_flag():
    for name, parser in PARSERS.items():
        assert parser.ocr is (name == "pdf_ocr"), name


def test_pdf_ocr_carries_the_ocr_budget():
    assert parse_timeout_for("pdf_ocr") == config.ocr_timeout_s() == 180.0


def test_ocr_budget_reads_env_at_call_time(monkeypatch):
    monkeypatch.setenv("OCR_TIMEOUT_S", "42")
    assert parse_timeout_for("pdf_ocr") == 42.0


def test_ocr_config_knobs():
    assert config.ocr_max_pages() == 15
    assert config.pdf_ocr_min_chars() == 16


# --- OCR-exec at the pure PARSERS[name] seam (GATED) --------------------------

_GATE = pytest.mark.skipif(
    not os.environ.get("DOCULYZE_RUN_DOCLING"),
    reason="set DOCULYZE_RUN_DOCLING=1 to run Docling-exec tests (imports docling)",
)


@_GATE
def test_pdf_ocr_parser_recovers_text_from_textless_pdf():
    # #18 acceptance: the Docling+RapidOCR pass recovers known strings from a
    # PDF with no text layer. Digits are deliberate — RapidOCR reads numbers
    # reliably, and inter-word spacing quirks can't break the assertion.
    md = PARSERS["pdf_ocr"].parse(textless_pdf_fixture())
    assert "INVOICE" in md, md
    assert "12345" in md, md
