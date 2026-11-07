"""Environment-driven broker, Firebase, and Storage configuration."""

import logging
import json
import os

log = logging.getLogger("delete-worker")
_app = None


def rabbitmq_url() -> str | None:
    return os.environ.get("RABBITMQ_URL")


def delete_queue() -> str:
    return os.environ.get("DELETE_QUEUE", "doc.delete")


def firebase_app():
    """Initialize Firebase Admin exactly once using environment or default credentials."""
    global _app
    if _app is None:
        import firebase_admin
        from firebase_admin import credentials

        bucket = os.environ["FIREBASE_STORAGE_BUCKET"]
        service_account = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        credential = (credentials.Certificate(json.loads(service_account)) if service_account
                      else credentials.ApplicationDefault())
        _app = firebase_admin.initialize_app(credential, {"storageBucket": bucket})
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
