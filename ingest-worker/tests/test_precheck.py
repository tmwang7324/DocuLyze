"""Branch tests for the dependency-free magic-number precheck (guide Phase 5).

Pure function, no emulators. Expected values are known-good format signatures
(the spec), not recomputed from the implementation.
"""

import io
import zipfile

from ingest.precheck import precheck

PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DOC = "application/msword"


def docx_bytes(entries=("[Content_Types].xml",)) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name in entries:
            z.writestr(name, "<xml/>")
    return buf.getvalue()


def test_pdf_magic_passes():
    assert precheck(PDF, b"%PDF-1.7 rest of file") is True


def test_text_bytes_under_pdf_fails():
    assert precheck(PDF, b"just some text pretending") is False


def test_docx_zip_with_content_types_passes():
    assert precheck(DOCX, docx_bytes()) is True


def test_plain_zip_without_content_types_fails():
    assert precheck(DOCX, docx_bytes(entries=("random.txt",))) is False


def test_doc_cfb_magic_passes():
    assert precheck(DOC, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 8) is True


def test_doc_wrong_magic_fails():
    assert precheck(DOC, b"not a compound file") is False


def test_utf8_text_passes():
    assert precheck("text/plain", "héllo wörld\n".encode("utf-8")) is True


def test_text_with_nul_byte_fails():
    assert precheck("text/plain", b"abc\x00def") is False


def test_invalid_utf8_fails():
    assert precheck("text/plain", b"\xff\xfe\xfa garbage") is False


def test_pdf_bytes_under_text_fails():
    # A binary masquerading under a text contentType.
    assert precheck("application/json", b"%PDF-1.7 whatever") is False


def test_all_text_family_members_accept_utf8():
    for ct in (
        "text/plain",
        "application/json",
        "application/javascript",
        "application/typescript",
        "text/markdown",
        "text/html",
        "text/css",
        "application/xml",
    ):
        assert precheck(ct, b"plain ascii") is True, ct


def test_unknown_content_type_fails():
    assert precheck("image/png", b"\x89PNG\r\n") is False
