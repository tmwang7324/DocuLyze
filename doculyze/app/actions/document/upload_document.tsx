"use server";
import { storage } from '@/_lib/admin';
import { finalizeDocumentRecord, documentStoragePath, mintDocumentRecord, DuplicateDocumentError, SIGNED_URL_TTL_MS } from '@/_lib/database';
import { getCurrentUid } from '@/_lib/data';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { validateUploadClaim, resolveContentType, MIN_FILE_SIZE, MAX_FILE_SIZE } from '@/_lib/fileupload_schema';
import { publishIngestJob, IngestConfirmTimeoutError, IngestDisabledError } from '@/_lib/ingest_broker';
import type { FinalizeResult } from '@/_lib/ingest_contract';
import { logOperationalEvent, runWithRequestContext } from '@/_lib/operational_logger';

type DocFormState = {
    message: string;
    fileName: string | null;
    fileSize: number | null;
    fileType: string | null;
}

// `error` is set (with the url/docId/contentType blank) when the upload was
// REFUSED for a reason the user can act on — today: a duplicate document. It
// exists because a thrown server-action error reaches the browser as an opaque
// digest in production, so the reason has to travel in the return value.
export type PresignResult = {
    url: string;
    docId: string;
    contentType: string;
    error?: string;
};

export async function getPresignedUrl(
    fileName: string,
    title: string,
    size: number): Promise<PresignResult> {
    return runWithRequestContext(async () => {
    const startedAt = Date.now();
    logOperationalEvent("info", { operation: "getPresignedUrl", lifecycle: "started" });
    try {
    // Log at the server boundary: the shared schema stays client-safe and claim text stays out of logs.
    // Validate the metadata claim with zod before doing anything.
    const parsed = validateUploadClaim({ file_name: fileName, title, size });
    if (parsed !== undefined) {
        logOperationalEvent("info", {
            operation: "validateUploadClaim",
            lifecycle: "failed",
            reason: "claim_rejected",
        });
        throw new Error(parsed);
    }
    logOperationalEvent("info", { operation: "validateUploadClaim", lifecycle: "passed" });
    // Policy B: the server derives the canonical content-type from the extension, never
    // the client's file.type (see GRILL Q6). This is what gets signed, echoed by the
    // client's PUT header, and stored on the object. (The zod claim already rejected
    // unknown extensions; this narrows null away and pins the exact value we sign.)
    const contentType = resolveContentType(fileName) // ?? 'application/octet-stream'; 
    if (contentType === null) {
        throw new Error("Unsupported file type.");
    }
    try {
        const uid = await getCurrentUid();
        if (!uid) {
            redirect("/login");
        }
        const bucket = storage.bucket(process.env.FIREBASE_STORAGE_BUCKET);
        const { docId, storagePath } = await mintDocumentRecord({
            file_name: fileName,
            title,
            contentType,
            size,
            status: "pending"
        }); 
        const file = bucket.file(storagePath);
        const [url] = await file.getSignedUrl({
            action: 'write',
            version: 'v4',
            expires: Date.now() + SIGNED_URL_TTL_MS, // 15 minutes
            contentType: contentType,
            extensionHeaders: {
                'x-goog-content-length-range': `${MIN_FILE_SIZE},${MAX_FILE_SIZE}` // 1 byte to 5 MB
            }
        });
        // The client needs docId to finalize, and contentType to echo into the PUT header
        // (its own file.type is untrusted — Policy B). The signed URL pins this same type.
        logOperationalEvent("info", {
            operation: "getPresignedUrl",
            lifecycle: "succeeded",
            durationMs: Date.now() - startedAt,
        });
        return { url, docId, contentType };
    } catch (error) {
        // A duplicate is a refusal, not a fault: nothing was minted, nothing was
        // signed, and the user needs to be told WHY rather than seeing the
        // generic "couldn't get a URL". Keep the log free of that sensitive text too.
        if (error instanceof DuplicateDocumentError) {
            logOperationalEvent("warn", {
                operation: "getPresignedUrl",
                lifecycle: "rejected",
                durationMs: Date.now() - startedAt,
                reason: "duplicate_document",
            });
            return { url: "", docId: "", contentType: "", error: error.message };
        }
        logOperationalEvent("error", {
            operation: "getPresignedUrl",
            lifecycle: "failed",
            durationMs: Date.now() - startedAt,
            reason: "presign_failed",
        });
        console.error("Error generating presigned URL:", error);
        return { url: "", docId: "", contentType: "" };
    }
    } catch (error) {
        logOperationalEvent("error", {
            operation: "getPresignedUrl",
            lifecycle: "failed",
            durationMs: Date.now() - startedAt,
            reason: "validation_failed",
        });
        throw error;
    }
    });
}

