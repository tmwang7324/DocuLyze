import { describe, expect, it } from "vitest";
import { resolveContentType, validateUploadClaim } from "@/_lib/fileupload_schema";

// Issue #11: legacy `.doc` (application/msword) is removed from the allowlist, so
// a `.doc` upload is rejected at the gate (client dropzone AND server claim), not
// at ingest. These are pure assertions over the shared single-source-of-truth
// module — no emulator needed.
describe("#11 .doc gate is closed", () => {
  it("resolveContentType returns null for a .doc file", () => {
    expect(resolveContentType("legacy.doc")).toBeNull();
  });

  it("the server claim schema rejects a .doc file with an error string", () => {
    const problem = validateUploadClaim({ file_name: "legacy.doc", title: "t", size: 100 });
    expect(problem).toBeTruthy();
    expect(typeof problem).toBe("string");
  });

  it("still accepts .docx (the modern Word format)", () => {
    expect(resolveContentType("modern.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(validateUploadClaim({ file_name: "modern.docx", title: "t", size: 100 })).toBeUndefined();
  });
});
