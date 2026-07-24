"""Transaction-guarded status transitions (guide Phase 4) — the replay rules.

One legal transition per call; the caller acts on the returned Claim. The
transaction serializes racing claimants: two workers on the same `uploaded`
record yield exactly one CLAIMED. `ready`/`failed` never regress, so a manual
DLQ replay can never clobber a resolved record.
"""

from enum import Enum
import logging
from datetime import datetime, timezone
from firebase_admin import firestore

from ingest.config import lease_ttl_s

log = logging.getLogger("ingest")


class Claim(Enum):
    CLAIMED = "claimed"  # uploaded -> processing, proceed to parse
    RERUN = "rerun"      # already processing (crash-after-claim redelivery) -> re-parse
    BUSY = "busy"        # already processing but claim is recent, wait and retry
    SKIP = "skip"        # ready/failed -> ack, no-op (no regression)
    ABSENT = "absent"    # pending or missing -> log warning, ack


def _doc_ref(db, uid: str, doc_id: str):
    return db.collection("users").document(uid).collection("documents").document(doc_id)


def claim_for_processing(db, uid: str, doc_id: str) -> Claim:
    ref = _doc_ref(db, uid, doc_id)

    @firestore.transactional
    def txn(tx) -> Claim:
        snap = ref.get(transaction=tx)
        if not snap.exists:
            log.info(f"Document {doc_id} for user {uid} is absent.")
            return Claim.ABSENT
        status = snap.get("status")
        if status == "uploaded":
            tx.update(ref, {"status": "processing", "claimedAt": firestore.SERVER_TIMESTAMP})
            return Claim.CLAIMED
        if status == "processing":
            # Guarded re-claim, not a read-only peek (grill 2026-07-18): keeps
            # contention behavior correct when consumers multiply. `snap.get`
            # takes no default (KeyError on a missing field), so read through
            # to_dict() instead. A missing claimedAt is treated as stale —
            # never as "just claimed", which would BUSY forever.
            claimed_at = snap.to_dict().get("claimedAt")
            stale = claimed_at is None or (
                datetime.now(timezone.utc) - claimed_at
            ).total_seconds() > lease_ttl_s()
            if stale:
                tx.update(ref, {"claimedAt": firestore.SERVER_TIMESTAMP})
                return Claim.RERUN
            return Claim.BUSY
        if status in ("ready", "failed"):
            return Claim.SKIP
        log.info(f"Document {doc_id} for user {uid} has unexpected status: {status}.")
        return Claim.ABSENT  # "pending" or unknown

    return txn(db.transaction())

def mark_failed(db, uid: str, doc_id: str) -> None:
    """processing -> failed, flag-only. Never touches Storage (bytes retained)."""
    _doc_ref(db, uid, doc_id).update({"status": "failed"})
