import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock the auth boundary (outside the DB seam) ---------------------------
// Same shape as mint-first.test.ts: @/_lib/data is replaced so the uid comes
// from the harness's authAs() global; Firestore + Storage stay real (emulators).
vi.mock("@/_lib/data", () => ({
  getCurrentUid: async () => (globalThis as Record<string, unknown>).__TEST_UID__ ?? null,
  requireUid: async () => {
    const uid = (globalThis as Record<string, unknown>).__TEST_UID__;
    if (!uid) throw new Error("User is not authenticated");
    return uid as string;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { getPresignedUrl } from "@/app/actions/document/upload_document";
import {
  DuplicateDocumentError,
  SIGNED_URL_TTL_MS,
  mintDocumentRecord,
  type DocStatus,
} from "@/_lib/database";
import {
  authAs,
  backdateDocument,
  listUserDocuments,
  readDocumentRecord,
  resetEmulators,
} from "../helpers/harness";

const UID = "user-a";
const PAST_URL_EXPIRY = SIGNED_URL_TTL_MS + 60 * 1000;

// Seed an existing document in a given status, bypassing the gate — these
// fixtures ARE the pre-existing state the gate is asked about.
async function seedRecord(status: DocStatus, over: { file_name?: string; size?: number } = {}) {
  return mintDocumentRecord({
    file_name: over.file_name ?? "report.pdf",
    title: "Quarterly report",
    contentType: "application/pdf",
    size: over.size ?? 2048,
    status,
  });
}

beforeEach(async () => {
  await resetEmulators();
  authAs(UID);
});

describe("duplicate gate — (file_name, size) identity at the mint seam", () => {
  it("refuses a second upload of the same name and size once the first is uploaded", async () => {
    await seedRecord("uploaded");

    await expect(seedRecord("pending")).rejects.toBeInstanceOf(DuplicateDocumentError);
    expect(await listUserDocuments(UID)).toHaveLength(1); // no second record minted
  });

  it("refuses against a document already in the pipeline (processing / ready)", async () => {
    for (const status of ["processing", "ready"] as const) {
      await resetEmulators();
      await seedRecord(status);
      await expect(seedRecord("pending")).rejects.toBeInstanceOf(DuplicateDocumentError);
      expect(await listUserDocuments(UID)).toHaveLength(1);
    }
  });

  // Both halves of the key must match: the same file at a different size is a
  // different document (an edited revision), and a different file at the same
  // size is a coincidence, not a duplicate.
  it("allows the same name at a different size", async () => {
    await seedRecord("uploaded", { size: 2048 });

    const { docId } = await seedRecord("pending", { size: 4096 });

    expect(docId).toBeTruthy();
    expect(await listUserDocuments(UID)).toHaveLength(2);
  });

  it("allows a different name at the same size", async () => {
    await seedRecord("uploaded", { file_name: "report.pdf" });

    const { docId } = await seedRecord("pending", { file_name: "other.pdf" });

    expect(docId).toBeTruthy();
    expect(await listUserDocuments(UID)).toHaveLength(2);
  });

  // The name half is case-insensitive: which case the file picker hands over
  // depends on the OS and on which copy the user reached for, so it can't be
  // part of identity.
  it("refuses a name differing only in case", async () => {
    await seedRecord("uploaded", { file_name: "report.pdf" });

    for (const attempt of ["Report.pdf", "REPORT.PDF", "rEpOrT.pDf"]) {
      await expect(seedRecord("pending", { file_name: attempt })).rejects.toBeInstanceOf(
        DuplicateDocumentError,
      );
    }
    expect(await listUserDocuments(UID)).toHaveLength(1);
  });

  // Case folding must not widen the match beyond case — the size half and the
  // rest of the name still have to agree.
  it("case-insensitivity does not collapse genuinely different names", async () => {
    await seedRecord("uploaded", { file_name: "report.pdf" });

    const { docId } = await seedRecord("pending", { file_name: "REPORTS.PDF" });

    expect(docId).toBeTruthy();
    expect(await listUserDocuments(UID)).toHaveLength(2);
  });

  it("case-insensitivity still respects the size half of the key", async () => {
    await seedRecord("uploaded", { file_name: "report.pdf", size: 2048 });

    const { docId } = await seedRecord("pending", { file_name: "REPORT.PDF", size: 4096 });

    expect(docId).toBeTruthy();
    expect(await listUserDocuments(UID)).toHaveLength(2);
  });

  // The stored spelling is preserved — the gate folds case only to compare.
  it("does not rewrite the stored file_name of either record", async () => {
    const { docId: first } = await seedRecord("pending", { file_name: "Report.PDF" });
    await backdateDocument(UID, first, PAST_URL_EXPIRY); // free the pair for a retry

    const { docId: second } = await seedRecord("pending", { file_name: "report.pdf" });

    expect((await readDocumentRecord(UID, first))?.file_name).toBe("Report.PDF");
    expect((await readDocumentRecord(UID, second))?.file_name).toBe("report.pdf");
  });

  // A live pending record is a claim on the pair: this is the double-submit /
  // two-tabs case, and letting it through would produce two copies.
  it("refuses while an upload of the same file is still in flight (fresh pending)", async () => {
    await seedRecord("pending");

    await expect(seedRecord("pending")).rejects.toBeInstanceOf(DuplicateDocumentError);
    expect(await listUserDocuments(UID)).toHaveLength(1);
  });

  // Past the signed-URL expiry no PUT can land against that record, so it is an
  // abandoned upload — it must not lock the user out of retrying the same file.
  it("allows a retry once the earlier pending upload's signed URL has expired", async () => {
    const { docId: abandoned } = await seedRecord("pending");
    await backdateDocument(UID, abandoned, PAST_URL_EXPIRY);

    const { docId } = await seedRecord("pending");

    expect(docId).not.toBe(abandoned);
    expect(await listUserDocuments(UID)).toHaveLength(2);
  });

  // A rejected upload (bad bytes, size mismatch, parse failure) has to stay
  // retryable, however old it is.
  it("allows re-uploading a file whose previous attempt failed", async () => {
    const { docId: failed } = await seedRecord("failed");

    const { docId } = await seedRecord("pending");

    expect(docId).not.toBe(failed);
    expect((await readDocumentRecord(UID, failed))?.status).toBe("failed"); // untouched
    expect(await listUserDocuments(UID)).toHaveLength(2);
  });

  // The gate is per-tenant, like every other DAL read: two users uploading the
  // same file are not duplicating anything.
  it("never blocks on another user's identical document", async () => {
    authAs("user-b");
    await seedRecord("uploaded");

    authAs(UID);
    const { docId } = await seedRecord("pending");

    expect(docId).toBeTruthy();
    expect(await listUserDocuments(UID)).toHaveLength(1);
    expect(await listUserDocuments("user-b")).toHaveLength(1);
  });
});

describe("duplicate gate — presign action surface", () => {
  it("presign returns a user-presentable error and signs nothing for a duplicate", async () => {
    await getPresignedUrl("report.pdf", "Quarterly report", 2048); // first: pending, live
    const { url, docId, contentType, error } = await getPresignedUrl(
      "report.pdf",
      "Quarterly report",
      2048,
    );

    expect(url).toBe("");
    expect(docId).toBe("");
    expect(contentType).toBe("");
    expect(error).toMatch(/report\.pdf/);
    expect(await listUserDocuments(UID)).toHaveLength(1);
  });

  it("names the file and its size when the duplicate is an existing document", async () => {
    await seedRecord("uploaded", { size: 2048 });

    const { error } = await getPresignedUrl("report.pdf", "Quarterly report", 2048);

    expect(error).toContain("report.pdf");
    expect(error).toContain("2.0 KB"); // formatBytes — one formatter, shared
  });

  it("a first upload is unaffected: presign still signs and mints pending", async () => {
    const { url, docId, error } = await getPresignedUrl("report.pdf", "Quarterly report", 2048);

    expect(error).toBeUndefined();
    expect(url).toBeTruthy();
    expect((await readDocumentRecord(UID, docId))?.status).toBe("pending");
  });

  it("refuses a duplicate that differs only in case, and says which name it clashes with", async () => {
    await seedRecord("uploaded", { file_name: "report.pdf", size: 2048 });

    const { url, error } = await getPresignedUrl("Report.PDF", "Quarterly report", 2048);

    expect(url).toBe("");
    // The EXISTING record's spelling, not the attempted one — that's the name
    // the user will actually find listed in their archive.
    expect(error).toContain("report.pdf");
    expect(error).not.toContain("Report.PDF");
  });

  // The whole point of holding the check and the write in one transaction: two
  // presigns racing on the same pair must serialize, so exactly one wins.
  it("two concurrent presigns of the same file mint exactly one record", async () => {
    const results = await Promise.all([
      getPresignedUrl("report.pdf", "Quarterly report", 2048),
      getPresignedUrl("report.pdf", "Quarterly report", 2048),
    ]);

    const signed = results.filter((r) => r.url !== "");
    expect(signed).toHaveLength(1);
    expect(await listUserDocuments(UID)).toHaveLength(1);
  });

  // The race and the case fold have to hold at the same time: the in-memory name
  // comparison happens inside the transaction, so a differently-cased racer is
  // serialized like an identical one.
  it("two concurrent presigns differing only in case mint exactly one record", async () => {
    const results = await Promise.all([
      getPresignedUrl("report.pdf", "Quarterly report", 2048),
      getPresignedUrl("REPORT.PDF", "Quarterly report", 2048),
    ]);

    const signed = results.filter((r) => r.url !== "");
    expect(signed).toHaveLength(1);
    expect(await listUserDocuments(UID)).toHaveLength(1);
  });
});
