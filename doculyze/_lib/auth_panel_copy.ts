// Copy for the registration panel (issue #24), as data rather than markup.

// Why the copy lives here instead of inline in the page: two of these lines are
// claims the product has to actually honour, and both have a single source of
// truth already in the codebase. Computing them means they cannot drift.
//
//   • the per-file limit  -> MAX_FILE_SIZE, the same constant the claim schema
//     validates against and the signer pins into x-goog-content-length-range.
//   • the format chips    -> ACCEPTED_EXTENSIONS, the allowlist the signer
//     refuses to sign outside of.
//
// The line states the per-file maximum, which is the only limit that exists instead of a paid tier gap.

import { ACCEPTED_EXTENSIONS, MAX_FILE_SIZE, formatBytes } from "@/_lib/fileupload_schema";

export function perFileLimitLine(maxBytes: number): string {
    return `Documents up to ${formatBytes(maxBytes)} per file`;
}

// Present-tense claims only where the code backs them. Parsing is real (the
// ingest worker converts PDF/DOCX/markup to Markdown today); retrieval and chat
// are roadmap, so they are phrased as what the upload is being prepared for
// rather than as a capability that already answers questions.
export const REGISTER_PANEL_BENEFITS: readonly string[] = [
    "Upload PDFs, Word files, markup and source — parsed to clean text automatically",
    perFileLimitLine(MAX_FILE_SIZE),
    "Watch each document move through the pipeline as it is processed",
    "Your documents stay yours — every read and write is scoped to your account",
];

// Derived, never hand-written: a chip for a format the signer would reject is a
// promise the server breaks.
export const FORMAT_CHIPS: readonly string[] = ACCEPTED_EXTENSIONS.map((ext) =>
    ext.replace(".", "").toUpperCase(),
);
