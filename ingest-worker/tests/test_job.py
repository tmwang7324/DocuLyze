"""Seam-2 integration: run_ingest_job(envelope) against the emulators (guide
Phase 7 / Test plan). Staged record + object in, asserted status transition out.
No broker anywhere.
"""

import io
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
import support

import ingest.job as job_module
from ingest.config import lease_ttl_s
from ingest.job import run_ingest_job
from ingest.vector_store import get_user_chunks, query_user_chunks

UID = "user-a"
DOC = "doc-1"
PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
HTML = "text/html"
XML = "application/xml"

pytestmark = pytest.mark.usefixtures("clean_emulators")


@pytest.fixture(autouse=True)
def fake_vector_stack(monkeypatch):
    """#29: the job's vector stack, faked for every test in this module — an
    in-memory Chroma and a deterministic embedder, so no Chroma server and no
    Voyage key. Patched with raising=True on purpose: if job.py ever renames or
    drops these imports, the fixture fails loudly instead of silently letting
    the suite reach the real Voyage API."""
    client = support.fresh_chroma_client()
    monkeypatch.setattr(job_module, "chroma_client", lambda: client)
    monkeypatch.setattr(job_module, "create_embedder", support.fake_embedder)
    yield client


def pdf_fixture() -> bytes:
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page(width=400, height=400)
    # Enough real text to clear PDF_OCR_MIN_CHARS (#18) — a fixture with fewer
    # than 16 content chars legitimately trips the OCR fallback.
    page.insert_htmlbox(
        pymupdf.Rect(20, 20, 380, 120),
        "<p>hello pdf body with plenty of real text content</p>",
    )
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def docx_fixture() -> bytes:
    from docx import Document

    doc = Document()
    doc.add_paragraph("hello docx")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def fake_ocr_sandbox(monkeypatch, ocr_result: str) -> list[str]:
    """Fake ONLY the pdf_ocr sandbox pass (docling exec is gated elsewhere);
    every other parser runs the real sandbox. Returns the call log."""
    calls: list[str] = []
    real = job_module.run_parser_sandboxed

    def wrapper(parser_name, data, timeout_s=None):
        calls.append(parser_name)
        if parser_name == "pdf_ocr":
            return ocr_result
        return real(parser_name, data, timeout_s)

    monkeypatch.setattr(job_module, "run_parser_sandboxed", wrapper)
    return calls


def stage(content_type: str, data: bytes, status: str = "uploaded") -> dict:
    support.seed_record(UID, DOC, status=status, content_type=content_type, size=len(data))
    support.seed_object(UID, DOC, data, content_type)
    return {"uid": UID, "docId": DOC}


# Case 1: claim + precheck + parse + chunk + persist all pass; ends at `ready`.
def test_good_pdf_ends_at_ready():
    run_ingest_job(stage(PDF, pdf_fixture()))
    assert support.read_status(UID, DOC) == "ready"


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
def test_good_docx_ends_at_ready():
    run_ingest_job(stage(DOCX, docx_fixture()))
    assert support.read_status(UID, DOC) == "ready"


def test_good_text_ends_at_ready():
    run_ingest_job(stage("text/plain", b"plain text body"))
    assert support.read_status(UID, DOC) == "ready"


# #17: HTML/XML now parse via Docling in the sandbox child (no models needed —
# SimplePipeline; works offline, just slower for docling's import in the child).
def test_good_html_ends_at_ready():
    html = b"<html><body><h1>Title</h1><p>hello html body</p></body></html>"
    run_ingest_job(stage(HTML, html))
    assert support.read_status(UID, DOC) == "ready"


def test_good_xml_ends_at_ready():
    xml = b"<?xml version='1.0'?><doc><section>hello xml body</section></doc>"
    run_ingest_job(stage(XML, xml))
    assert support.read_status(UID, DOC) == "ready"


# #16 corrupt-docx coverage.
# (a) garbage claiming DOCX: precheck rejects BEFORE any docling parse; object kept.
def test_garbage_docx_fails_at_precheck():
    run_ingest_job(stage(DOCX, b"not a zip, just bytes claiming to be docx"))
    assert support.read_status(UID, DOC) == "failed"
    assert support.object_exists(UID, DOC) is True


# (b) valid DOCX zip shell (has [Content_Types].xml so precheck PASSES) but the
# word/document.xml body is missing/corrupt: Docling's DOCX backend fails in the
# sandbox -> failed, object retained.
def test_corrupt_docx_body_fails_via_sandboxed_parse():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")  # satisfies precheck
        z.writestr("word/document.xml", "not valid docx xml <<<")  # breaks docling
    run_ingest_job(stage(DOCX, buf.getvalue()))
    assert support.read_status(UID, DOC) == "failed"
    assert support.object_exists(UID, DOC) is True


