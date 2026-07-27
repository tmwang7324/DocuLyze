"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import { validateFile } from "@/_lib/fileupload_schema";
import { PICKER_ACCEPT, SIZE_HINT } from "@/_lib/upload_picker";
import { FORMAT_FAMILIES } from "@/_lib/format_families";
import { IconUpload } from "@/components/brand_icons";

// ---------------------------------------------------------------------------
// Client-side gating ONLY — friendly, early rejection. It is NOT security.
// Real enforcement lives server-side: the presigned-URL `contentType` +
// `x-goog-content-length-range`, and the confirm-time metadata re-read.
// An attacker curls the signed URL and never touches this component.
// See GRILL-ME-storage-upload-auth-2026-07-11.md (Q3/Q4).
// ---------------------------------------------------------------------------


type FileDropzoneProps = {
    // Drag-dropped files live in React state, NOT the DOM <input> — so the parent
    // MUST read the file from this callback (consistent with the presigned fetch
    // flow, where bytes are PUT directly and never travel through FormData).
    onFileAccepted: (file: File) => void;
    onFileCleared?: () => void;
    disabled?: boolean;
};

export default function FileDropzone({ onFileAccepted, onFileCleared, disabled }: FileDropzoneProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const dragDepth = useRef(0); // depth counter → flicker-free while dragging over children
    const [dragActive, setDragActive] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    function accept(file: File | null | undefined) {
        if (!file) return;
        const problem = validateFile(file);
        if (problem) {
            // Reject: never surface the filename, show the reason instead.
            setError(problem);
            setFileName(null);
            onFileCleared?.();
            return;
        }
        setError(null);
        setFileName(file.name);
        onFileAccepted(file);
    }

    function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = ""; // reset so re-picking the same file re-fires onChange
        accept(file);
    }

    function onDrop(e: React.DragEvent<HTMLLabelElement>) {
        e.preventDefault();
        dragDepth.current = 0;
        setDragActive(false);
        if (disabled) return;
        accept(e.dataTransfer.files?.[0]);
    }

    function onDragEnter(e: React.DragEvent<HTMLLabelElement>) {
        e.preventDefault();
        if (disabled) return;
        dragDepth.current += 1;
        setDragActive(true);
    }

    function onDragLeave(e: React.DragEvent<HTMLLabelElement>) {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragActive(false);
        }
    }

    // Required — without preventDefault on dragover the browser won't fire `drop`.
    function onDragOver(e: React.DragEvent<HTMLLabelElement>) {
        e.preventDefault();
    }

    function clear() {
        setFileName(null);
        setError(null);
        onFileCleared?.();
        inputRef.current?.focus();
    }

    return (
        <div className="flex flex-col gap-3">
            <label
                onDrop={onDrop}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDragOver={onDragOver}
                className={`flex flex-col items-center justify-center gap-4 border-2 border-dashed px-6 py-14 text-center transition-colors focus-within:border-orange-primary focus-within:ring-2 focus-within:ring-orange-pale ${
                    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                } ${
                    dragActive
                        ? "border-orange-primary bg-orange-pale"
                        : error
                          ? "border-error bg-white"
                          : "border-hairline bg-white hover:border-orange-primary hover:bg-off-white"
                }`}
            >
                {/* sr-only (not hidden) so the input stays keyboard-focusable; the
                    native filename label never renders because it isn't visible.

                    The accept filter used to be a hard-coded ".pdf,.docx" plus two
                    MIME types, so browsing greyed out nine formats the server
                    accepts and the chips below advertise. It is derived now — see
                    _lib/upload_picker.ts and tests/upload/picker.test.ts. (#25) */}
                <input
                    ref={inputRef}
                    type="file"
                    accept={PICKER_ACCEPT}
                    onChange={onInputChange}
                    disabled={disabled}
                    className="sr-only"
                />

                <span className={dragActive ? "text-orange-primary" : "text-muted"} aria-hidden="true">
                    <IconUpload />
                </span>

                {dragActive ? (
                    <p className="font-display text-2xl font-bold uppercase text-orange-primary">
                        Drop it here
                    </p>
                ) : fileName ? (
                    <div className="max-w-full">
                        <p className="font-display text-2xl font-bold uppercase text-dark truncate">
                            {fileName}
                        </p>
                        <p className="font-mono-label text-[10px] tracking-wider uppercase text-muted mt-2">
                            Ready to upload
                        </p>
                    </div>
                ) : (
                    <div>
                        <p className="font-display text-2xl font-bold uppercase text-dark leading-none">
                            Drop a document
                        </p>
                        <p className="text-muted text-sm mt-2">or click anywhere to browse</p>
                    </div>
                )}

                {/* The six format families, directly above the picker they describe.
                    Same source as the landing page's grid (FORMAT_FAMILIES), which
                    is pinned to the upload allowlist — the chips can't advertise a
                    format the server would reject. */}
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {FORMAT_FAMILIES.map((family) => (
                        <span
                            key={family.key}
                            className="font-mono-label text-[10px] tracking-wider uppercase border border-hairline text-muted px-2 py-1"
                        >
                            {family.label}
                        </span>
                    ))}
                </div>

                <p className="font-mono-label text-[10px] tracking-wider uppercase text-placeholder">
                    {SIZE_HINT}
                </p>
            </label>

            {fileName && (
                <button
                    type="button"
                    onClick={clear}
                    className="self-start font-mono-label text-[10px] tracking-wider uppercase text-muted hover:text-error transition-colors"
                >
                    Remove file
                </button>
            )}

            {error && (
                <p className="border-l-2 border-error bg-white px-3 py-2 text-sm text-error">{error}</p>
            )}
        </div>
    );
}
