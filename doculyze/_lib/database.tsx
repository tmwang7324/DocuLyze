import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db, storage } from "@/_lib/admin";
import { requireUid } from "@/_lib/data";
import { createHash } from 'crypto';


// Lifecycle of a document ref. The first-upload slice only ever sets "uploaded";
// "processing" / "ready" / "failed" arrive with the RAG ingest pipeline later.
export type DocStatus = "uploaded" | "processing" | "ready" | "failed" | "pending" | "";


export type DocumentRecord = {
    docId: string; // random unique document ID
    file_name: string; // original name of the uploaded file
    title: string, // title of document given by user
    storagePath: string; // path in the storage where the file is stored ex. "users/{uid}/documents/{docId}"
    contentType: string; // MIME type of the file ex. "application/pdf"
    size: number; // size of the file in bytes
    status: DocStatus; // current status of the document
    version: number; // version number of the document, incremented with each update
    uploadedAt?: FieldValue; // timestamp of when the document was uploaded
};

export type UserRecord = {
    email: string,
    password: string,
    sessionCookie: string
};

// Path to a user's document subcollection: users/{uid}/documents
function documentsCol(uid: string) {
    return db.collection("users").doc(uid).collection("documents");
}


// Create a doc-ref record under the *verified* user. The caller never supplies a
// uid — it comes from the session cookie — so cross-user writes are impossible.
// The docId is server-generated (random, immutable, path-safe), never the title.
export async function createUserProfile(input: { 
    email: string, 
    password: string, 
    sessionCookie: string 
}): Promise<string> {
    const uid = await requireUid();
    db.collection("users").doc(uid).set({
        email: input.email,
        password: input.password,
        sessionCookie: input.sessionCookie
    }, { merge: true });
    return uid;
}

// Storage object path for a user's document, keyed by the server docId (NOT the
// filename): users/{uid}/documents/{docId}. This is the ONE place the path formula
// lives — the signer, the metadata verify, and the Firestore record all call it, so
// they can't drift and same-name uploads can't collide.
export function documentStoragePath(uid: string, docId: string): string {
    return `users/${uid}/documents/${docId}`;
}



export async function mintDocumentRecord(input: {
    file_name: string;
    title: string;
    contentType: string;
    size: number;
    status: string;
}): Promise<{ docId: string; storagePath: string }> {
    const uid = await requireUid();
    const docId = documentsCol(uid).doc().id;
    const storagePath = documentStoragePath(uid, docId);
    await documentsCol(uid).doc(docId).set({
        docId: docId,
        file_name: input.file_name,
        title: input.title,
        storagePath: storagePath,
        contentType: input.contentType,
        size: input.size,
        version: 1,
        status: input.status,
        uploadedAt: FieldValue.serverTimestamp(),
    });
    return { docId, storagePath: storagePath };
}

export async function finalizeDocumentRecord(input: {
    docId: string;
    file_name: string;
    title: string;
    contentType: string;
    size: number;
    status: string;
}): Promise<void> {
    const uid = await requireUid();
    await documentsCol(uid).doc(input.docId).update({
        file_name: input.file_name,
        title: input.title,
        contentType: input.contentType,
        size: input.size,
        status: input.status,
        uploadedAt: FieldValue.serverTimestamp(),
    });
}

// A pending record is "stale" once it's older than this. Must stay comfortably
// above the 15-minute signed-URL expiry (upload_document.tsx): past expiry no
// new PUT can start, so a pending record this old can only be an abandoned
// upload — never one still in flight (#3 checkbox 4).
export const STALE_PENDING_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// Reap the verified user's abandoned uploads: pending records older than the
// age threshold. Selection is an indexed Firestore query on status + uploadedAt
// (composite index in firestore.indexes.json) — never a bucket walk.
//
// Per stale record: the record is deleted FIRST, guarded by a lastUpdateTime
// precondition, and only then the Storage object. The precondition is the race
// guard against a late finalize (finalize has no time bound — only the PUT is
// limited by the 15-min URL): whichever of finalize-update / reap-delete lands
// first at Firestore wins, so we can never delete the bytes of a record that
// just became `uploaded`. Record-first ordering is what makes that guard
// protect the OBJECT too — object-first would delete bytes before the
// precondition could veto. The cost: a crash between the two deletes strands
// an unreachable Storage object (invisible, pennies) instead of a pending
// record retried next pass — the user-visible orphan (an `uploaded` record
// with no bytes) is the one this ordering makes impossible.
// Returns the number of records reaped.
export async function reapStalePendingDocuments(): Promise<number> {
    // checkRevoked off, despite being a write: reap rides the dashboard's hot
    // read path, and it only ever deletes the caller's own already-abandoned
    // pending records — nothing a revoked session could gain from.
    const uid = await requireUid(false);
    const cutoff = Timestamp.fromMillis(Date.now() - STALE_PENDING_MAX_AGE_MS);
    const stale = await documentsCol(uid)
        .where("status", "==", "pending")
        .where("uploadedAt", "<=", cutoff)
        .get();
    let reaped = 0;
    for (const doc of stale.docs) {
        const storagePath = doc.get("storagePath") as string;
        try {
            await doc.ref.delete({ lastUpdateTime: doc.updateTime });
        } catch {
            // Precondition failed: the record changed since the query (e.g. a
            // late finalize flipped it). It's no longer ours to reap — and its
            // bytes are untouched.
            continue;
        }
        await storage
            .bucket(process.env.FIREBASE_STORAGE_BUCKET)
            .file(storagePath)
            .delete({ ignoreNotFound: true }); // "if the bytes landed" — a never-PUT upload has no object
        reaped++;
    }
    return reaped;
}

// List the verified user's documents, newest first. Returns EVERY lifecycle state
// (pending / uploaded / failed / …) so the dashboard can render them distinguishably
// (#2 checkbox 5). The previous status == "uploaded" filter hid pending and failed,
// which made abandoned and rejected uploads invisible to their own owner.
export async function listDocuments(): Promise<DocumentRecord[]> {
    const uid = await requireUid(false);
    const snap = await documentsCol(uid).orderBy("uploadedAt", "desc").get();
    return snap.docs.map((d) => ({ docId: d.id, ...(d.data() as Omit<DocumentRecord, "docId">) }));
}
