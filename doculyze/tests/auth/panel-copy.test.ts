import { describe, it, expect } from "vitest";
import {
    perFileLimitLine,
    REGISTER_PANEL_BENEFITS,
    FORMAT_CHIPS,
} from "@/_lib/auth_panel_copy";
import { ACCEPTED_EXTENSIONS, MAX_FILE_SIZE } from "@/_lib/fileupload_schema";

// Seam: the registration panel's copy, as data.
//
// Issue #24 corrects a marketing claim the design shipped with — a storage quota
// on a free tier, when there is no billing, no tiers and no per-user quota
// anywhere in the codebase. The only limit that exists is the per-FILE maximum
// enforced at validation and pinned into the signed upload URL.
//
// Pulling the copy out of the markup is what makes that correction hold: the
// limit line is computed from the validator's constant rather than typed as a
// string, and the format chips come from the allowlist rather than a hand-written
// list. Both are the kind of claim the frontend-makeover grill classified as
// "shipping cannot fix this" — unlike feature copy written ahead of the code.
describe("registration panel copy", () => {
    describe("perFileLimitLine", () => {
        it("states the limit it is given rather than a baked-in number", () => {
            // Feeding it a limit that is NOT the current one: a hardcoded string
            // would still say 5 MB here.
            expect(perFileLimitLine(10 * 1024 * 1024)).toContain("10.0 MB");
            expect(perFileLimitLine(512 * 1024)).toContain("512.0 KB");
        });

        it("describes the real limit as a per-file maximum, not an allowance", () => {
            const line = perFileLimitLine(MAX_FILE_SIZE);
            expect(line).toContain("5.0 MB"); // MAX_FILE_SIZE is 5 MB today
            expect(line).toMatch(/per file/i);
        });
    });

    it("makes no storage-quota, tier or allowance claim anywhere in the panel", () => {
        // The AC this pins: "No storage-quota or tier claim appears; the per-file
        // limit is stated instead." There is no billing and no quota to back any
        // of these words.
        const forbidden = /free tier|storage|quota|allowance|unlimited|\bGB\b|per month|upgrade/i;
        for (const line of REGISTER_PANEL_BENEFITS) {
            expect(line).not.toMatch(forbidden);
        }
    });

    it("states the per-file limit somewhere in the benefits", () => {
        expect(REGISTER_PANEL_BENEFITS.join(" ")).toContain("5.0 MB");
    });

    describe("FORMAT_CHIPS", () => {
        // The advertised format list is a claim the server has to honour: the
        // signer refuses anything outside ACCEPTED_EXTENSIONS, so a chip for a
        // format that isn't on it promises an upload that will be rejected.
        // (The dropzone drifted exactly this way — its `accept` offered 2 of 11.)
        it("advertises every accepted extension and nothing else", () => {
            expect([...FORMAT_CHIPS].sort()).toEqual(
                ["PDF", "DOCX", "TXT", "JSON", "JS", "TS", "MD", "HTML", "CSS", "XML", "PY"].sort(),
            );
        });

        it("stays in step with the upload allowlist", () => {
            const fromAllowlist = ACCEPTED_EXTENSIONS.map((ext) => ext.replace(".", "").toUpperCase());
            expect([...FORMAT_CHIPS].sort()).toEqual([...fromAllowlist].sort());
        });
    });
});
