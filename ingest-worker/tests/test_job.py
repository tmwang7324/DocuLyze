"""Seam-2 integration: run_ingest_job(envelope) against the emulators (guide
Phase 7 / Test plan). Staged record + object in, asserted status transition out.
No broker anywhere.
"""

import io

import pytest
import support

from ingest.job import run_ingest_job

UID = "user-a"
DOC = "doc-1"
PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

pytestmark = pytest.mark.usefixtures("clean_emulators")


def pdf_fixture() -> bytes:
    from pypdf import PdfWriter

    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def docx_fixture() -> bytes:
    from docx import Document

    doc = Document()
    doc.add_paragraph("hello docx")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def stage(content_type: str, data: bytes, status: str = "uploaded") -> dict:
    support.seed_record(UID, DOC, status=status, content_type=content_type, size=len(data))
    support.seed_object(UID, DOC, data, content_type)
    return {"uid": UID, "docId": DOC}


# Case 1: claim + precheck + parse all pass; ends at `processing`, never `ready`.
def test_good_pdf_ends_at_processing():
    run_ingest_job(stage(PDF, pdf_fixture()))
    assert support.read_status(UID, DOC) == "processing"


# Case 2: precheck rejects text-under-pdf BEFORE the parser; object retained.
def test_mismatched_bytes_fail_and_object_is_retained():
    run_ingest_job(stage(PDF, b"just text pretending to be a pdf"))
    assert support.read_status(UID, DOC) == "failed"
    assert support.object_exists(UID, DOC) is True


# Case 3: valid magic then garbage — precheck passes, sandboxed parse fails.
def test_corrupt_pdf_fails_via_sandboxed_parse():
    run_ingest_job(stage(PDF, b"%PDF-1.7" + bytes(range(256)) * 16))
    assert support.read_status(UID, DOC) == "failed"


# Case 4: each parser branch exercises the same transition.
def test_good_docx_ends_at_processing():
    run_ingest_job(stage(DOCX, docx_fixture()))
    assert support.read_status(UID, DOC) == "processing"


def test_good_text_ends_at_processing():
    run_ingest_job(stage("text/plain", b"plain text body"))
    assert support.read_status(UID, DOC) == "processing"


def test_doc_cfb_bytes_fail_at_antiword():
    # Passes the CFB precheck, fails in the .doc parser (antiword absent on host /
    # rejects garbage in the container) -> failed. Exercises the temp-file branch.
    run_ingest_job(stage("application/msword", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512))
    assert support.read_status(UID, DOC) == "failed"


# Case 5: replay idempotency.
def test_replaying_a_good_envelope_is_idempotent():
    env = stage(PDF, pdf_fixture())
    run_ingest_job(env)
    run_ingest_job(env)  # redelivery: RERUN, same terminal state, no extra records
    assert support.read_status(UID, DOC) == "processing"


def test_replay_against_failed_doc_is_skip():
    env = stage(PDF, pdf_fixture(), status="failed")
    run_ingest_job(env)
    assert support.read_status(UID, DOC) == "failed"


def test_replay_against_pending_or_missing_is_absent():
    env = stage(PDF, pdf_fixture(), status="pending")
    run_ingest_job(env)
    assert support.read_status(UID, DOC) == "pending"

    run_ingest_job({"uid": UID, "docId": "no-such-doc"})  # returns cleanly