// Called by the client AFTER the direct PUT to Storage succeeds. Verifies the object
// actually exists (a client can't "confirm" bytes it never uploaded), then reads the
// authoritative size/contentType from Storage metadata. The SIZE is cross-checked against
// the client's claim — GCS measures the bytes independently, so a divergence means the
// wrong bytes landed (truncation / race / tamper) and we reject. contentType is NOT
// cross-checked (GRILL Q6): it was pinned by our own signed URL from the server-resolved
// type, so the client controls both sides and a check can only false-positive — we just
// store the authoritative metadata value. The path is re-derived from the cookie uid, so a
// tampered docId can only ever touch the caller's own namespace.
export async function finalizeUpload(
    docId: string,
    fileName: string,
    size: number,
    contentType: string,
    title: string): Promise<FinalizeResult> {
    // One request context keeps storage and broker events traceable as one upload.
    return runWithRequestContext(async () => {
    const startedAt = Date.now();
    logOperationalEvent("info", { operation: "finalizeUpload", lifecycle: "started" });
    try {
    const uid = await getCurrentUid();
    if (!uid) {
        redirect("/login");
    }
    try {
        const bucket = storage.bucket(process.env.FIREBASE_STORAGE_BUCKET);
        const file = bucket.file(documentStoragePath(uid, docId));
        const [exists] = await file.exists();
        if (!exists) {
            throw new Error("Upload not found in storage — cannot finalize.");
        }
        const [metadata] = await file.getMetadata();
        const actualSize = Number(metadata.size ?? 0);
        
        // Storage is the source of truth for size — reject if the client's claim doesn't match.
        if (actualSize !== size) {
            await finalizeDocumentRecord({ docId, file_name: fileName, title, contentType: contentType, size: actualSize, status: "failed" });
            throw new Error(`Size mismatch: client claimed ${size}, storage has ${actualSize}.`);
        }
        await finalizeDocumentRecord({ docId, file_name: fileName, title, contentType: contentType, size: actualSize, status: "uploaded" });
        revalidatePath('/dashboard');
    } catch (error) {
        console.error("Error finalizing upload:", error);
        throw error;
    }
    // Flip-then-publish, swallow-and-log (GRILL 2026-07-18): the record is already
    // `uploaded`, so a broker outage must never surface as a failed upload — the
    // doc is visibly stuck-but-recoverable, not lost. Hence this sits OUTSIDE the
    // rethrowing catch above, in its own. Re-publish sweep is out of scope (#9 sibling).
    // Issue #10: the outcome is no longer swallowed silently — finalize returns the
    // three-way classification so the progress screen can be honest about it:
    //   queued  — broker durably confirmed; open the stream, run the step view.
    //   unknown — confirm timeout; the envelope MAY have landed (never say "failed").
    //   failed  — definitely not enqueued (broker down / ingest disabled); the #9
    //             sweep remains the recovery owner. Record stays `uploaded` always.
    try {
        await publishIngestJob(uid, docId);
        // Exactly one terminal event describes the same enqueue outcome we return.
        logOperationalEvent("info", {
            operation: "finalizeUpload",
            lifecycle: "queued",
            durationMs: Date.now() - startedAt,
        });
        return { enqueue: "queued" };
    } catch (err) {
        if (err instanceof IngestConfirmTimeoutError) {
            logOperationalEvent("warn", {
                operation: "finalizeUpload",
                lifecycle: "unknown",
                durationMs: Date.now() - startedAt,
                reason: "confirm_timeout",
                message: "Ingest enqueue confirmation timed out; the message may have been delivered.",
            });
            return { enqueue: "unknown" };
        }
        if (err instanceof IngestDisabledError) {
            // Expected in broker-less dev — definite non-enqueue, but not an error.
            logOperationalEvent("error", {
                operation: "finalizeUpload",
                lifecycle: "failed",
                durationMs: Date.now() - startedAt,
                reason: "ingest_disabled",
            });
            return { enqueue: "failed" };
        }
        logOperationalEvent("error", {
            operation: "finalizeUpload",
            lifecycle: "failed",
            durationMs: Date.now() - startedAt,
            reason: "ingest_enqueue_failed",
        });
        return { enqueue: "failed" };
    }
    } catch (error) {
        // The rethrow is intentional: observability must not change upload failures.
        logOperationalEvent("error", {
            operation: "finalizeUpload",
            lifecycle: "failed",
            durationMs: Date.now() - startedAt,
            reason: "storage_or_lifecycle_failed",
        });
        throw error;
    }
    });
}

// export async function createPresignedUrl(filePath: string, contentType: string): Promise<string> {
// }
// Cannot use a server action to upload the file directly because the file is too large to be sent in the request body. 
// Instead, we generate a presigned URL and return it to the client, which can then use it to upload the file directly to Firebase Storage.
// PUT request to the presigned URL with the file as the body and the content type set to the file.type.
// export async function uploadDocument(prevState: DocFormState, formData: FormData): Promise<DocFormState> {
//     //createDocumentRecord()
//     const file = formData.get('file') as File | null;
//     const title = formData.get('title') as string | null;
//     console.log(file);
//     if (!file) {
//         return {
//             message: 'Error: No file uploaded.',
//             fileName: null,
//             fileSize: null,
//             fileType: null
//         };
//     }
//     if (file.size > MAX_FILE_SIZE) {
//         return {
//             message: `Error: File size exceeds the maximum limit of ${MAX_FILE_SIZE / (1024 * 1024)} MB.`,
//             fileName: null,
//             fileSize: null,
//             fileType: null
//         };
//     }
//     if (!title) {
//         return {
//             message: 'Error: No title provided.',
//             fileName: null,
//             fileSize: null,
//             fileType: null
//         };
//     }
    
//     // add functionality to ask user if they want to replace 
//     const docId = await createDocumentRecord({ file_name: file.name, title, contentType: file.type, size: file.size});
//     console.log(`successfully created ${docId}`)
//     return {
//         message: 'success',
//         fileName: file?.name ?? null,
//         fileSize: file?.size ?? null,
//         fileType: file?.type ?? null,
//     };
// }
