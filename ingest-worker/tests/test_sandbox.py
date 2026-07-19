"""Sandboxed parser tests (guide Phase 6): a parser crash or garbage input is a
raised ParseError in the parent — never a worker-process death or a hang.

No emulators needed; fixtures are generated with the same libraries the parsers
use to WRITE files (writing is independent of the extraction under test).
"""

import io

import pytest

from ingest.parsers import parser_for
from ingest.sandbox import ParseError, run_parser_sandboxed


def pdf_fixture() -> bytes:
    from pypdf import PdfWriter

    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def docx_fixture(text: str) -> bytes:
    from docx import Document

    doc = Document()
    doc.add_paragraph(text)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_parser_dispatch_covers_the_allowlist():
    assert parser_for("application/pdf") == "pdf"
    assert (
        parser_for("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        == "docx"
    )
    assert parser_for("application/msword") == "doc"
    assert parser_for("text/plain") == "text"
    assert parser_for("application/json") == "text"
    with pytest.raises(KeyError):
        parser_for("image/png")


def test_good_pdf_parses_to_text():
    text = run_parser_sandboxed("pdf", pdf_fixture())
    assert isinstance(text, str)  # blank page -> empty text is fine


def test_corrupt_pdf_raises_parse_error_not_hang():
    # Valid magic then garbage: passes precheck, must fail in the sandbox.
    with pytest.raises(ParseError):
        run_parser_sandboxed("pdf", b"%PDF-1.7" + bytes(range(256)) * 16)


def test_docx_parses_paragraph_text():
    assert "hello docx" in run_parser_sandboxed("docx", docx_fixture("hello docx"))


def test_text_passthrough():
    assert run_parser_sandboxed("text", "héllo\n".encode("utf-8")) == "héllo\n"


def test_doc_failure_raises_parse_error():
    # CFB magic + garbage: on hosts without antiword this exercises the missing-
    # binary path, in the container the antiword-rejects path — both ParseError.
    with pytest.raises(ParseError):
        run_parser_sandboxed("doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512)
