"""Env-driven configuration + one-time Firebase Admin initialization.

Safety boundary (repo invariant, refined 2026-07-18): this worker's ONLY writes
are Firestore status transitions — Storage is strictly read-only to it. That is
what makes the mixed dev mode legal (FIRESTORE_EMULATOR_HOST set while Storage
stays real, mirroring doculyze/.env.local): an emulated-Firestore worker reading
real GCS bytes can never write production.

Env vars honored by the underlying SDKs (never baked into the image):
  FIRESTORE_EMULATOR_HOST   e.g. host.docker.internal:8085 (dev override / tests)
  STORAGE_EMULATOR_HOST     e.g. http://127.0.0.1:9199     (tests only)
"""

import logging
import os

log = logging.getLogger("ingest")

_app = None


def rabbitmq_url() -> str | None:
    return os.environ.get("RABBITMQ_URL")


def ingest_queue() -> str:
    return os.environ.get("INGEST_QUEUE", "doc.ingest")


def retry_queue() -> str:
    return os.environ.get("INGEST_RETRY_QUEUE", f"{ingest_queue()}.retry")


def retry_delay_ms() -> int:
    return int(os.environ.get("INGEST_RETRY_DELAY_MS", "300000"))


def parse_timeout_s() -> float:
    return float(os.environ.get("PARSE_TIMEOUT_S", "20"))


def ocr_timeout_s() -> float:
    # The OCR fallback runs in its OWN sandbox call with this budget — NOT the
    # tight PARSE_TIMEOUT_S. OCR is ~10s/page on CPU, so this must exceed
    # OCR_MAX_PAGES * per-page cost. It only fires after the fast text pass
    # returned near-empty (so it can't be masking a normal-PDF hang).
    return float(os.environ.get("OCR_TIMEOUT_S", "180"))


def ocr_max_pages() -> int:
    # Bound the worst-case OCR runtime (and queue head-of-line blocking, prefetch=1).
    return int(os.environ.get("OCR_MAX_PAGES", "15"))


def pdf_ocr_min_chars() -> int:
    # Below this many non-whitespace/non-markdown chars, a PDF's text pass is
    # treated as "no text layer" and the OCR fallback runs. The no-text case
    # yields 0; real pages yield hundreds — a wide margin.
    return int(os.environ.get("PDF_OCR_MIN_CHARS", "16"))


def docling_timeout_s() -> float:
    # Docling conversions (docx/html/xml and the PDF-OCR fallback) run in their
    # OWN sandbox call with this budget — separate from the tight PARSE_TIMEOUT_S
    # text path. Docling's import + backend spin-up alone is ~10-30s, so this
    # must comfortably exceed that plus the conversion itself.
    return float(os.environ.get("DOCLING_TIMEOUT_S", "60"))


def docling_artifacts_path() -> str | None:
    # Directory of pre-downloaded Docling models (layout/tableformer/rapidocr).
    # Unset -> None, which lets Docling use its own default cache; the container
    # sets this to the baked /opt/docling-models dir so conversions run offline.
    return os.environ.get("DOCLING_ARTIFACTS_PATH") or None


def lease_ttl_s() -> int:
    # Processing-lease TTL (issue #12): must exceed worst-case job runtime —
    # since #18 that is a fast pdf pass (PARSE_TIMEOUT_S, 20s) followed by the
    # OCR fallback (OCR_TIMEOUT_S, 180s), ~200s total — or a still-live claim
    # would look stale and get RERUN out from under its own worker.
    return int(os.environ.get("INGEST_LEASE_TTL_S", "300"))


def firebase_app():
    """Initialize firebase_admin exactly once and return the app.

    Credentials come from GOOGLE_APPLICATION_CREDENTIALS (mounted, not baked).
    The boot log names which Firestore this process talks to so a mis-wired
    environment is visible in the first log lines.
    """
    global _app
    if _app is None:
        import firebase_admin
        from firebase_admin import credentials

        bucket = os.environ["FIREBASE_STORAGE_BUCKET"]  # required; fail loudly
        _app = firebase_admin.initialize_app(
            credentials.ApplicationDefault(), {"storageBucket": bucket}
        )
        log.info(
            "firebase initialized: firestore=%s storage=%s bucket=%s",
            os.environ.get("FIRESTORE_EMULATOR_HOST") or "REAL",
            os.environ.get("STORAGE_EMULATOR_HOST") or "REAL",
            bucket,
        )
    return _app


def firestore_client():
    firebase_app()
    from firebase_admin import firestore

    return firestore.client()


def storage_bucket():
    firebase_app()
    from firebase_admin import storage

    return storage.bucket()


if __name__ == "__main__":
    # Smoke check: `python -m ingest.config` prints resolved config and proves
    # Firebase Admin initializes without touching business logic.
    logging.basicConfig(level=logging.INFO)
    print(f"RABBITMQ_URL          = {rabbitmq_url() or '(unset — ingest disabled)'}")
    print(f"INGEST_QUEUE          = {ingest_queue()}")
    print(f"INGEST_RETRY_QUEUE    = {retry_queue()}")
    print(f"INGEST_RETRY_DELAY_MS = {retry_delay_ms()}")
    print(f"PARSE_TIMEOUT_S       = {parse_timeout_s()}")
    print(f"DOCLING_TIMEOUT_S     = {docling_timeout_s()}")
    print(f"OCR_TIMEOUT_S         = {ocr_timeout_s()}")
    print(f"OCR_MAX_PAGES         = {ocr_max_pages()}")
    print(f"PDF_OCR_MIN_CHARS     = {pdf_ocr_min_chars()}")
    print(f"DOCLING_ARTIFACTS     = {docling_artifacts_path() or '(unset — Docling cache)'}")
    print(f"INGEST_LEASE_TTL_S    = {lease_ttl_s()}")
    print(f"FIRESTORE_EMULATOR    = {os.environ.get('FIRESTORE_EMULATOR_HOST') or 'REAL'}")
    print(f"STORAGE_EMULATOR      = {os.environ.get('STORAGE_EMULATOR_HOST') or 'REAL'}")
    firebase_app()
    print("firebase_admin initialized OK")
