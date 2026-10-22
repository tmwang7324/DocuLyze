"""Canonical cross-service resource paths."""


def document_storage_path(uid: str, doc_id: str) -> str:
    return f"users/{uid}/documents/{doc_id}"
