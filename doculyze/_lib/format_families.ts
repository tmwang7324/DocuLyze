// The landing page's checkable claims: the six format families it advertises and
// the three figures in its hero. They live together because they are the same
// kind of thing — public assertions about what this system accepts, each pinned
// to the code that enforces it — and because one of the figures is a count of the
// other.
//
// Neutral module (no "use client" / "server-only", no imports beyond the upload
// rules): it is read by the landing page and pinned by
// tests/landing/format_families.test.ts against ACCEPTED_EXTENSIONS, so a family
// can never claim a format the uploader would reject.
//
// This is a *presentation* grouping of the allowlist, not a second gate. The gate
// is fileSchema / uploadClaimSchema in _lib/fileupload_schema.ts. (issue #22)

import { MAX_FILE_SIZE, formatBytes } from "@/_lib/fileupload_schema";

export type FormatFamily = {
    /** Stable key — also selects the icon on the landing page's grid. */
    key: "pdf" | "docx" | "markdown" | "text" | "code" | "markup";
    label: string;
    blurb: string;
    /** Every accepted extension this family speaks for, dotted and lowercase. */
    extensions: string[];
};

export const FORMAT_FAMILIES: readonly FormatFamily[] = [
    { key: "pdf", label: "PDF", blurb: "Portable documents", extensions: [".pdf"] },
    { key: "docx", label: "DOCX", blurb: "Word documents", extensions: [".docx"] },
    { key: "markdown", label: "Markdown", blurb: "Structured text", extensions: [".md"] },
    { key: "text", label: "Text", blurb: "Plain text files", extensions: [".txt"] },
    { key: "code", label: "Code", blurb: "Source files", extensions: [".py", ".js", ".ts", ".json", ".css"] },
    { key: "markup", label: "Markup", blurb: "HTML and XML", extensions: [".html", ".xml"] },
];

// The hero's three figures. The design had a document count, an average-latency
// promise and a customer count — all invented. These are the three facts the
// system can actually stand behind, and two of them are derived from the code
// that enforces them rather than retyped.
export const HERO_STATS: readonly { value: string; label: string }[] = [
    { value: String(FORMAT_FAMILIES.length), label: "Format families" },
    { value: formatBytes(MAX_FILE_SIZE), label: "Max file size" },
    // The ceiling, not a speed promise: the ingest worker gives a document a 20s
    // text pass (PARSE_TIMEOUT_S) and, for a PDF with no text layer, a further
    // 180s OCR pass (OCR_TIMEOUT_S) — see ingest-worker/src/ingest/config.py.
    // Nothing may exceed the sum, which is why the 300s processing lease clears
    // it. Stated as a bound so it stays true however slow a document is.
    { value: "200s", label: "Max parse budget" },
];
