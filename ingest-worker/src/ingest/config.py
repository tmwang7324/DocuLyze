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


def parse_timeout_s() -> float:
    return float(os.environ.get("PARSE_TIMEOUT_S", "20"))


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
    print(f"PARSE_TIMEOUT_S       = {parse_timeout_s()}")
    print(f"FIRESTORE_EMULATOR    = {os.environ.get('FIRESTORE_EMULATOR_HOST') or 'REAL'}")
    print(f"STORAGE_EMULATOR      = {os.environ.get('STORAGE_EMULATOR_HOST') or 'REAL'}")
    firebase_app()
    print("firebase_admin initialized OK")
