"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import { MAX_FILE_SIZE, validateFile, formatBytes } from "@/_lib/fileupload_schema";

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
        <div className="flex flex-col gap-2">
            <label
                onDrop={onDrop}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDragOver={onDragOver}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-blue-500 ${
                    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                } ${
                    dragActive
                        ? "border-blue-500 bg-blue-50"
                        : error
                          ? "border-red-400"
                          : "border-gray-300 hover:border-gray-400"
                }`}
            >
                {/* sr-only (not hidden) so the input stays keyboard-focusable; the
                    native filename label never renders because it isn't visible. */}
                <input
                    ref={inputRef}
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={onInputChange}
                    disabled={disabled}
                    className="sr-only"
                />
                {dragActive ? (
                    <p className="text-sm text-blue-600">Drop the file here…</p>
                ) : fileName ? (
                    <p className="text-sm font-medium">{fileName}</p>
                ) : (
                    <>
                        <p className="text-sm">Drag &amp; drop a file here, or click to browse</p>
                        <p className="text-xs text-gray-500">
                            PDF, Word (.docx), Text (.txt), JSON (.json), JavaScript (.js), TypeScript (.ts), Markdown (.md), HTML (.html), CSS (.css) up to {formatBytes(MAX_FILE_SIZE)}
                        </p>
                    </>
                )}
            </label>

            {fileName && (
                <button
                    type="button"
                    onClick={clear}
                    className="self-start text-xs text-red-500 hover:text-red-700"
                >
                    Remove
                </button>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
    );
}
