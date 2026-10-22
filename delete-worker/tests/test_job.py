from datetime import datetime, timezone

from google.api_core.exceptions import NotFound

import delete_worker.job as job


class Snapshot:
    def __init__(self, *, exists=True, status="deleting"):
        self.exists = exists
        self._status = status
        self.update_time = datetime.now(timezone.utc)

    def get(self, field):
        assert field == "status"
        return self._status


class Ref:
    def __init__(self, snapshot, events):
        self.snapshot = snapshot
        self.events = events

    def get(self):
        return self.snapshot

    def delete(self, *, option):
        assert option is not None
        self.events.append("firestore")


class Blob:
    def __init__(self, events, *, absent=False):
        self.events = events
        self.absent = absent

    def delete(self):
        self.events.append("storage")
        if self.absent:
            raise NotFound("already absent")


class Bucket:
    def __init__(self, blob):
        self._blob = blob

    def blob(self, path):
        assert path == "users/user-a/documents/doc-a"
        return self._blob


def arrange(monkeypatch, *, exists=True, status="deleting", absent_blob=False):
    events = []
    ref = Ref(Snapshot(exists=exists, status=status), events)
    monkeypatch.setattr(job, "firestore_client", lambda: object())
    monkeypatch.setattr(job, "_document_ref", lambda db, uid, doc_id: ref)
    monkeypatch.setattr(job, "qdrant_client", lambda: object())
    monkeypatch.setattr(
        job,
        "delete_user_chunks",
        lambda client, uid, doc_id: events.append("qdrant"),
    )
    monkeypatch.setattr(job, "storage_bucket", lambda: Bucket(Blob(events, absent=absent_blob)))
    return events


def test_deletes_qdrant_then_storage_then_firestore(monkeypatch):
    events = arrange(monkeypatch)

    assert job.run_delete_job({"uid": "user-a", "docId": "doc-a"}) == "finished"
    assert events == ["qdrant", "storage", "firestore"]


def test_missing_storage_object_is_an_idempotent_success(monkeypatch):
    events = arrange(monkeypatch, absent_blob=True)

    assert job.run_delete_job({"uid": "user-a", "docId": "doc-a"}) == "finished"
    assert events == ["qdrant", "storage", "firestore"]


def test_absent_record_is_a_completed_replay(monkeypatch):
    events = arrange(monkeypatch, exists=False)

    assert job.run_delete_job({"uid": "user-a", "docId": "doc-a"}) == "finished"
    assert events == []


def test_refuses_to_delete_without_tombstone(monkeypatch):
    events = arrange(monkeypatch, status="ready")

    assert job.run_delete_job({"uid": "user-a", "docId": "doc-a"}) == "skipped"
    assert events == []
