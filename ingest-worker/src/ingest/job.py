"""Job entry `run_ingest_job(envelope)` — the broker-free seam (guide Phase 7).

Pure function of (uid, docId) against Firestore + Storage. Document-level
failures become status `failed` and RETURN (the consumer acks); infrastructure
failures RAISE (the consumer nacks to the DLQ). The only Firestore side effects
this ticket are the status writes; parsed text is held in memory and discarded
(persisting it + `processing -> ready` is ticket #5).

MAIN INGESTING FUNCTION (entry point for processing a single document)
"""

import logging


from ingest.config import firestore_client, storage_bucket
from ingest.firestore_status import Claim, claim_for_processing, mark_failed
from ingest.parsers import needs_ocr_fallback, parser_for
from ingest.paths import document_storage_path
from ingest.precheck import precheck
from ingest.sandbox import ParseError, run_parser_sandboxed

log = logging.getLogger("ingest")


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
        text = run_parser_sandboxed(parser_name, data)
        if parser_name == "pdf" and needs_ocr_fallback(text):
            # #18: text-less PDF (Print-to-PDF vector glyphs / scanned pages) —
            # a SECOND sandbox pass through Docling+RapidOCR under the OCR
            # budget. Normal PDFs never reach this line, so the common case
            # keeps the tight 20s guard and never imports docling.
            log.info("pdf text pass near-empty for %s/%s; running OCR fallback", uid, doc_id)
            text = run_parser_sandboxed("pdf_ocr", data)
            if needs_ocr_fallback(text):
                # Even OCR found nothing embeddable — that is a document-level
                # failure, not a false success ending at `processing`.
                raise ParseError("OCR fallback recovered no embeddable text")
    except ParseError as exc:
        log.warning("parse failed for %s/%s: %s", uid, doc_id, exc)
        mark_failed(db, uid, doc_id)  # object retained
        return "skipped"

    # Good file: ENDS at `processing` (ticket #5 takes it to `ready`).
    log.info("parsed %s/%s: %d chars (held in memory only)", uid, doc_id, len(text))
    snap = None  # discard the snapshot to free memory
    return "finished"
