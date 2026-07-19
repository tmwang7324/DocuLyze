"""Job entry `run_ingest_job(envelope)` — the broker-free seam (guide Phase 7).

Pure function of (uid, docId) against Firestore + Storage. Document-level
failures become status `failed` and RETURN (the consumer acks); infrastructure
failures RAISE (the consumer nacks to the DLQ). The only Firestore side effects
this ticket are the status writes; parsed text is held in memory and discarded
(persisting it + `processing -> ready` is ticket #5).
"""

import logging

from ingest.config import firestore_client, storage_bucket
from ingest.firestore_status import Claim, claim_for_processing, mark_failed
from ingest.parsers import parser_for
from ingest.paths import document_storage_path
from ingest.precheck import precheck
from ingest.sandbox import ParseError, run_parser_sandboxed

log = logging.getLogger("ingest")


def run_ingest_job(envelope: dict) -> None:
    uid, doc_id = envelope["uid"], envelope["docId"]  # required keys; unknown keys ignored
    db = firestore_client()

    decision = claim_for_processing(db, uid, doc_id)
    if decision in (Claim.SKIP, Claim.ABSENT):
        log.info("skip/absent for %s/%s: %s", uid, doc_id, decision.value)
        return
    # CLAIMED or RERUN: the record is now `processing`.

    snap = (
        db.collection("users").document(uid).collection("documents").document(doc_id).get()
    )
    content_type = snap.get("contentType")
    data = storage_bucket().blob(document_storage_path(uid, doc_id)).download_as_bytes()

    if not precheck(content_type, data):
        log.warning("precheck rejected %s/%s (%s)", uid, doc_id, content_type)
        mark_failed(db, uid, doc_id)  # object retained (flag-only)
        return

    try:
        text = run_parser_sandboxed(parser_for(content_type), data)
    except ParseError as exc:
        log.warning("parse failed for %s/%s: %s", uid, doc_id, exc)
        mark_failed(db, uid, doc_id)  # object retained
        return

    # Good file: ENDS at `processing` (ticket #5 takes it to `ready`).
    log.info("parsed %s/%s: %d chars (held in memory only)", uid, doc_id, len(text))