# Case 4b: the OCR fallback wiring (#18). The fast pdf pass runs for real in
# the sandbox; only the pdf_ocr pass is faked (Docling exec is gated elsewhere).
def test_textless_pdf_triggers_ocr_fallback_and_ends_at_ready(monkeypatch):
    calls = fake_ocr_sandbox(monkeypatch, "## Page 1\n\nINVOICE 12345 recovered by OCR.")
    run_ingest_job(stage(PDF, support.textless_pdf_fixture()))
    assert support.read_status(UID, DOC) == "ready"
    assert calls == ["pdf", "pdf_ocr"]


def test_textless_pdf_with_empty_ocr_fails_and_object_is_retained(monkeypatch):
    # Even OCR recovered nothing embeddable -> failed, not a false `processing`.
    calls = fake_ocr_sandbox(monkeypatch, "")
    run_ingest_job(stage(PDF, support.textless_pdf_fixture()))
    assert support.read_status(UID, DOC) == "failed"
    assert support.object_exists(UID, DOC) is True
    assert calls == ["pdf", "pdf_ocr"]


def test_normal_text_pdf_never_runs_the_ocr_pass(monkeypatch):
    # #18 acceptance: a text PDF is parsed by PyMuPDF only — no second pass.
    calls = fake_ocr_sandbox(monkeypatch, "MUST NOT BE USED")
    run_ingest_job(stage(PDF, pdf_fixture()))
    assert support.read_status(UID, DOC) == "ready"
    assert calls == ["pdf"]


# Case 5: replay idempotency.
def test_replaying_a_good_envelope_is_idempotent():
    env = stage(PDF, pdf_fixture())
    run_ingest_job(env)
    second = run_ingest_job(env)  # immediate redelivery: ready -> SKIP, no reparse
    assert second == "skipped"
    assert support.read_status(UID, DOC) == "ready"


def test_replay_against_failed_doc_is_skip():
    env = stage(PDF, pdf_fixture(), status="failed")
    run_ingest_job(env)
    assert support.read_status(UID, DOC) == "failed"


def test_replay_against_pending_or_missing_is_absent():
    env = stage(PDF, pdf_fixture(), status="pending")
    run_ingest_job(env)
    assert support.read_status(UID, DOC) == "pending"

    run_ingest_job({"uid": UID, "docId": "no-such-doc"})  # returns cleanly


# Case 6: processing-lease fencing (issue #12).
def test_busy_claim_returns_busy_before_any_download_or_parse(db):
    # No object staged: if BUSY fell through to download+parse (the bug the
    # lease exists to prevent), this would raise instead of returning cleanly.
    support.seed_record(UID, DOC, status="processing", content_type=PDF, size=3)
    fresh = datetime.now(timezone.utc)
    _doc_ref(db).update({"claimedAt": fresh})

    result = run_ingest_job({"uid": UID, "docId": DOC})

    assert result == "busy"
    assert support.read_status(UID, DOC) == "processing"
    assert _doc_ref(db).get().to_dict().get("claimedAt") == fresh


def test_stale_claim_reruns_and_reparses(db):
    env = stage(PDF, pdf_fixture(), status="processing")
    stale = datetime.now(timezone.utc) - timedelta(seconds=lease_ttl_s() + 60)
    _doc_ref(db).update({"claimedAt": stale})

    result = run_ingest_job(env)

    assert result == "finished"
    assert support.read_status(UID, DOC) == "ready"
    assert _doc_ref(db).get().to_dict().get("claimedAt") > stale


def _doc_ref(db):
    return db.collection("users").document(UID).collection("documents").document(DOC)


# --- Chunking integration (issue #27) ---

def test_good_pdf_writes_chunk_files_to_output_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("CHUNK_OUTPUT_DIR", str(tmp_path))
    run_ingest_job(stage(PDF, pdf_fixture()))
    chunk_files = sorted((tmp_path / DOC).glob("chunk_*.md"))
    assert len(chunk_files) >= 1
    assert chunk_files[0].name == "chunk_000.md"


def test_chunk_files_have_breadcrumb_headers(tmp_path, monkeypatch):
    monkeypatch.setenv("CHUNK_OUTPUT_DIR", str(tmp_path))
    run_ingest_job(stage(PDF, pdf_fixture()))
    first_chunk = (tmp_path / DOC / "chunk_000.md").read_text(encoding="utf-8")
    assert first_chunk.startswith("<!-- ")
    assert "tokens:" in first_chunk.split("\n")[0]


