import { describe, it, expect } from "vitest";
import {
    projectArchive,
    filterAndSort,
    selectRecent,
    type ArchiveInput,
} from "@/_lib/archive_projection";

// Seam: the archive projection — document records in, table rows + statistics out.
//
// Issue #23 names this the one part of the frontend makeover with a failure mode
// that doesn't announce itself. Everything else on the screen is verified by
// looking at it: a wrong font or a broken grid is visible. These two are not —
// a mislabelled status renders a perfectly normal-looking lie about the user's
// data, and a broken comparator leaves a list that looks fine and is unordered.
//
// The module imports no server code, so this file needs no emulator, no Java and
// no credentials, unlike the suites under tests/upload.

// 15 Jul 2026, 12:00 UTC. Midday so that reading the timestamp in any real local
// zone stays on the same calendar day, and mid-month so it can't cross a month.
const JULY_15 = Date.UTC(2026, 6, 15, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function record(over: Partial<ArchiveInput> = {}): ArchiveInput {
    return {
        docId: "abc123",
        title: "Quarterly report",
        file_name: "report.pdf",
        size: 2048,
        status: "ready",
        uploadedAt: JULY_15,
        ...over,
    };
}

describe("projectArchive", () => {
    describe("lifecycle status", () => {
        // The domain's statuses (DocStatus in _lib/database.tsx), each to exactly
        // one label and one tone. The pipeline and the archive must not disagree
        // about what a document is doing.
        const cases: [string, string, string][] = [
            ["ready", "Ready", "ok"],
            ["processing", "Parsing", "busy"],
            ["uploaded", "Queued", "busy"],
            ["pending", "Pending", "muted"],
            ["failed", "Failed", "error"],
            ["deleting", "Removing", "muted"],
        ];

        it.each(cases)("maps %s to its own label and tone", (status, label, tone) => {
            const { rows } = projectArchive([record({ status })]);
            expect(rows[0].statusLabel).toBe(label);
            expect(rows[0].statusTone).toBe(tone);
        });

        it("gives every status a distinct label", () => {
            // A shared label would make two different states indistinguishable
            // on screen, which is the failure this seam exists to catch.
            const labels = cases.map(([status]) => projectArchive([record({ status })]).rows[0].statusLabel);
            expect(new Set(labels).size).toBe(cases.length);
        });

        // Additive degradation — the same rule pipeline_progress.tsx follows. A
        // status this build has never heard of (the ingest pipeline gains states
        // faster than the UI does) must read as "still working", never as done.
        it.each(["", "embedding", "quarantined", "READY"])(
            "degrades the unknown status %j to in-progress rather than claiming completion",
            (status) => {
                const { rows } = projectArchive([record({ status })]);
                expect(rows[0].statusTone).toBe("busy");
                expect(rows[0].statusLabel).not.toMatch(/ready|done|complete/i);
            },
        );
    });

    describe("format family", () => {
        it.each([
            ["report.pdf", "PDF"],
            ["contract.docx", "DOCX"],
            ["notes.md", "MD"],
            ["log.txt", "TXT"],
            ["server.py", "CODE"],
            ["main.ts", "CODE"],
            ["index.html", "MARKUP"],
            ["feed.xml", "MARKUP"],
        ])("resolves %s to the %s family", (file_name, type) => {
            expect(projectArchive([record({ file_name })]).rows[0].type).toBe(type);
        });

        it("is case-insensitive about the extension", () => {
            expect(projectArchive([record({ file_name: "REPORT.PDF" })]).rows[0].type).toBe("PDF");
        });

        it("falls back for an unknown extension without claiming a format", () => {
            // The old components/document_type.ts fell back to "TXT", which
            // asserts a format the file may not have. A neutral badge doesn't.
            const { rows } = projectArchive([record({ file_name: "mystery.dat" })]);
            expect(rows[0].type).toBe("FILE");
            expect(rows[0].typeColor).toBeTruthy();
        });

        it("falls back for a name with no extension at all", () => {
            expect(projectArchive([record({ file_name: "README" })]).rows[0].type).toBe("FILE");
        });

        it("gives each family its own colour", () => {
            const names = ["a.pdf", "b.docx", "c.md", "d.txt", "e.py", "f.html"];
            const colors = names.map((file_name) => projectArchive([record({ file_name })]).rows[0].typeColor);
            expect(new Set(colors).size).toBe(names.length);
        });
    });

    describe("the row itself", () => {
        it("carries the real document identifier, never a row index", () => {
            const { rows } = projectArchive([
                record({ docId: "9xKq2LmP" }),
                record({ docId: "bT4vR8wZ" }),
            ]);
            expect(rows.map((r) => r.docId)).toEqual(["9xKq2LmP", "bT4vR8wZ"]);
        });

        it("formats size for display", () => {
            expect(projectArchive([record({ size: 512 })]).rows[0].size).toBe("512 B");
            expect(projectArchive([record({ size: 2048 })]).rows[0].size).toBe("2.0 KB");
        });

        it("labels the upload date", () => {
            const { rows } = projectArchive([record({ uploadedAt: JULY_15 })]);
            expect(rows[0].addedLabel).toMatch(/2026/);
            expect(rows[0].addedLabel).toMatch(/jul/i);
        });

        it("shows a placeholder rather than an epoch date when there is no timestamp", () => {
            // uploadedAt is a server timestamp: it reads back null in the window
            // between the write and the server resolving it. Formatting null as a
            // date yields "1 Jan 1970", which is a fabricated fact.
            const { rows } = projectArchive([record({ uploadedAt: null })]);
            expect(rows[0].addedLabel).not.toMatch(/1970/);
            expect(rows[0].addedLabel).toBe("—");
        });

        it("exposes no progress percentage", () => {
            // The prototype showed one. The archive has no progress signal —
            // live per-document progress lives on the upload screen.
            const { rows } = projectArchive([record()]);
            expect(Object.keys(rows[0])).not.toContain("progress");
        });
    });

    describe("statistics", () => {
        it("counts documents, DISTINCT families, and total size", () => {
            const { stats } = projectArchive([
                record({ file_name: "a.pdf", size: 1024 }),
                record({ file_name: "b.pdf", size: 1024 }),   // same family as a
                record({ file_name: "c.docx", size: 2048 }),
            ]);
            expect(stats.count).toBe(3);
            expect(stats.familyCount).toBe(2); // pdf, docx — not 3
            expect(stats.totalSize).toBe("4.0 KB");
        });

        it("aggregates from the records it was given, with nothing hard-coded", () => {
            const { stats } = projectArchive([record({ size: 1024 })]);
            expect(stats.count).toBe(1);
            expect(stats.familyCount).toBe(1);
            expect(stats.totalSize).toBe("1.0 KB");
        });

        it("reports zeroes for an empty archive", () => {
            const { stats } = projectArchive([]);
            expect(stats.count).toBe(0);
            expect(stats.familyCount).toBe(0);
            expect(stats.totalSize).toBe("0 B");
        });
    });

    describe("the first-run condition", () => {
        it("is set when there are no records", () => {
            const { isEmpty, rows } = projectArchive([]);
            expect(isEmpty).toBe(true);
            expect(rows).toEqual([]);
        });

        it("is not set when there is at least one record", () => {
            // This is what separates "you have no documents" from the filter's
            // "no matches" — the two say different things and only one is true
            // when a query is active.
            expect(projectArchive([record()]).isEmpty).toBe(false);
        });
    });
});

describe("filterAndSort", () => {
    const rowsFor = (inputs: ArchiveInput[]) => projectArchive(inputs).rows;

    describe("sort by recency", () => {
        it("orders by upload time, newest first", () => {
            const rows = rowsFor([
                record({ docId: "old", title: "Oldest", uploadedAt: JULY_15 - 2 * DAY }),
                record({ docId: "new", title: "Newest", uploadedAt: JULY_15 }),
                record({ docId: "mid", title: "Middle", uploadedAt: JULY_15 - DAY }),
            ]);
            const sorted = filterAndSort(rows, { query: "", sort: "recent" });
            expect(sorted.map((r) => r.docId)).toEqual(["new", "mid", "old"]);
        });

        it("orders by time even when the identifiers sort the other way", () => {
            // The prototype sorted by coercing its mock rows' numeric ids. Real
            // Firestore ids are non-numeric: Number(id) is NaN, every comparison
            // is false, and the list silently keeps its input order. Identifiers
            // here are deliberately alphabetically opposite to their times.
            const rows = rowsFor([
                record({ docId: "aaa", title: "A", uploadedAt: JULY_15 - 5 * DAY }),
                record({ docId: "zzz", title: "Z", uploadedAt: JULY_15 }),
            ]);
            const sorted = filterAndSort(rows, { query: "", sort: "recent" });
            expect(sorted.map((r) => r.docId)).toEqual(["zzz", "aaa"]);
        });

        it("puts records with no resolved timestamp last rather than first", () => {
            const rows = rowsFor([
                record({ docId: "unresolved", uploadedAt: null }),
                record({ docId: "dated", uploadedAt: JULY_15 }),
            ]);
            const sorted = filterAndSort(rows, { query: "", sort: "recent" });
            expect(sorted.map((r) => r.docId)).toEqual(["dated", "unresolved"]);
        });
    });

    describe("sort by name", () => {
        it("is case-insensitive", () => {
            const rows = rowsFor([
                record({ docId: "b", title: "banana" }),
                record({ docId: "A", title: "Apple" }),
                record({ docId: "c", title: "Cherry" }),
            ]);
            const sorted = filterAndSort(rows, { query: "", sort: "name" });
            // A naive comparison sorts every capital ahead of every lowercase,
            // which would give Apple, Cherry, banana.
            expect(sorted.map((r) => r.title)).toEqual(["Apple", "banana", "Cherry"]);
        });
    });

    describe("filter", () => {
        const rows = () =>
            rowsFor([
                record({ docId: "1", title: "Quarterly report", file_name: "q3.pdf" }),
                record({ docId: "2", title: "Meeting notes", file_name: "notes.md" }),
                record({ docId: "3", title: "Budget", file_name: "budget-report.docx" }),
            ]);

        it("matches a substring of the title, not just a prefix", () => {
            const found = filterAndSort(rows(), { query: "arterly", sort: "recent" });
            expect(found.map((r) => r.docId)).toEqual(["1"]);
        });

        it("is case-insensitive", () => {
            const found = filterAndSort(rows(), { query: "QUARTERLY", sort: "recent" });
            expect(found.map((r) => r.docId)).toEqual(["1"]);
        });

        it("matches the file name too", () => {
            const found = filterAndSort(rows(), { query: "notes.md", sort: "recent" });
            expect(found.map((r) => r.docId)).toEqual(["2"]);
        });

        it("returns everything for an empty or whitespace query", () => {
            expect(filterAndSort(rows(), { query: "", sort: "recent" })).toHaveLength(3);
            expect(filterAndSort(rows(), { query: "   ", sort: "recent" })).toHaveLength(3);
        });

        it("returns nothing when nothing matches", () => {
            expect(filterAndSort(rows(), { query: "zzzz", sort: "recent" })).toEqual([]);
        });

        it("does not mutate the rows it was given", () => {
            const original = rows();
            const order = original.map((r) => r.docId);
            filterAndSort(original, { query: "", sort: "name" });
            expect(original.map((r) => r.docId)).toEqual(order);
        });
    });
});

// The upload screen's right-hand column (issue #25). It reuses this module
// rather than growing a second source of truth for status labels and format
// families — so what it needs from the projection is a selection, not a second
// projection: the newest few of the same rows the archive renders.
//
// Its failure mode is the one this file exists for. A recent list that is
// unordered, or that quietly shows the oldest documents, looks entirely normal;
// the user simply doesn't see the upload they just made and concludes it didn't
// land.
describe("selectRecent", () => {
    const rowsFor = (inputs: ArchiveInput[]) => projectArchive(inputs).rows;

    it("returns the newest first, whatever order the records arrived in", () => {
        const rows = rowsFor([
            record({ docId: "mid", uploadedAt: JULY_15 - DAY }),
            record({ docId: "old", uploadedAt: JULY_15 - 5 * DAY }),
            record({ docId: "new", uploadedAt: JULY_15 }),
        ]);
        expect(selectRecent(rows).map((r) => r.docId)).toEqual(["new", "mid", "old"]);
    });

    it("keeps only the newest few", () => {
        // The document just uploaded must be visible without scrolling a column
        // that is beside the dropzone, not the archive itself.
        const rows = rowsFor(
            [7, 6, 5, 4, 3, 2, 1].map((day) =>
                record({ docId: `d${day}`, uploadedAt: JULY_15 - day * DAY }),
            ),
        );
        const recent = selectRecent(rows, 3);
        expect(recent.map((r) => r.docId)).toEqual(["d1", "d2", "d3"]);
    });

    it("shows a document whose timestamp has not resolved yet, but never first", () => {
        // The window right after finalize: the record exists, the server
        // timestamp doesn't. Dropping the row would hide the very upload the
        // user is watching; floating it to the top would claim a time nothing
        // recorded.
        const rows = rowsFor([
            record({ docId: "unresolved", uploadedAt: null }),
            record({ docId: "dated", uploadedAt: JULY_15 }),
        ]);
        expect(selectRecent(rows).map((r) => r.docId)).toEqual(["dated", "unresolved"]);
    });

    it("returns everything it has when there are fewer than the limit", () => {
        const rows = rowsFor([record({ docId: "only" })]);
        expect(selectRecent(rows, 5).map((r) => r.docId)).toEqual(["only"]);
    });

    it("returns nothing for an empty archive", () => {
        expect(selectRecent([])).toEqual([]);
    });

    it("does not mutate the rows it was given", () => {
        // The caller's array is the projection's output, reused across renders —
        // and on this screen the same rows are read by more than one child.
        const rows = rowsFor([
            record({ docId: "old", uploadedAt: JULY_15 - DAY }),
            record({ docId: "new", uploadedAt: JULY_15 }),
        ]);
        selectRecent(rows, 1);
        expect(rows.map((r) => r.docId)).toEqual(["old", "new"]);
    });

    it("returns the archive's own rows, with no second status or format mapping", () => {
        // The ticket's constraint, made checkable: the column renders whatever
        // the archive renders. If this list ever needed its own labels, this is
        // where that would show up.
        const rows = rowsFor([record({ status: "processing", file_name: "notes.md" })]);
        const [row] = selectRecent(rows);
        expect(row).toBe(rows[0]);
        expect(row.statusLabel).toBe("Parsing");
        expect(row.type).toBe("MD");
    });
});
