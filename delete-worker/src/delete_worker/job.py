"""Broker-free document cleanup job.

Cleanup order is deliberate: Qdrant, then Storage, then the Firestore
tombstone. A crash leaves the durable tombstone available for replay, and every
preceding deletion is idempotent.
"""

import logging

from firebase_admin import firestore
from google.api_core.exceptions import NotFound
from retrieval.vector_store import delete_user_chunks, qdrant_client

from delete_worker.config import firestore_client, storage_bucket
from delete_worker.paths import document_storage_path

log = logging.getLogger("delete-worker")


def _document_ref(db, uid: str, doc_id: str):
    return db.collection("users").document(uid).collection("documents").document(doc_id)


def _envelope_ids(envelope: dict) -> tuple[str, str]:
    uid, doc_id = envelope["uid"], envelope["docId"]
    if not isinstance(uid, str) or not uid or not isinstance(doc_id, str) or not doc_id:
        raise ValueError("Deletion envelope requires non-empty uid and docId strings")
    return uid, doc_id


def run_delete_job(envelope: dict) -> str:
    uid, doc_id = _envelope_ids(envelope)
    db = firestore_client()
    ref = _document_ref(db, uid, doc_id)
    snapshot = ref.get()

    # Record-last ordering means absence is a completed replay, not permission
    # to act on an arbitrary broker message.
    if not snapshot.exists:
        log.info("document already absent for %s/%s", uid, doc_id)
        return "finished"
    if snapshot.get("status") != "deleting":
        log.warning("refusing deletion for %s/%s without deleting status", uid, doc_id)
        return "skipped"

    delete_user_chunks(qdrant_client(), uid, doc_id)

    blob = storage_bucket().blob(document_storage_path(uid, doc_id))
    try:
        blob.delete()
    except NotFound:
        # Replays commonly arrive after this step already succeeded.
        pass

    # Refuse to remove a record changed after our authorization read. A replay
    # takes a fresh snapshot and safely repeats the idempotent cleanup steps.
    ref.delete(option=firestore.LastUpdateOption(snapshot.update_time))
    log.info("deleted document resources for %s/%s", uid, doc_id)
    return "finished"
