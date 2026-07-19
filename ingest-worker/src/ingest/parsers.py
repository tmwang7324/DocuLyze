"""Parser dispatch + the actual extraction functions (guide Phase 6).

The extraction functions run ONLY inside the sandboxed child (parse_entry.py) —
the parent never imports pypdf/python-docx into its own process for untrusted
bytes. parser_for() is safe anywhere (pure lookup).
"""

import io
import subprocess
import tempfile

from ingest.precheck import DOCX_TYPE, TEXT_FAMILY

_PARSER_BY_TYPE = {
    "application/pdf": "pdf",
    DOCX_TYPE: "docx",
    "application/msword": "doc",
    **{ct: "text" for ct in TEXT_FAMILY},
}


def parser_for(content_type: str) -> str:
    """Map a canonical contentType to a parser name. KeyError on unknown —
    an unknown type here means the allowlist and this table drifted."""
    return _PARSER_BY_TYPE[content_type]


def _parse_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _parse_docx(data: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs)


def _parse_text(data: bytes) -> str:
    return data.decode("utf-8")


def _parse_doc(data: bytes) -> str:
    # antiword reads a file PATH, not stdin (grill 2026-07-18) — write the bytes
    # to a temp file inside this sandboxed child; it dies with the child.
    # delete=False + manual unlink because Windows can't reopen an open NamedTemporaryFile.
    import os

    tmp = tempfile.NamedTemporaryFile(suffix=".doc", delete=False)
    try:
        tmp.write(data)
        tmp.close()
        proc = subprocess.run(["antiword", tmp.name], capture_output=True)
        if proc.returncode != 0:
            raise RuntimeError(f"antiword exited {proc.returncode}: {proc.stderr[:200]!r}")
        return proc.stdout.decode("utf-8", errors="replace")
    finally:
        os.unlink(tmp.name)


PARSERS = {
    "pdf": _parse_pdf,
    "docx": _parse_docx,
    "text": _parse_text,
    "doc": _parse_doc,
}
