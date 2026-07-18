import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/_lib/admin";
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
    size: number;
    status: string;
}): Promise<void> {
    const uid = await requireUid();
    await documentsCol(uid).doc(input.docId).update({
        file_name: input.file_name,
        title: input.title,
        size: input.size,
        status: input.status,
        uploadedAt: FieldValue.serverTimestamp(),
    });
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
