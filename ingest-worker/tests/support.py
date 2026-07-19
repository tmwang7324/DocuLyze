"""Seam-2 test harness: emulator reset + record/object seeding.

Python twin of doculyze/tests/helpers/harness.ts — same reset endpoint, same
seeding discipline (real emulator metadata, not mocks).
"""

import os
import urllib.request

from ingest.config import firestore_client, storage_bucket
from ingest.paths import document_storage_path


def reset_emulators() -> None:
    host = os.environ["FIRESTORE_EMULATOR_HOST"]
    project = os.environ.get("GCLOUD_PROJECT", "doculyze")
    req = urllib.request.Request(
        f"http://{host}/emulator/v1/projects/{project}/databases/(default)/documents",
        method="DELETE",
    )
    with urllib.request.urlopen(req) as res:
        if res.status != 200:
            raise RuntimeError(
                f"Firestore emulator reset failed (HTTP {res.status}). "
                "Are the emulators running? Start them with `npm run emulators` in doculyze/."
            )
    for blob in storage_bucket().list_blobs():
        blob.delete()


def seed_record(
    uid: str,
    doc_id: str,
    *,
    status: str,
    content_type: str,
    size: int,
    file_name: str = "fixture.bin",
    title: str = "Fixture",
) -> None:
    """Mint a document record shaped like finalizeDocumentRecord's output."""
    db = firestore_client()
    db.collection("users").document(uid).collection("documents").document(doc_id).set(
        {
            "docId": doc_id,
            "file_name": file_name,
            "title": title,
            "storagePath": document_storage_path(uid, doc_id),
            "contentType": content_type,
            "size": size,
            "version": 1,
            "status": status,
        }
    )


def seed_object(uid: str, doc_id: str, data: bytes, content_type: str) -> None:
    """Stage bytes in the Storage emulator at the canonical path."""
    blob = storage_bucket().blob(document_storage_path(uid, doc_id))
    blob.upload_from_string(data, content_type=content_type)


def read_status(uid: str, doc_id: str) -> str | None:
    db = firestore_client()
    snap = (
        db.collection("users").document(uid).collection("documents").document(doc_id).get()
    )
    return snap.get("status") if snap.exists else None


def object_exists(uid: str, doc_id: str) -> bool:
    return storage_bucket().blob(document_storage_path(uid, doc_id)).exists()
