// Document records → what the archive table displays. (issue #23)
//
// This is the one seam in the frontend makeover with a failure mode that doesn't
// announce itself: a mislabelled status renders a normal-looking lie about the
// user's data, and a broken comparator leaves a list that looks fine and is
// unordered. Everything else on the screen is verified by looking at it.
//
// Neutral module — no "use client", no "server-only". Its input is plain data,
// deliberately NOT DocumentRecord: the caller narrows the Firestore Timestamp to
// epoch millis, which is what keeps firebase-admin (and the emulator, and Java,
// and credentials) out of this module's tests. Its one import is the format
// family table, so the badge on a row and the format grid on the landing page
// can't come to disagree about what the six families are.
//
// It is presentation, never a gate: nothing here decides what may be uploaded.
// That is fileSchema / uploadClaimSchema in _lib/fileupload_schema.ts.

import { FORMAT_FAMILIES, type FormatFamily } from "@/_lib/format_families";
import { formatBytes } from "@/_lib/fileupload_schema";

export type ArchiveInput = {
    docId: string;
    title: string;
    file_name: string;
    size: number;
    status: string;
    /** Epoch millis, or null while the server timestamp is still unresolved. */
    uploadedAt: number | null;
};

export type StatusTone = "ok" | "busy" | "muted" | "error";

export type ArchiveRow = {
    docId: string;
    title: string;
    fileName: string;
    status: string;
    type: string;
    typeColor: string;
    /** Formatted for display, e.g. "2.0 KB". */
    size: string;
    statusLabel: string;
    statusTone: StatusTone;
    addedLabel: string;
    /** Upload time in millis — NOT the row index. See filterAndSort. */
    sortKey: number;
};

export type ArchiveStats = {
    count: number;
    /** DISTINCT format families present, not one per document. */
    familyCount: number;
    totalSize: string;
};

// How each family presents in the table: short badge text and its colour. One
// map rather than two parallel ones, so a family can't be added to the badges
// and forgotten in the colours.
//
// `badge` is the short form — the family table carries prose labels for the
// landing page's grid ("Markdown", "Text"), which are too long for a cell.
// `color` is the hex baked into that family's icon in components/brand_icons.tsx:
// the icons double as the legend for these badges, so the two must agree.
// TODO: fold the hex into FORMAT_FAMILIES so it lives in one place — deferred
// only because that file is being edited concurrently for #22.
const FAMILY_DISPLAY: Record<FormatFamily["key"], { badge: string; color: string }> = {
    pdf: { badge: "PDF", color: "#F45D22" },
    docx: { badge: "DOCX", color: "#16A34A" },
    markdown: { badge: "MD", color: "#2563EB" },
    text: { badge: "TXT", color: "#0891B2" },
    code: { badge: "CODE", color: "#7C3AED" },
    markup: { badge: "MARKUP", color: "#DB2777" },
};

// A file whose extension no family claims. Named for what is actually known
// about it — that it is a file. The retired components/document_type.ts fell
// back to "TXT", which asserts a format nothing verified.
const UNKNOWN_FAMILY = { type: "FILE", typeColor: "#6B6B6B" } as const;

// ".pdf" → "pdf", built once from the family table.
const EXTENSION_TO_FAMILY: Record<string, FormatFamily["key"]> = Object.fromEntries(
    FORMAT_FAMILIES.flatMap((family) => family.extensions.map((ext) => [ext, family.key])),
);

function familyOf(fileName: string): { type: string; typeColor: string } {
    const dot = fileName.lastIndexOf(".");
    if (dot < 0) return UNKNOWN_FAMILY;
    const key = EXTENSION_TO_FAMILY[fileName.slice(dot).toLowerCase()];
    if (!key) return UNKNOWN_FAMILY;
    const { badge, color } = FAMILY_DISPLAY[key];
    return { type: badge, typeColor: color };
}

