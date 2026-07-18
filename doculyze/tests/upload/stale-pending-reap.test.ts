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
  documentStoragePath,
  mintDocumentRecord,
  reapStalePendingDocuments,
  STALE_PENDING_MAX_AGE_MS,
} from "@/_lib/database";
import {
  authAs,
  backdateDocument,
  listUserDocuments,
  readDocumentRecord,
  resetEmulators,
  seedStorageObject,
  storageObjectExists,
} from "../helpers/harness";

const UID = "user-a";
const TWO_HOURS = 2 * 60 * 60 * 1000;

beforeEach(async () => {
  await resetEmulators();
  authAs(UID);
});

describe("#3 stale-pending reap — server-actions/DAL seam", () => {
  // Checkbox 5 (the tracer path): sign-then-abandon with bytes landed → age past
  // threshold → reap → record and object both gone.
  it("reaps a stale pending upload whose bytes landed: record and object both gone", async () => {
    const { docId } = await getPresignedUrl("report.pdf", "Quarterly report", 3);
    const storagePath = documentStoragePath(UID, docId);
    await seedStorageObject(storagePath, "abc", "application/pdf"); // PUT happened…
    await backdateDocument(UID, docId, TWO_HOURS); // …but finalize never came

    const reaped = await reapStalePendingDocuments();

    expect(reaped).toBe(1);
    expect(await readDocumentRecord(UID, docId)).toBeNull();
    expect(await storageObjectExists(storagePath)).toBe(false);
  });

  // Checkbox 2 ("if present"): a signed-but-never-PUT upload has no object —
  // the reap must remove the record without erroring on the missing bytes.
  it("reaps a stale pending upload that never PUT: record gone, no error on missing object", async () => {
    const { docId } = await getPresignedUrl("report.pdf", "Quarterly report", 2048);
    await backdateDocument(UID, docId, TWO_HOURS);

    const reaped = await reapStalePendingDocuments();

    expect(reaped).toBe(1);
    expect(await readDocumentRecord(UID, docId)).toBeNull();
    expect(await listUserDocuments(UID)).toHaveLength(0);
  });

  // Checkbox 4: safe alongside live uploads — a fresh pending (mid-upload) is
  // inside the age threshold and must not be selected.
  it("does not reap a fresh pending record (live upload in flight)", async () => {
    const { docId } = await getPresignedUrl("report.pdf", "Quarterly report", 2048);

    const reaped = await reapStalePendingDocuments();

    expect(reaped).toBe(0);
    expect((await readDocumentRecord(UID, docId))?.status).toBe("pending");
  });

  // Checkbox 3: records in any other status are never touched, no matter how old.
  it("never touches non-pending records, even ancient ones", async () => {
    for (const status of ["uploaded", "processing", "ready", "failed"] as const) {
      const { docId, storagePath } = await mintDocumentRecord({
        file_name: `${status}.txt`,
        title: status,
        contentType: "text/plain",
        size: 3,
        status,
      });
      await seedStorageObject(storagePath, "abc", "text/plain");
      await backdateDocument(UID, docId, TWO_HOURS);
    }

    const reaped = await reapStalePendingDocuments();

    expect(reaped).toBe(0);
    const all = await listUserDocuments(UID);
    expect(all).toHaveLength(4);
    for (const rec of all) {
      expect(await storageObjectExists(rec.storagePath)).toBe(true);
    }
  });

  // Checkbox 4 (idempotency half): a second pass over the same state is a no-op.
  it("is idempotent: a second reap pass finds nothing and does not error", async () => {
    const { docId } = await getPresignedUrl("report.pdf", "Quarterly report", 3);
    await seedStorageObject(documentStoragePath(UID, docId), "abc", "application/pdf");
    await backdateDocument(UID, docId, TWO_HOURS);

    expect(await reapStalePendingDocuments()).toBe(1);
    expect(await reapStalePendingDocuments()).toBe(0);
    expect(await listUserDocuments(UID)).toHaveLength(0);
  });

  // The reap runs under the caller's verified uid, like every DAL write — it
  // must only ever sweep the caller's own namespace.
  it("only reaps the caller's own documents, never another tenant's", async () => {
    authAs("user-b");
    const { docId: bDocId } = await getPresignedUrl("theirs.pdf", "Theirs", 2048);
    await backdateDocument("user-b", bDocId, TWO_HOURS);

    authAs(UID);
    const reaped = await reapStalePendingDocuments();

    expect(reaped).toBe(0);
    expect((await readDocumentRecord("user-b", bDocId))?.status).toBe("pending");
  });

  // The default threshold must comfortably exceed the 15-minute signed-URL
  // expiry — that gap is what makes "stale" mean "no PUT can still be running".
  it("default age threshold is well above the signed-URL expiry", () => {
    expect(STALE_PENDING_MAX_AGE_MS).toBeGreaterThanOrEqual(4 * 15 * 60 * 1000);
  });
});
