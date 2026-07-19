"""Pytest bootstrap: src on sys.path + the never-hit-production guard.

Mirrors doculyze/tests/setup/emulator-env.ts in spirit, but inverted: instead of
refusing to run without emulator env, we PIN the emulator hosts before anything
imports the SDKs — so these tests structurally cannot reach production Firestore
or Storage. If the emulators aren't running, tests fail with connection refused
(safe), never with a production write.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8085")
os.environ.setdefault("STORAGE_EMULATOR_HOST", "http://127.0.0.1:9199")
os.environ.setdefault("FIREBASE_STORAGE_EMULATOR_HOST", "127.0.0.1:9199")
os.environ.setdefault("FIREBASE_STORAGE_BUCKET", "doculyze.firebasestorage.app")
os.environ.setdefault("GCLOUD_PROJECT", "doculyze")
# Same credential the Node harness uses; requests still go to the emulators
# because the *_EMULATOR_HOST vars above always win.
os.environ.setdefault(
    "GOOGLE_APPLICATION_CREDENTIALS", str(ROOT.parent / "doculyze" / "serviceAccount.json")
)

import pytest  # noqa: E402


@pytest.fixture()
def db():
    from ingest.config import firestore_client

    return firestore_client()


@pytest.fixture()
def clean_emulators():
    """Wipe Firestore docs + Storage objects so each case starts empty."""
    import support

    support.reset_emulators()