// The domain's lifecycle statuses (DocStatus in _lib/database.tsx), each to one
// label and one tone. This is the single place the ingest pipeline's vocabulary
// becomes the design's — if those statuses change, they change here.
const STATUS_DISPLAY: Record<string, { label: string; tone: StatusTone }> = {
    ready: { label: "Ready", tone: "ok" },
    processing: { label: "Parsing", tone: "busy" },
    uploaded: { label: "Queued", tone: "busy" },
    pending: { label: "Pending", tone: "muted" },
    failed: { label: "Failed", tone: "error" },
    deleting: { label: "Removing", tone: "muted" },
};

// Additive degradation, the same rule app/(protected)/upload/pipeline_progress.tsx
// follows: a status this build has never heard of reads as still-working. The
// pipeline gains states faster than the UI does, and the one thing an unknown
// state must never do is claim the document is finished.
const UNKNOWN_STATUS = { label: "In progress", tone: "busy" } as const;

function statusOf(status: string): { label: string; tone: StatusTone } {
    return STATUS_DISPLAY[status] ?? UNKNOWN_STATUS;
}

// Locale-fixed so the label doesn't change shape under the reader's locale, and
// so the tests can assert on it. Day-month-year, month spelled, no time — the
// archive is documents at rest; anything finer implies a precision the list
// doesn't use.
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
});

function addedLabelOf(uploadedAt: number | null): string {
    // uploadedAt is a server timestamp: it reads back unresolved in the window
    // between the write and the server filling it in. Formatting that as a date
    // yields "1 Jan 1970", which is a fact the system doesn't have.
    if (uploadedAt === null) return "—";
    return DATE_FORMAT.format(new Date(uploadedAt));
}

export function projectArchive(records: ArchiveInput[]): {
    rows: ArchiveRow[];
    stats: ArchiveStats;
    isEmpty: boolean;
} {
    const rows: ArchiveRow[] = records.map((record) => {
        const { type, typeColor } = familyOf(record.file_name);
        const { label, tone } = statusOf(record.status);
        return {
            docId: record.docId,
            title: record.title,
            fileName: record.file_name,
            status: record.status,
            type,
            typeColor,
            size: formatBytes(record.size),
            statusLabel: label,
            statusTone: tone,
            addedLabel: addedLabelOf(record.uploadedAt),
            // Unresolved timestamps sort to the bottom rather than to 1970's
            // position, which for a newest-first list is the same thing.
            sortKey: record.uploadedAt ?? 0,
        };
    });

    return {
        rows,
        stats: {
            count: rows.length,
            familyCount: new Set(rows.map((row) => row.type)).size,
            totalSize: formatBytes(records.reduce((total, record) => total + record.size, 0)),
        },
        // "You have no documents" — distinct from the filter's "no matches",
        // which is the wrong statement when nothing is filtered.
        isEmpty: rows.length === 0,
    };
}

export type ArchiveQuery = {
    query: string;
    sort: "recent" | "name";
};

// Returns a new array — the caller's row list is the projection's output and is
// reused across renders.
export function filterAndSort(rows: ArchiveRow[], { query, sort }: ArchiveQuery): ArchiveRow[] {
    const needle = query.trim().toLowerCase();
    const matched = needle
        ? rows.filter(
              (row) =>
                  row.title.toLowerCase().includes(needle) ||
                  row.fileName.toLowerCase().includes(needle),
          )
        : [...rows];

    return matched.sort((a, b) =>
        sort === "name"
            ? // localeCompare, not <: a raw comparison orders every capital ahead
              // of every lowercase letter, so "banana" would sort after "Cherry".
              a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
            : b.sortKey - a.sortKey,
    );
}

/** How many documents the upload screen's recent column shows. */
export const RECENT_LIMIT = 5;

// The upload screen's right-hand column (issue #25): the newest few of the very
// rows the archive renders. A selection, not a second projection — the column
// reuses this module precisely so a document's status and format can't be
// labelled one way beside the dropzone and another way in the archive.
//
// Sorting is filterAndSort's recency order rather than a second comparator, for
// the same reason: two copies of "newest first" are how the two come to
// disagree about an unresolved timestamp.
export function selectRecent(rows: ArchiveRow[], limit: number = RECENT_LIMIT): ArchiveRow[] {
    return filterAndSort(rows, { query: "", sort: "recent" }).slice(0, limit);
}
