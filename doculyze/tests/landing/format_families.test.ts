import { describe, it, expect } from "vitest";
import { FORMAT_FAMILIES, HERO_STATS } from "@/_lib/format_families";
import { ACCEPTED_EXTENSIONS, MAX_FILE_SIZE, formatBytes } from "@/_lib/fileupload_schema";

// The landing page's format grid is a public claim about what the system takes.
// The design shipped a presentation cell with no parser behind it, and nothing
// caught it — the copy and the allowlist have no compile-time relationship. This
// is that relationship, asserted. Pure data on both sides: no emulators, no
// credentials, no DOM. (issue #22)
describe("format families", () => {
    it("advertises no extension the uploader rejects", () => {
        const advertised = FORMAT_FAMILIES.flatMap((family) => family.extensions);
        const rejected = advertised.filter((ext) => !ACCEPTED_EXTENSIONS.includes(ext));
        expect(rejected).toEqual([]);
    });

    it("covers every accepted extension exactly once", () => {
        const advertised = FORMAT_FAMILIES.flatMap((family) => family.extensions);
        // Sorted so the failure message names the missing/extra extension rather
        // than complaining about ordering.
        expect([...advertised].sort()).toEqual([...ACCEPTED_EXTENSIONS].sort());
    });
});

// The hero's three figures replace a document count, a latency promise and a
// customer count. Each of the two with a source of truth in this codebase is
// pinned to it here; the third (the parse budget) lives in the Python worker's
// config and is documented at its definition instead. (issue #22)
describe("hero statistics", () => {
    const statValue = (label: string) => HERO_STATS.find((stat) => stat.label === label)?.value;

    it("counts the format families the grid actually renders", () => {
        // Six is the design's grid, and the number the copy says out loud.
        expect(FORMAT_FAMILIES).toHaveLength(6);
        expect(statValue("Format families")).toBe("6");
    });

    it("states the file size the uploader enforces", () => {
        expect(statValue("Max file size")).toBe(formatBytes(MAX_FILE_SIZE));
    });
});
