"""Per-parser parse-timeout registry (ticket #14).

The parent resolves a sandbox timeout budget from a parser NAME without importing
any heavy parser dep, and the sandbox runner enforces that per-parser budget: a
parser exceeding it still surfaces as a document-level ParseError. The Docling
parsers (docx/html/xml, tickets #16/#17) carry the ~60s docling_timeout_s()
budget; every other parser keeps the ~20s parse_timeout_s() budget.
"""

import pytest

from ingest.parsers import PARSERS, parse_timeout_for
from ingest.sandbox import ParseError, run_parser_sandboxed


def test_default_budget_is_parse_timeout_s():
    # The Docling parsers (docx/html/xml, tickets #16/#17) carry the 60s docling
    # budget, the OCR fallback (#18) the 180s OCR budget; every other parser
    # keeps the ~20s global parse budget.
    docling = {"docx", "html", "xml"}
    for name in PARSERS:
        if name == "pdf_ocr":
            expected = 180.0
        elif name in docling:
            expected = 60.0
        else:
            expected = 20.0
        assert parse_timeout_for(name) == expected, name


def test_budget_reads_env_at_call_time(monkeypatch):
    monkeypatch.setenv("PARSE_TIMEOUT_S", "7.5")
    assert parse_timeout_for("text") == 7.5
    assert parse_timeout_for("pdf") == 7.5


def test_docling_budget_reads_env_at_call_time(monkeypatch):
    # The docling parsers read DOCLING_TIMEOUT_S at call time (the #14 contract).
    monkeypatch.setenv("DOCLING_TIMEOUT_S", "33")
    assert parse_timeout_for("docx") == 33.0
    assert parse_timeout_for("html") == 33.0
    assert parse_timeout_for("xml") == 33.0


def test_unknown_parser_name_raises_keyerror():
    with pytest.raises(KeyError):
        parse_timeout_for("nope")


def test_sandbox_enforces_per_parser_budget(monkeypatch):
    # A budget below child-python startup guarantees a timeout; the default None
    # timeout must resolve through the registry, so this surfaces as a ParseError.
    monkeypatch.setenv("PARSE_TIMEOUT_S", "0.05")
    with pytest.raises(ParseError) as exc:
        run_parser_sandboxed("text", "anything".encode("utf-8"))
    assert "timed out" in str(exc.value)
