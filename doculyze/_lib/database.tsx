import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db, storage } from "@/_lib/admin";
import { requireUid } from "@/_lib/data";
import { formatBytes } from "@/_lib/fileupload_schema";
import { logOperationalEvent } from "@/_lib/operational_logger";
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

// Firestore ref for one document record. Exported for the SSE stream route
// (issue #10) — the one consumer outside the DAL that needs the exact record
// ref (to attach a snapshot listener), and the ref formula must not be
// re-derived there (same one-place rationale as documentStoragePath below).
export function documentRef(uid: string, docId: string) {
    return documentsCol(uid).doc(docId);
}


// Create a doc-ref record under the *verified* user. The caller never supplies a
// uid — it comes from the session cookie — so cross-user writes are impossible.
// The docId is server-generated (random, immutable, path-safe), never the title.
export async function createUserProfile(input: { 
    email: string, 
    password: string, 
    sessionCookie: string 
}): Promise<string> {
    const startedAt = Date.now();
    try {
        const uid = await requireUid();
        await db.collection("users").doc(uid).set({
            email: input.email,
            password: input.password,
            sessionCookie: input.sessionCookie
        }, { merge: true });
        // Profile writes identify only the authenticated owner; credentials and contact data never leave the DAL.
        logOperationalEvent("info", {
            operation: "createUserProfile",
            lifecycle: "succeeded",
            durationMs: Date.now() - startedAt,
            userId: uid,
        });
        return uid;
    } catch (error) {
        logOperationalEvent("error", {
            operation: "createUserProfile",
            lifecycle: "failed",
            durationMs: Date.now() - startedAt,
        });
        throw error;
    }
}

// Storage object path for a user's document, keyed by the server docId (NOT the
// filename): users/{uid}/documents/{docId}. This is the ONE place the path formula
// lives — the signer, the metadata verify, and the Firestore record all call it, so
// they can't drift and same-name uploads can't collide.
export function documentStoragePath(uid: string, docId: string): string {
    return `users/${uid}/documents/${docId}`;
}



// How long a presigned write URL stays valid. Lives here, next to the pending
// lifetimes it defines, because two rules are derived from it: the signer's
// `expires` (upload_document.tsx) and the duplicate gate's "is this pending
// upload still live?" test below. A drift between those would either block
// retries or let a double-submit through.
export const SIGNED_URL_TTL_MS = 15 * 60 * 1000; // 15 minutes

// --- Duplicate gate ---------------------------------------------------------
// Identity is (file_name, size), with the name compared case-INSENSITIVELY:
// same name AND same byte count means the same document, per product rule.
// "Report.pdf" and "report.pdf" at the same size are one document — the case a
// file picker hands over depends on the OS and on which copy of the file the
// user reached for, so it can't be part of identity. No content hash — the bytes
// never pass through the server (they go straight to Storage), so hashing would
// mean downloading every candidate.
//
// Which existing records block a new upload of that pair:
//   processing / ready — already queued; block.
export class DuplicateDocumentError extends Error {
    constructor(
        message: string,
        readonly existingDocId: string,
        readonly existingStatus: DocStatus,
    ) {
        super(message);
        this.name = "DuplicateDocumentError";
    }
}

function blocksDuplicate(status: unknown): boolean {
    return status === "processing" || status === "ready" || status === "pending";
}

