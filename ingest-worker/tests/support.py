"""Seam-2 test harness: emulator reset + record/object seeding.

Python twin of doculyze/tests/helpers/harness.ts — same reset endpoint, same
seeding discipline (real emulator metadata, not mocks).
"""

import io
import os
import urllib.request

from ingest.config import firestore_client, storage_bucket
from ingest.paths import document_storage_path


def textless_pdf_fixture(text: str = "INVOICE 12345\nTotal due 90234") -> bytes:
    """A PDF whose page is one raster image of rendered text — zero text layer
    (the #18 trigger: Print-to-PDF vector glyphs / scanned page)."""
    import pymupdf

    src = pymupdf.open()
    page = src.new_page(width=400, height=200)
    page.insert_textbox(pymupdf.Rect(20, 20, 380, 180), text, fontsize=24)
    pix = page.get_pixmap(dpi=200)

    out = pymupdf.open()
    dst = out.new_page(width=400, height=200)
    dst.insert_image(pymupdf.Rect(0, 0, 400, 200), pixmap=pix)
    buf = io.BytesIO()
    out.save(buf)
    data = buf.getvalue()
    assert pymupdf.open(stream=data, filetype="pdf")[0].get_text() == ""  # precondition
    return data


def reset_firestore() -> None:
    """Wipe Firestore docs only — no Storage emulator dependency (issue #12)."""
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


def reset_emulators() -> None:
    """Wipe Firestore docs + Storage objects so each case starts empty."""
    reset_firestore()
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
