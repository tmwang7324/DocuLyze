import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock the auth boundary (outside the DB seam) ---------------------------
// getPresignedUrl calls getCurrentUid; the DAL calls requireUid. Both come from
// @/_lib/data, which reads the session cookie via next/headers. We replace that
// whole module so the uid is driven by the harness's authAs() global instead —
// the DB + Storage seams stay REAL (emulator-backed).
vi.mock("@/_lib/data", () => ({
  getCurrentUid: async () => (globalThis as Record<string, unknown>).__TEST_UID__ ?? null,
  requireUid: async () => {
    const uid = (globalThis as Record<string, unknown>).__TEST_UID__;
    if (!uid) throw new Error("User is not authenticated");
    return uid as string;
  },
}));

// finalizeUpload calls revalidatePath; getPresignedUrl/finalize call redirect on
// the unauthenticated path. Neither has a Next request context under test.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { getPresignedUrl, finalizeUpload } from "@/app/actions/document/upload_document";
import { mintDocumentRecord, listDocuments } from "@/_lib/database";
import {
  authAs,
  listUserDocuments,
  readDocumentRecord,
  resetEmulators,
  seedStorageObject,
} from "../helpers/harness";

const UID = "user-a";

beforeEach(async () => {
  await resetEmulators();
  authAs(UID);
});

describe("#2 mint-first lifecycle — server-actions seam", () => {
  // Checkbox 1: presign writes a `pending` record before returning the signed URL.
  it("presign writes a pending record that is queryable immediately", async () => {
    const { docId, url } = await getPresignedUrl("report.pdf", "Quarterly report", 1234);

    expect(url).toBeTruthy();
    const rec = await readDocumentRecord(UID, docId);
    expect(rec).not.toBeNull();
    expect(rec?.status).toBe("pending");
    expect(rec?.storagePath).toBe(`users/${UID}/documents/${docId}`);
  });

  // Checkbox 2: successful finalize flips exactly that record pending -> uploaded.
  it("finalize flips pending -> uploaded when the storage size matches the claim", async () => {
    const { docId, storagePath } = await mintDocumentRecord({
      file_name: "notes.txt",
      title: "Notes",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });
    await seedStorageObject(storagePath, "abc", "text/plain"); // exactly 3 bytes

    await finalizeUpload(docId, "notes.txt", 3, "Notes");

    const rec = await readDocumentRecord(UID, docId);
    expect(rec?.status).toBe("uploaded");
  });

  // Checkbox 3: size-mismatch finalize writes `failed` on the record instead of
  // throwing into the void; the object is retained (flag-only).
  it("finalize writes failed (not throw-into-void) on a size mismatch", async () => {
    const { docId, storagePath } = await mintDocumentRecord({
      file_name: "notes.txt",
      title: "Notes",
      contentType: "text/plain",
      size: 999, // claim
      status: "pending",
    });
    await seedStorageObject(storagePath, "abc", "text/plain"); // actual = 3 bytes

    await expect(finalizeUpload(docId, "notes.txt", 999, "Notes")).rejects.toThrow(/mismatch/i);

    const rec = await readDocumentRecord(UID, docId);
    expect(rec?.status).toBe("failed"); // record written, not vanished
    // Object retained (flag-only): the bytes are still in Storage.
    const [exists] = await (await import("@/_lib/admin")).storage.bucket().file(storagePath).exists();
    expect(exists).toBe(true);
  });

  // Checkbox 2 (idempotency half): re-running finalize is idempotent — a
  // duplicate finalize (double-click, retry) must not create a second record or
  // regress the status. finalize writes at the pre-minted docId, so a replay is
  // an overwrite, not an insert.
  it("re-running a successful finalize is idempotent (stays uploaded, no duplicate record)", async () => {
    const { docId, storagePath } = await mintDocumentRecord({
      file_name: "notes.txt",
      title: "Notes",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });
    await seedStorageObject(storagePath, "abc", "text/plain");

    await finalizeUpload(docId, "notes.txt", 3, "Notes");
    await finalizeUpload(docId, "notes.txt", 3, "Notes"); // replay

    const rec = await readDocumentRecord(UID, docId);
    expect(rec?.status).toBe("uploaded");
    const all = await listUserDocuments(UID);
    expect(all).toHaveLength(1); // one record, not two
  });

  // Checkbox 4: a PUT that never finalizes leaves exactly one pending record —
  // the mint-first invariant (no record-less object; here, the record with no
  // confirmed object). presign is the mint point.
  it("an abandoned upload (no finalize) leaves exactly one pending record", async () => {
    const { docId } = await getPresignedUrl("report.pdf", "Quarterly report", 2048);
    // Client closes the tab here: no PUT, no finalizeUpload().

    const all = await listUserDocuments(UID);
    expect(all).toHaveLength(1);
    expect(all[0].docId).toBe(docId);
    expect(all[0].status).toBe("pending");
  });

  // Checkbox 5: the dashboard query surfaces pending & failed, not only uploaded,
  // so abandoned and rejected uploads are visible to their owner. The dashboard
  // component already renders doc.status distinguishably; this covers the query.
  it("the dashboard query surfaces pending and failed states, not only uploaded", async () => {
    await mintDocumentRecord({ file_name: "a.txt", title: "A", contentType: "text/plain", size: 1, status: "pending" });
    await mintDocumentRecord({ file_name: "b.txt", title: "B", contentType: "text/plain", size: 1, status: "uploaded" });
    await mintDocumentRecord({ file_name: "c.txt", title: "C", contentType: "text/plain", size: 1, status: "failed" });

    const docs = await listDocuments();

    expect(docs).toHaveLength(3);
    expect(docs.map((d) => d.status).sort()).toEqual(["failed", "pending", "uploaded"]);
  });

  // Tenant isolation at this seam: finalize re-derives the storage path from the
  // caller's own cookie uid, never the docId's owner. So user B "finalizing" user
  // A's docId only ever looks in user B's namespace — where the object isn't —
  // and A's record is untouched. A tampered docId can't cross tenants.
  it("user B cannot finalize a docId belonging to user A", async () => {
    // User A mints a pending record and uploads the bytes.
    authAs("user-a");
    const { docId, storagePath } = await mintDocumentRecord({
      file_name: "secret.txt",
      title: "Secret",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });
    await seedStorageObject(storagePath, "abc", "text/plain");

    // User B tries to finalize A's docId.
    authAs("user-b");
    await expect(finalizeUpload(docId, "secret.txt", 3, "Secret")).rejects.toThrow();

    // A's record is untouched, and B has no record at all.
    expect((await readDocumentRecord("user-a", docId))?.status).toBe("pending");
    expect(await listUserDocuments("user-b")).toHaveLength(0);
  });
});