// Do these two filenames name the same document? Case-insensitive, and both
// sides go through the same fold, so the comparison is symmetric.
function sameDocumentName(a: unknown, b: string): boolean {
    return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

// `fileName` is the EXISTING record's name, not the one just attempted: when the
// two differ only in case, the stored spelling is the one the user will find in
// their archive, so quoting theirs would send them looking for a name that isn't
// listed.
function duplicateMessage(fileName: string, size: number, status: DocStatus): string {
    if (status === "pending") {
        return `"${fileName}" is already being uploaded — wait for that upload to finish before sending it again.`;
    }
    return `"${fileName}" (${formatBytes(size)}) is already in your documents — duplicate uploads aren't allowed.`;
}

// Mint the pending record for a new upload, rejecting duplicates.
//
// The duplicate query and the write share ONE transaction on purpose: the
// query's read lock is what serializes two simultaneous presigns of the same
// file. A check made before the transaction would let both callers pass it and
// both mint, which is exactly the double-submit case the gate is for.
//
// The query carries only `size`; name and status are matched in memory. Size is
// the selective half (an exact byte count), and neither of the other two can be
// a filter: Firestore equality is case-SENSITIVE, and blocksDuplicate is
// time-dependent. Keeping the name out of the query is also why this needed no
// normalized `file_name_lower` column — which finalizeDocumentRecord would have
// had to maintain in lockstep with file_name, and which every record written
// before this gate existed would have needed backfilled. One equality filter
// rides the default single-field index, so firestore.indexes.json is untouched.
//
// Throws DuplicateDocumentError — an expected rejection carrying a
// user-presentable reason, not a fault.
export async function mintDocumentRecord(input: {
    file_name: string;
    title: string;
    contentType: string;
    size: number;
    status: string;
}): Promise<{ docId: string; storagePath: string }> {
    const startedAt = Date.now();
    try {
        const uid = await requireUid();
        const docId = documentsCol(uid).doc().id;
        const storagePath = documentStoragePath(uid, docId);
        const sameSize = documentsCol(uid).where("size", "==", input.size);
        await db.runTransaction(async (tx) => {
            const existing = await tx.get(sameSize);
            for (const doc of existing.docs) {
                const fileName = doc.get("file_name") as unknown;
                if (!sameDocumentName(fileName, input.file_name)) continue;
                const status = doc.get("status") as DocStatus;
                if (blocksDuplicate(status)) {
                    throw new DuplicateDocumentError(
                        duplicateMessage(fileName as string, input.size, status),
                        doc.id,
                        status,
                    );
                }
            }
            tx.set(documentsCol(uid).doc(docId), {
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
        });
        // The generated ID and state identify the write without revealing user-supplied document metadata.
        logOperationalEvent("info", {
            operation: "mintDocumentRecord",
            lifecycle: "succeeded",
            durationMs: Date.now() - startedAt,
            docId,
            status: input.status,
        });
        return { docId, storagePath: storagePath };
    } catch (error) {
        // Duplicate messages include the stored filename, so classify the expected rejection without serializing it.
        const duplicate = error instanceof DuplicateDocumentError;
        logOperationalEvent(duplicate ? "warn" : "error", {
            operation: "mintDocumentRecord",
            lifecycle: duplicate ? "rejected" : "failed",
            durationMs: Date.now() - startedAt,
            ...(duplicate ? { reason: "duplicate_document" } : {}),
        });
        throw error;
    }
}

export async function finalizeDocumentRecord(input: {
    docId: string;
    file_name: string;
    title: string;
    contentType: string;
    size: number;
    status: string;
}): Promise<void> {
    const startedAt = Date.now();
    try {
        const uid = await requireUid();
        await documentsCol(uid).doc(input.docId).update({
            file_name: input.file_name,
            title: input.title,
            contentType: input.contentType,
            size: input.size,
            status: input.status,
            uploadedAt: FieldValue.serverTimestamp(),
        });
        // This write is keyed by docId; status is sufficient operational context without logging document metadata.
        logOperationalEvent("info", {
            operation: "finalizeDocumentRecord",
            lifecycle: "succeeded",
            durationMs: Date.now() - startedAt,
            docId: input.docId,
            status: input.status,
        });
    } catch (error) {
        logOperationalEvent("error", {
            operation: "finalizeDocumentRecord",
            lifecycle: "failed",
            durationMs: Date.now() - startedAt,
        });
        throw error;
    }
}

// A pending record is "stale" once it's older than this. Must stay comfortably
// above the 15-minute signed-URL expiry (SIGNED_URL_TTL_MS): past expiry no
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
    const startedAt = Date.now();
    try {
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
        // Counts reveal cleanup health without identifying any abandoned document.
        logOperationalEvent("info", {
            operation: "reapStalePendingDocuments",
            lifecycle: "succeeded",
            durationMs: Date.now() - startedAt,
            reapedCount: reaped,
        });
        return reaped;
    } catch (error) {
        logOperationalEvent("error", {
            operation: "reapStalePendingDocuments",
            lifecycle: "failed",
            durationMs: Date.now() - startedAt,
        });
        throw error;
    }
}

// List the verified user's documents, newest first. Returns EVERY lifecycle state
// (pending / uploaded / failed / …) so the dashboard can render them distinguishably
// (#2 checkbox 5). The previous status == "uploaded" filter hid pending and failed,
// which made abandoned and rejected uploads invisible to their own owner.
export async function listDocuments(): Promise<DocumentRecord[]> {
    const startedAt = Date.now();
    try {
        const uid = await requireUid(false);
        const snap = await documentsCol(uid).orderBy("uploadedAt", "desc").get();
        const documents = snap.docs.map((d) => ({ docId: d.id, ...(d.data() as Omit<DocumentRecord, "docId">) }));
        // Aggregate lifecycle state, never document fields, so dashboard reads stay observable without exposing content.
        const statusCounts = documents.reduce<Record<string, number>>((counts, document) => {
            counts[document.status] = (counts[document.status] ?? 0) + 1;
            return counts;
        }, {});
        logOperationalEvent("info", {
            operation: "listDocuments",
            lifecycle: "succeeded",
            durationMs: Date.now() - startedAt,
            documentCount: documents.length,
            statusCounts,
        });
        return documents;
    } catch (error) {
        logOperationalEvent("error", {
            operation: "listDocuments",
            lifecycle: "failed",
            durationMs: Date.now() - startedAt,
        });
        throw error;
    }
}
