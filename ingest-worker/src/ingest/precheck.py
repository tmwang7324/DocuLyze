"""Dependency-free magic-number precheck (guide Phase 5).

Checked against the record's stored contentType — the extension-derived
canonical type (Policy B), never a byte re-sniff for the allowlist. A mismatch
returns False BEFORE any parser runs; the caller marks the record `failed` and
retains the object (flag-only).

Known limit (accepted, grill 2026-07-18): the CFB signature is shared by all
legacy Office formats — a renamed .xls/.ppt passes here and fails at antiword.
The parser is the second gate; that outcome is correct.
"""

import io
import zipfile

PDF_MAGIC = b"%PDF-"
ZIP_MAGIC = b"PK\x03\x04"
CFB_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
BINARY_SIGS = (PDF_MAGIC, ZIP_MAGIC, CFB_MAGIC)

DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# Mirrors the text side of ACCEPTED_TYPES in doculyze/_lib/fileupload_schema.ts.
TEXT_FAMILY = frozenset(
    {
        "text/plain",
        "application/json",
        "application/javascript",
        "application/typescript",
        "text/markdown",
        "text/html",
        "text/css",
        "application/xml",
    }
)


def _zip_has_entry(data: bytes, name: str) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return name in z.namelist()
    except zipfile.BadZipFile:
        return False


def precheck(content_type: str, data: bytes) -> bool:
    if content_type == "application/pdf":
        return data.startswith(PDF_MAGIC)
    if content_type == DOCX_TYPE:
        return data.startswith(ZIP_MAGIC) and _zip_has_entry(data, "[Content_Types].xml")
    if content_type == "application/msword":
        return data.startswith(CFB_MAGIC)
    if content_type in TEXT_FAMILY:
        if any(data.startswith(sig) for sig in BINARY_SIGS):  # binary masquerading as text
            return False
        if b"\x00" in data:
            return False
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            return False
        return True
    return False  # unknown contentType never should have been signed
