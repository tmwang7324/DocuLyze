"""Claim/transition tests against the Firestore emulator (guide Phase 4).

The Claim enum is the replay-rules contract: CLAIMED / RERUN / SKIP / ABSENT.
RERUN is a guarded re-claim WRITE (refreshes claimedAt), not a read-only peek
(grill 2026-07-18).
"""

import time

import pytest
import support

from ingest.firestore_status import Claim, claim_for_processing, mark_failed

UID = "user-a"
DOC = "doc-1"

pytestmark = pytest.mark.usefixtures("clean_emulators")


def seed(status: str) -> None:
    support.seed_record(UID, DOC, status=status, content_type="text/plain", size=3)


def test_uploaded_is_claimed_and_flips_to_processing(db):
    seed("uploaded")

    assert claim_for_processing(db, UID, DOC) is Claim.CLAIMED

    assert support.read_status(UID, DOC) == "processing"


def test_processing_is_rerun_and_refreshes_claimedat(db):
    seed("uploaded")
    claim_for_processing(db, UID, DOC)
    first = _claimed_at(db)
    time.sleep(0.1)

    assert claim_for_processing(db, UID, DOC) is Claim.RERUN

    assert support.read_status(UID, DOC) == "processing"
    assert _claimed_at(db) > first  # guarded re-claim, not a read-only peek


def test_ready_and_failed_are_skip_with_no_regression(db):
    for status in ("ready", "failed"):
        seed(status)
        assert claim_for_processing(db, UID, DOC) is Claim.SKIP
        assert support.read_status(UID, DOC) == status


def test_pending_and_missing_are_absent(db):
    seed("pending")
    assert claim_for_processing(db, UID, DOC) is Claim.ABSENT
    assert support.read_status(UID, DOC) == "pending"

    assert claim_for_processing(db, UID, "no-such-doc") is Claim.ABSENT


def test_two_claims_yield_exactly_one_claimed(db):
    seed("uploaded")

    first = claim_for_processing(db, UID, DOC)
    second = claim_for_processing(db, UID, DOC)

    assert first is Claim.CLAIMED
    assert second is Claim.RERUN


def test_mark_failed_flips_processing_to_failed(db):
    seed("processing")

    mark_failed(db, UID, DOC)

    assert support.read_status(UID, DOC) == "failed"


def _claimed_at(db):
    snap = (
        db.collection("users").document(UID).collection("documents").document(DOC).get()
    )
    return snap.get("claimedAt")