def test_chunking_error_transitions_to_failed(monkeypatch):
    monkeypatch.setattr(job_module, "chunk_markdown", lambda text: (_ for _ in ()).throw(ValueError("boom")))
    run_ingest_job(stage(PDF, pdf_fixture()))
    assert support.read_status(UID, DOC) == "failed"


def test_job_logs_chunk_count_and_token_stats(caplog):
    import logging
    with caplog.at_level(logging.INFO, logger="ingest"):
        run_ingest_job(stage(PDF, pdf_fixture()))
    chunked_msgs = [r.message for r in caplog.records if "chunked" in r.message]
    assert len(chunked_msgs) == 1
    msg = chunked_msgs[0]
    assert "chunks" in msg
    assert "total tokens" in msg


def test_no_chunk_dir_env_means_no_files_written(tmp_path, monkeypatch):
    monkeypatch.delenv("CHUNK_OUTPUT_DIR", raising=False)
    run_ingest_job(stage(PDF, pdf_fixture()))
    assert not list(tmp_path.glob("**/*.md"))


# --- Chunk persistence to the vector store + mark_ready (issue #29) ---
# Supersedes the #28 Firestore-subcollection cases: chunks live in Chroma now.

def test_good_pdf_ends_at_ready_with_chunks_in_vector_store(fake_vector_stack):
    run_ingest_job(stage(PDF, pdf_fixture()))
    assert support.read_status(UID, DOC) == "ready"

    stored = get_user_chunks(fake_vector_stack, UID, DOC)
    assert len(stored) >= 1
    for c in stored:
        assert c["metadata"]["userId"] == UID
        assert c["metadata"]["docId"] == DOC
        assert c["metadata"]["embedding_model"]  # the pin is recorded

    # Retrievable, not merely written.
    hits = query_user_chunks(fake_vector_stack, support.fake_embedder(), UID, "hello pdf body")
    assert hits
    assert hits[0]["content"] in [c["content"] for c in stored]


def test_embed_failure_transitions_to_failed(monkeypatch):
    # #29 acceptance: Voyage being down is a document-level failure (ack + retry
    # later), not a job that silently rests at `processing`. Object retained.
    def broken_embedder():
        def embed(texts, input_type):
            raise RuntimeError("voyage down")

        return embed

    monkeypatch.setattr(job_module, "create_embedder", broken_embedder, raising=False)

    result = run_ingest_job(stage(PDF, pdf_fixture()))

    assert result == "skipped"
    assert support.read_status(UID, DOC) == "failed"
    assert support.object_exists(UID, DOC) is True


def test_rerun_replaces_vector_chunks_idempotent(fake_vector_stack):
    env = stage(PDF, pdf_fixture())
    run_ingest_job(env)
    first_chunks = get_user_chunks(fake_vector_stack, UID, DOC)
    assert len(first_chunks) >= 1

    # Re-stage as uploaded so the claim succeeds again.
    support.seed_record(UID, DOC, status="uploaded", content_type=PDF, size=len(pdf_fixture()))
    run_ingest_job(env)
    second_chunks = get_user_chunks(fake_vector_stack, UID, DOC)

    assert len(second_chunks) == len(first_chunks)  # replaced, not appended
    assert support.read_status(UID, DOC) == "ready"


def test_empty_vector_verification_transitions_to_failed(monkeypatch):
    monkeypatch.setattr(job_module, "get_user_chunks", lambda *a, **k: [])
    run_ingest_job(stage(PDF, pdf_fixture()))
    assert support.read_status(UID, DOC) == "failed"


def test_verification_error_transitions_to_failed(monkeypatch):
    # A store that drops mid-verification belongs in the same bucket as an embed
    # failure: document-level failure, ack, retry later. An escaping exception
    # would leave the doc resting at `processing` forever.
    def boom(*a, **k):
        raise RuntimeError("chroma dropped")

    monkeypatch.setattr(job_module, "get_user_chunks", boom)

    result = run_ingest_job(stage(PDF, pdf_fixture()))

    assert result == "skipped"
    assert support.read_status(UID, DOC) == "failed"


def test_chunks_not_written_to_firestore_subcollection(db):
    # Side-channel read (not through the gateway) is the point: pins that the
    # legacy #28 subcollection write is GONE, not merely unread.
    run_ingest_job(stage(PDF, pdf_fixture()))
    assert support.read_status(UID, DOC) == "ready"
    assert list(_doc_ref(db).collection("chunks").stream()) == []
