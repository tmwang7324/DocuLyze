import { describe, it, expect } from "vitest";
import { PICKER_ACCEPT, SIZE_HINT } from "@/_lib/upload_picker";
import {
    ACCEPTED_EXTENSIONS,
    MAX_FILE_SIZE,
    formatBytes,
    resolveContentType,
} from "@/_lib/fileupload_schema";

// Seam: what the upload screen OFFERS, against what the server will actually
// accept. (issue #25)
//
// This is the ticket's one sanctioned edit to working code, and it exists
// because the two drifted silently: the dropzone's file picker filtered to two
// extensions, its own helper text advertised nine, and the validation allowlist
// accepts eleven. Nothing about that is visible on screen — a user browsing
// their files just sees a document greyed out and concludes the system can't
// read it. The restyle renders six format chips directly above that picker,
// which is what makes the contradiction impossible to leave alone.
//
// Same shape as tests/landing/format_families.test.ts: a claim the UI makes,
// pinned to the code that enforces it. Needs no emulator, no Java and no
// credentials — every module under test is neutral.

// The accept attribute is one string to the DOM; these are the tokens in it.
const tokens = PICKER_ACCEPT.split(",").map((token) => token.trim());

describe("the file picker's accept filter", () => {
    // The concrete regression: browsing for any of these greyed them out, while
    // dropping the very same file was accepted. Literals, not derived from the
    // allowlist — this is the list a user would have hit.
    it.each([".md", ".txt", ".py", ".ts", ".js", ".json", ".html", ".css", ".xml"])(
        "offers %s, which the old two-format filter hid",
        (extension) => {
            expect(tokens).toContain(extension);
        },
    );

    it("offers every extension the validation allowlist accepts", () => {
        // The drift guard proper. ACCEPTED_EXTENSIONS is the gate the server
        // enforces; the picker may not offer less than it.
        for (const extension of ACCEPTED_EXTENSIONS) {
            expect(tokens).toContain(extension);
        }
    });

    it("offers nothing the server would refuse to sign", () => {
        // Checked through resolveContentType rather than the extension list:
        // that reads the OTHER table (ACCEPTED_TYPES), so an extension the
        // picker offers but the signer can't resolve a content-type for — an
        // upload that dies at getPresignedUrl — fails here.
        for (const token of tokens) {
            expect(resolveContentType(`document${token}`)).not.toBeNull();
        }
    });

    it("does not offer legacy .doc", () => {
        // Dropped from the allowlist end-to-end when the worker's parser
        // allowlist dropped it (issue #4). Offering it would produce a file
        // picked in the browser and rejected on submit.
        expect(tokens).not.toContain(".doc");
    });

    it("names extensions only — never a MIME type", () => {
        // The old filter mixed both ("application/pdf" alongside ".pdf"), which
        // is what let the extension half fall behind unnoticed. One vocabulary,
        // and it's the one the allowlist speaks.
        for (const token of tokens) {
            expect(token).toMatch(/^\.[a-z0-9]+$/);
        }
    });
});

describe("the size hint", () => {
    it("states the ceiling the upload chain actually enforces", () => {
        // 5 MB is pinned three times over: the presigned URL's
        // x-goog-content-length-range, uploadClaimSchema, and this line of copy.
        // The literal is the independent third party — if MAX_FILE_SIZE moves,
        // this fails and the spec is what gets re-read.
        expect(formatBytes(MAX_FILE_SIZE)).toBe("5.0 MB");
        expect(SIZE_HINT).toContain("5.0 MB");
    });

    it("makes no format claim of its own", () => {
        // The format claim belongs to the chips, which come from FORMAT_FAMILIES
        // and are pinned to the allowlist by the landing page's test. A second,
        // hand-typed list under the dropzone is exactly what went stale before.
        expect(SIZE_HINT).not.toMatch(/\.(pdf|docx|md|txt|json|js|ts|html|css|xml|py)\b/i);
    });
});
