"""Claim/transition tests against the Firestore emulator (issue #12 lease table).

The Claim enum is the replay-rules contract: CLAIMED / RERUN / BUSY / SKIP /
ABSENT. RERUN is a guarded re-claim WRITE (refreshes claimedAt), not a
read-only peek (grill 2026-07-18) — but it only fires once the prior claim has
gone stale past the lease TTL; a fresh claim on `processing` is BUSY, not
RERUN, so a second worker never redoes an in-flight parse.

Firestore-only (issue #12 fixture decoupling): no Storage emulator dependency.
"""

from datetime import datetime, timedelta, timezone

import pytest
import support

from ingest.config import lease_ttl_s
from ingest.firestore_status import Claim, claim_for_processing, mark_failed

UID = "user-a"
DOC = "doc-1"

pytestmark = pytest.mark.usefixtures("clean_firestore")


def seed(status: str) -> None:
    support.seed_record(UID, DOC, status=status, content_type="text/plain", size=3)


def test_uploaded_is_claimed_and_flips_to_processing(db):
    seed("uploaded")

    assert claim_for_processing(db, UID, DOC) is Claim.CLAIMED

    assert support.read_status(UID, DOC) == "processing"
    assert _claimed_at(db) is not None


def test_processing_with_fresh_claim_is_busy_and_claimedat_untouched(db):
    seed("processing")
    fresh = datetime.now(timezone.utc)
    _set_claimed_at(db, fresh)

    assert claim_for_processing(db, UID, DOC) is Claim.BUSY

    assert support.read_status(UID, DOC) == "processing"
    assert _claimed_at(db) == fresh


def test_processing_with_stale_claim_is_rerun_and_refreshes_claimedat(db):
    seed("processing")
    stale = datetime.now(timezone.utc) - timedelta(seconds=lease_ttl_s() + 60)
    _set_claimed_at(db, stale)

    assert claim_for_processing(db, UID, DOC) is Claim.RERUN

    assert support.read_status(UID, DOC) == "processing"
    assert _claimed_at(db) > stale


def test_processing_with_missing_claimedat_is_rerun(db):
    # seed() never writes claimedAt — a missing lease must be treated as
    # stale, never as "just claimed" (that would BUSY forever).
    seed("processing")

    assert claim_for_processing(db, UID, DOC) is Claim.RERUN

    assert support.read_status(UID, DOC) == "processing"
    assert _claimed_at(db) is not None


def test_ready_and_failed_are_skip_with_no_regression(db):
    for status in ("ready", "failed"):
        seed(status)
        assert claim_for_processing(db, UID, DOC) is Claim.SKIP
        assert support.read_status(UID, DOC) == status
        assert _claimed_at(db) is None  # no field changes


def test_pending_and_missing_are_absent(db):
    seed("pending")
    assert claim_for_processing(db, UID, DOC) is Claim.ABSENT
    assert support.read_status(UID, DOC) == "pending"

    assert claim_for_processing(db, UID, "no-such-doc") is Claim.ABSENT


def test_two_immediate_claims_yield_claimed_then_busy(db):
    seed("uploaded")

    first = claim_for_processing(db, UID, DOC)
    second = claim_for_processing(db, UID, DOC)

    assert first is Claim.CLAIMED
    assert second is Claim.BUSY  # fresh lease, not stale — no re-claim


def test_mark_failed_flips_processing_to_failed(db):
    seed("processing")

    mark_failed(db, UID, DOC)

    assert support.read_status(UID, DOC) == "failed"


def _doc_ref(db):
    return db.collection("users").document(UID).collection("documents").document(DOC)


def _set_claimed_at(db, when) -> None:
    _doc_ref(db).update({"claimedAt": when})


def _claimed_at(db):
    return _doc_ref(db).get().to_dict().get("claimedAt")
