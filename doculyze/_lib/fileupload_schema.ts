import { z } from "zod";

// ---------------------------------------------------------------------------
// Canonical upload rules — the ONE source of truth shared by:
//   • the client dropzone  → File-based `fileSchema` (UX gating, in the component)
//   • the server action    → claim-based `uploadClaimSchema` (the trust boundary)
//
// A server action NEVER receives the File — the bytes go straight to Storage via
// the presigned URL — so it can't run a File schema. It validates the *claim*
// (the metadata the client sends) instead, built from these same constants so the
// two gates can't drift. Neutral module: no "use client" / "server-only", so both
// the client component and the server action can import it.
// See GRILL-ME-storage-upload-auth-2026-07-11.md (Q3).
// ---------------------------------------------------------------------------

// contentType allowlist (the "gate" — what the server is willing to sign).
export const ACCEPTED_TYPES: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain": ".txt",
    "application/json": ".json",
    "application/javascript": ".js",
    "application/typescript": ".ts",
    "application/xml": ".xml",
    "application/x-python": ".py",
    "text/markdown": ".md",
    "text/html": ".html",
    "text/css": ".css",
    // NB: .xml/application/xml intentionally omitted — the worker has no
    // structure-aware parser for it yet (Docling markup path is pending), so
    // accepting it here would only produce late parse failures. Re-add when wired.
};

export const ACCEPTED_EXTENSIONS = [
    ".pdf", ".docx", ".txt", ".json", ".js", ".ts", ".md", ".html", ".css", ".xml", ".py",
];

// ext → canonical MIME (reverse of ACCEPTED_TYPES). Built once so the two can't drift.
const EXT_TO_TYPE: Record<string, string> = Object.fromEntries(
    Object.entries(ACCEPTED_TYPES).map(([mime, ext]) => [ext, mime]),
);

// The ONE canonical content-type the whole upload chain uses (Policy B — see GRILL Q6):
// the file EXTENSION is the authority; the browser's file.type is ignored. file.type is
// "" for .md/.ts (which orphaned legit uploads). The server
// resolves this, signs it, returns it, the client echoes it into the PUT header, and GCS
// stores it — one non-empty value across all sites. Returns null for an unknown extension.
export function resolveContentType(fileName: string): string | null {
    const dot = fileName.lastIndexOf(".");
    if (dot < 0) return null;
    return EXT_TO_TYPE[fileName.slice(dot).toLowerCase()] ?? null;
}


export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MIN_FILE_SIZE = 1; // bytes — reject empty files
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// contentType is a *claim* (browser/OS-derived, sometimes "") — never a byte
// sniff. Fall back to the filename extension so a legit file with an empty type
// isn't bounced. The renamed-file risk (.exe renamed .pdf) is consciously accepted.
export function isAcceptedType(contentType: string, fileName: string): boolean {
    if (contentType && contentType in ACCEPTED_TYPES) return true;
    const lower = fileName.toLowerCase();
    return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}


export function validateFile(file: File): string | null {
    const result = fileSchema.safeParse(file);
    return result.success ? null : result.error.issues[0].message;
}

export function validateUploadClaim(claim: UploadClaim): string | undefined {
    const result = uploadClaimSchema.safeParse(claim);
    return result.success ? undefined : result.error.issues[0].message;
}

// What the SERVER validates: the metadata claim, not the bytes. This is the schema
// a server action can actually use (the File-based `fileSchema` cannot run there).
export const fileSchema = z
    .instanceof(File)
    .refine((f) => isAcceptedType(f.type, f.name), "Unsupported file type — see the accepted types below.")
    .refine((f) => f.name.includes('.'), "File requires an extension")
    .refine((f) => f.size >= MIN_FILE_SIZE, "File is empty.")
    .refine((f) => f.size <= MAX_FILE_SIZE, `File is too large (max ${formatBytes(MAX_FILE_SIZE)}).`);

export const uploadClaimSchema = z
    .object({
        file_name: z
            .string()
            .min(1)
            .max(255)
            .refine((n) => n.includes("."), "File requires an extension"),
        title: z.string().max(200),
        size: z
            .number()
            .int()
            .min(MIN_FILE_SIZE, "File is empty.")
            .max(MAX_FILE_SIZE, `File is too large (max ${MAX_FILE_SIZE / (1024 * 1024)} MB).`),
    })
    // The type gate is now purely extension-based (Policy B): the client's contentType is
    // never read, so the claim carries no contentType field — the server derives it.
    .refine((c) => resolveContentType(c.file_name) !== null, {
        error: "Unsupported file type.",
        path: ["file_name"],
    });

export type UploadClaim = z.infer<typeof uploadClaimSchema>;
