"use server";

import { FieldValue } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { storage } from "@/_lib/admin";
import { requireUid } from "@/_lib/data";
import { documentRef, documentStoragePath } from "@/_lib/database";
import { publishDeleteJob } from "@/_lib/delete_broker";
import { logOperationalEvent, runWithRequestContext } from "@/_lib/operational_logger";

const READ_URL_TTL_MS = 5 * 60 * 1000;

export type RemoveDocumentResult = {
    ok: true;
    state: "deleting" | "absent";
};

function requireDocumentId(docId: string): string {
    // Firestore-generated IDs use this alphabet. Rejecting path separators also
    // constrains the caller to one record in the authenticated user's collection.
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(docId)) {
        throw new Error("Invalid document ID.");
    }
    return docId;
}

function attachmentDisposition(fileName: string): string {
    const fallback = fileName
        .normalize("NFKD")
        .replace(/[^\x20-\x7E]/g, "_")
        .replace(/["\\\r\n]/g, "_") || "document";

    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Authorize one document and mint a short-lived download URL for its original
 * bytes. The Storage path is derived from the verified user and document ID;
 * no client-supplied path is trusted.
 */
export async function getReadPresignedURL(docId: string): Promise<string> {
    return runWithRequestContext(async () => {
        const startedAt = Date.now();
        logOperationalEvent("info", { operation: "getReadPresignedURL", lifecycle: "started" });

        try {
            const uid = await requireUid();
            const safeDocId = requireDocumentId(docId);
            const snapshot = await documentRef(uid, safeDocId).get();

            if (!snapshot.exists) throw new Error("Document not found.");
            if (snapshot.get("status") === "deleting") {
                throw new Error("Document is being removed.");
            }

            const fileName = snapshot.get("file_name");
            if (typeof fileName !== "string" || fileName.length === 0) {
                throw new Error("Document filename is missing.");
            }

            const file = storage
                .bucket(process.env.FIREBASE_STORAGE_BUCKET)
                .file(documentStoragePath(uid, safeDocId));
            const [exists] = await file.exists();
            if (!exists) throw new Error("Document file is not available.");

            const [url] = await file.getSignedUrl({
                action: "read",
                version: "v4",
                expires: Date.now() + READ_URL_TTL_MS,
                responseDisposition: attachmentDisposition(fileName),
            });

            logOperationalEvent("info", {
                operation: "getReadPresignedURL",
                lifecycle: "succeeded",
                durationMs: Date.now() - startedAt,
                docId: safeDocId,
            });
            return url;
        } catch (error) {
            logOperationalEvent("error", {
                operation: "getReadPresignedURL",
                lifecycle: "failed",
                durationMs: Date.now() - startedAt,
                reason: "read_presign_failed",
            });
            throw error;
        }
    });
}

/**
 * Record deletion intent. Physical cleanup belongs to the deletion worker in
 * the next slice; deleting only Firestore and Storage here could orphan vectors
 * or race an active ingest job.
 */
export async function removeDocument(docId: string): Promise<RemoveDocumentResult> {
    return runWithRequestContext(async () => {
        const startedAt = Date.now();
        logOperationalEvent("info", { operation: "removeDocument", lifecycle: "started" });

        try {
            const uid = await requireUid();
            const safeDocId = requireDocumentId(docId);
            const ref = documentRef(uid, safeDocId);
            const state = await ref.firestore.runTransaction(async (transaction) => {
                const snapshot = await transaction.get(ref);
                if (!snapshot.exists) return "absent" as const;
                if (snapshot.get("status") !== "deleting") {
                    transaction.update(ref, {
                        status: "deleting",
                        deleteRequestedAt: FieldValue.serverTimestamp(),
                        version: FieldValue.increment(1),
                    });
                }
                return "deleting" as const;
            });

            if (state === "deleting") {
                await publishDeleteJob(uid, safeDocId);
            }

            revalidatePath("/dashboard");
            logOperationalEvent("info", {
                operation: "removeDocument",
                lifecycle: "succeeded",
                durationMs: Date.now() - startedAt,
                docId: safeDocId,
                state,
            });
            return { ok: true, state };
        } catch (error) {
            logOperationalEvent("error", {
                operation: "removeDocument",
                lifecycle: "failed",
                durationMs: Date.now() - startedAt,
                reason: "delete_request_failed",
            });
            throw error;
        }
    });
}
