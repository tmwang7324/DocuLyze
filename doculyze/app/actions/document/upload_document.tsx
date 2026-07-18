"use server";
import { storage } from '@/_lib/admin';
import { newDocumentPath, finalizeDocumentRecord, documentStoragePath, mintDocumentRecord } from '@/_lib/database';
import { getCurrentUid } from '@/_lib/data';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { validateUploadClaim, resolveContentType, MIN_FILE_SIZE, MAX_FILE_SIZE } from '@/_lib/fileupload_schema';

type DocFormState = {
    message: string;
    fileName: string | null;
    fileSize: number | null;
    fileType: string | null;
}

export async function getPresignedUrl(
    fileName: string,
    title: string,
    size: number): Promise<{ url: string; docId: string; contentType: string }> {
    // Validate the metadata claim with zod before doing anything.
    const parsed = validateUploadClaim({ file_name: fileName, title, size });
    if (parsed !== undefined) {
        throw new Error(parsed);
    }
    // Policy B: the server derives the canonical content-type from the extension, never
    // the client's file.type (see GRILL Q6). This is what gets signed, echoed by the
    // client's PUT header, and stored on the object. (The zod claim already rejected
    // unknown extensions; this narrows null away and pins the exact value we sign.)
    const contentType = resolveContentType(fileName);
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
            expires: Date.now() + 15 * 60 * 1000, // URL expires in 15 minutes
            contentType: contentType,
            extensionHeaders: {
                'x-goog-content-length-range': `${MIN_FILE_SIZE},${MAX_FILE_SIZE}` // 1 byte to 5 MB
            }
        });
        // The client needs docId to finalize, and contentType to echo into the PUT header
        // (its own file.type is untrusted — Policy B). The signed URL pins this same type.
        return { url, docId, contentType };
    } catch (error) {
        console.error("Error generating presigned URL:", error);
        throw error;
    }
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
    title: string): Promise<void> {
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
        const actualType = metadata.contentType ?? "application/octet-stream";
        // Storage is the source of truth for size — reject if the client's claim doesn't match.
        if (actualSize !== size) {
            await finalizeDocumentRecord({ docId, file_name: fileName, title, contentType: actualType, size: actualSize, status: "failed" });
            throw new Error(`Size mismatch: client claimed ${size}, storage has ${actualSize}.`);
        }
        await finalizeDocumentRecord({ docId, file_name: fileName, title, contentType: actualType, size: actualSize, status: "uploaded" });
        revalidatePath('/dashboard');
    } catch (error) {
        console.error("Error finalizing upload:", error);
        throw error;
    }
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