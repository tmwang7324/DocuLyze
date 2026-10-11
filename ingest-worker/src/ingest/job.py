"""Job entry `run_ingest_job(envelope)` — the broker-free seam (guide Phase 7).

Pure function of (uid, docId) against Firestore + Storage. Document-level
failures become status `failed` and RETURN (the consumer acks); infrastructure
failures RAISE (the consumer nacks to the DLQ). Chunks are persisted to the
vector store through the tenant gateway (issue #29), so this job's Firestore
side effects are status transitions ONLY — which is what restores the
config.py safety invariant. A successful job ends at `ready` after the chunks
are written and read back.

MAIN INGESTING FUNCTION (entry point for processing a single document)
"""

import logging
from pathlib import Path



from ingest.chunker import chunk_markdown
from ingest.config import chunk_output_dir, firestore_client, storage_bucket
from ingest.embedding import create_embedder, create_sparse_embedder
from ingest.firestore_status import Claim, claim_for_processing, mark_failed, mark_ready
from ingest.parsers import is_slide_pdf, needs_ocr_fallback, parser_for
from ingest.paths import document_storage_path
from ingest.precheck import precheck
from ingest.sandbox import ParseError, run_parser_sandboxed
from ingest.vector_store import get_user_chunks, qdrant_client, write_user_chunks

log = logging.getLogger("ingest")
current_dir = Path(__file__).resolve().parent


def run_ingest_job(envelope: dict) -> str:
    uid, doc_id = envelope["uid"], envelope["docId"]  # required keys; unknown keys ignored
    db = firestore_client()

    decision = claim_for_processing(db, uid, doc_id)
    if decision in (Claim.SKIP, Claim.ABSENT):
        log.info("skip/absent for %s/%s: %s", uid, doc_id, decision.value)
        return "skipped"
    if decision == Claim.BUSY:
        log.info("busy for %s/%s: %s", uid, doc_id, decision.value)
        return "busy"
    # CLAIMED or RERUN: the record is now `processing`.
    
    snap = (
        db.collection("users").document(uid).collection("documents").document(doc_id).get()
    )
    content_type = snap.get("contentType")
    data = storage_bucket().blob(document_storage_path(uid, doc_id)).download_as_bytes()

    if not precheck(content_type, data):
        log.warning("precheck rejected %s/%s (%s)", uid, doc_id, content_type)
        mark_failed(db, uid, doc_id)  # object retained (flag-only)
        return "skipped"

    parser_name = parser_for(content_type)
    try:
        if parser_name == "pdf" and is_slide_pdf(data):
            # Slide-export PDFs (Google Slides, PowerPoint) — pymupdf4llm drops
            # content from scattered text boxes in presentation layouts. Route
            # directly to Docling+RapidOCR which renders pages as images.
            log.info("slide-format PDF detected for %s/%s; routing to OCR", uid, doc_id)
            text = run_parser_sandboxed("pdf_ocr", data)
            if needs_ocr_fallback(text):
                raise ParseError("OCR recovered no embeddable text from slide PDF")
        else:
            text = run_parser_sandboxed(parser_name, data)
            if parser_name == "pdf" and needs_ocr_fallback(text):
                # #18: text-less PDF (Print-to-PDF vector glyphs / scanned pages) —
                # a SECOND sandbox pass through Docling+RapidOCR under the OCR
                # budget. Normal PDFs never reach this line, so the common case
                # keeps the tight 20s guard and never imports docling.
                log.info("pdf text pass near-empty for %s/%s; running OCR fallback", uid, doc_id)
                text = run_parser_sandboxed("pdf_ocr", data)
                if needs_ocr_fallback(text):
                    raise ParseError("OCR fallback recovered no embeddable text")
    except ParseError as exc:
        log.warning("parse failed for %s/%s: %s", uid, doc_id, exc)
        mark_failed(db, uid, doc_id)  # object retained
        return "skipped"

    # Good file: chunk the parsed text (document-level — mark_failed on error).
    try:
        chunks = chunk_markdown(text, doc_id=doc_id)
    except (ValueError, TypeError) as exc:
        log.warning("chunking failed for %s/%s: %s", uid, doc_id, exc)
        mark_failed(db, uid, doc_id)
        return "skipped"

    token_counts = [c.tokens for c in chunks]
    log.info(
        "chunked %s/%s: %d chunks, %d total tokens (min=%d, max=%d, avg=%d)",
        uid, doc_id, len(chunks),
        sum(token_counts),
        min(token_counts) if token_counts else 0,
        max(token_counts) if token_counts else 0,
        sum(token_counts) // len(token_counts) if token_counts else 0,
    )

    # Chunk file output is optional (infrastructure — errors propagate to DLQ).
    out_dir = chunk_output_dir()
    if out_dir:
        doc_dir = Path(out_dir) / doc_id
        doc_dir.mkdir(parents=True, exist_ok=True)
        for idx, c in enumerate(chunks):
            (doc_dir / f"chunk_{idx:03d}.md").write_text(
                f"<!-- {c.breadcrumb()} -->\n\n{c.content}", encoding="utf-8"
            )

    # Broad `except` per issue #29 acceptance: any embed/write failure (bad
    # content OR a dead Voyage/Chroma) -> `failed`, never a job resting at
    # `processing`. RESOLVED
    # NOTE this deliberately diverges from CONTEXT.md, which
    # routes dependency outages to the DLQ instead of `failed` — revisit if
    # outage-vs-bad-document is ever split. Chunking's guard above stays narrow.
    try:
        write_user_chunks(
            qdrant_client(), create_embedder(), create_sparse_embedder(), uid, doc_id, chunks
        )
    except Exception as exc:
        log.warning("chunk write failed for %s/%s: %s", uid, doc_id, exc)
        mark_failed(db, uid, doc_id)
        return "skipped"

    try:
        stored = get_user_chunks(qdrant_client(), uid, doc_id)
    except Exception as exc:
        log.warning("chunk verification failed for %s/%s: %s", uid, doc_id, exc)
        mark_failed(db, uid, doc_id)
        return "skipped"

    if not stored:
        log.warning("chunk verification empty for %s/%s", uid, doc_id)
        mark_failed(db, uid, doc_id)
        return "skipped"

    mark_ready(db, uid, doc_id)
    return "finished"
