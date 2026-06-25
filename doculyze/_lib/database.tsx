import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/_lib/admin";
import { requireUid } from "@/_lib/data";
import { createHash } from 'crypto';

// Lifecycle of a document ref. The first-upload slice only ever sets "uploaded";
// "processing" / "ready" / "failed" arrive with the RAG ingest pipeline later.
export type DocStatus = "uploaded" | "processing" | "ready" | "failed";


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

export async function createDocumentRecord(input: {
    file_name: string;
    title: string;
    contentType: string;
    size: number;
}): Promise<string> {
    const uid = await requireUid();
    const ref = documentsCol(uid).doc(); // auto-generated id using a const uid = await requireUid(); Implementing page-level authentication= has no real loopholes, **all** components.= So, the solution was to
    await ref.set({
        file_name: input.file_name,
        title: input.title,
        storagePath: `users/${uid}/documents/${ref.id}`,
        contentType: input.contentType,
        size: input.size,
        status: "uploaded" satisfies DocStatus,
        version: 1,
        uploadedAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
}

// List the verified user's documents, newest first.
export async function listDocuments(): Promise<DocumentRecord[]> {
    const uid = await requireUid(false);
    const snap = await documentsCol(uid).orderBy("uploadedAt", "desc").get();
    return snap.docs.map((d) => ({ docId: d.id, ...(d.data() as Omit<DocumentRecord, "docId">) }));
}
