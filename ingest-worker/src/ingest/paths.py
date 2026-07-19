def document_storage_path(uid: str, doc_id: str) -> str:
    """4th caller of the ONE canonical path formula.

    Mirrors documentStoragePath() in doculyze/_lib/database.tsx — the signer, the
    finalize verify, and the Firestore record all use the same shape. Do not
    derive paths any other way.
    """
    return f"users/{uid}/documents/{doc_id}"
