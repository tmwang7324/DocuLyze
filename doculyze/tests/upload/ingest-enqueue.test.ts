import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock the auth boundary (outside the DB seam) ---------------------------
// Same discipline as mint-first.test.ts: uid driven by the harness's authAs()
// global; the DB + Storage seams stay REAL (emulator-backed).
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

// --- Fake the producer at the module boundary -------------------------------
// The broker is deliberately OUTSIDE this seam (guide: "faked at the module
// boundary in tests") — no RabbitMQ needed; we assert the enqueue contract.
vi.mock("@/_lib/ingest_broker", () => ({ publishIngestJob: vi.fn() }));

import { finalizeUpload } from "@/app/actions/document/upload_document";
import { publishIngestJob } from "@/_lib/ingest_broker";
import { mintDocumentRecord } from "@/_lib/database";
import { authAs, readDocumentRecord, resetEmulators, seedStorageObject } from "../helpers/harness";

const UID = "user-a";
const publishMock = vi.mocked(publishIngestJob);

beforeEach(async () => {
  await resetEmulators();
  authAs(UID);
  publishMock.mockReset();
  publishMock.mockResolvedValue(undefined);
});

describe("#4 ingest enqueue — finalizeUpload seam", () => {
  // Checkbox 1 (success half): a successful finalize publishes exactly one
  // {uid, docId} envelope, after the record is `uploaded`.
  it("successful finalize publishes exactly one (uid, docId) envelope", async () => {
    const { docId, storagePath } = await mintDocumentRecord({
      file_name: "notes.txt",
      title: "Notes",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });
    await seedStorageObject(storagePath, "abc", "text/plain");

    await finalizeUpload(docId, "notes.txt", 3, "text/plain", "Notes");

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(UID, docId);
    expect((await readDocumentRecord(UID, docId))?.status).toBe("uploaded");
  });

  // Checkbox 1 (failure half): a finalize that fails (size mismatch -> failed)
  // publishes nothing.
  it("size-mismatch finalize publishes no envelope", async () => {
    const { docId, storagePath } = await mintDocumentRecord({
      file_name: "notes.txt",
      title: "Notes",
      contentType: "text/plain",
      size: 999,
      status: "pending",
    });
    await seedStorageObject(storagePath, "abc", "text/plain"); // actual = 3 bytes

    await expect(finalizeUpload(docId, "notes.txt", 999, "text/plain", "Notes")).rejects.toThrow(/mismatch/i);

    expect(publishMock).not.toHaveBeenCalled();
    expect((await readDocumentRecord(UID, docId))?.status).toBe("failed");
  });

  // Decision (grill 2026-07-18): swallow-and-log. A broker outage never fails
  // the upload or regresses the `uploaded` write.
  it("a publish failure does not fail the upload or regress the record", async () => {
    publishMock.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:5672"));
    const { docId, storagePath } = await mintDocumentRecord({
      file_name: "notes.txt",
      title: "Notes",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });
    await seedStorageObject(storagePath, "abc", "text/plain");

    await expect(finalizeUpload(docId, "notes.txt", 3, "text/plain", "Notes")).resolves.toBeUndefined();

    expect((await readDocumentRecord(UID, docId))?.status).toBe("uploaded");
  });
});
