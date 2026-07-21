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
// The mock must re-export the error classes: finalizeUpload's instanceof check
// and the tests' rejects must reference the SAME class object (issue #10).
vi.mock("@/_lib/ingest_broker", () => ({
  publishIngestJob: vi.fn(),
  IngestConfirmTimeoutError: class IngestConfirmTimeoutError extends Error {},
  IngestDisabledError: class IngestDisabledError extends Error {},
}));

import { finalizeUpload } from "@/app/actions/document/upload_document";
import { publishIngestJob, IngestConfirmTimeoutError } from "@/_lib/ingest_broker";
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
  // {uid, docId} envelope, after the record is `uploaded` — and reports the
  // confirmed publish as `queued` (issue #10 enqueue-outcome contract).
  it("successful finalize publishes exactly one (uid, docId) envelope and returns 'queued'", async () => {
    const { docId, storagePath } = await mintDocumentRecord({
      file_name: "notes.txt",
      title: "Notes",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });
    await seedStorageObject(storagePath, "abc", "text/plain");

    const result = await finalizeUpload(docId, "notes.txt", 3, "text/plain", "Notes");

    expect(result).toEqual({ enqueue: "queued" });
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
  // the upload or regresses the `uploaded` write. Issue #10 adds honesty: the
  // definite failure is now REPORTED as `failed` instead of swallowed silently.
  it("a definite publish failure returns 'failed' without failing the upload or regressing the record", async () => {
    publishMock.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:5672"));
    const { docId, storagePath } = await mintDocumentRecord({
      file_name: "notes.txt",
      title: "Notes",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });
    await seedStorageObject(storagePath, "abc", "text/plain");

    await expect(finalizeUpload(docId, "notes.txt", 3, "text/plain", "Notes")).resolves.toEqual({
      enqueue: "failed",
    });

    // `failed` classification is about the ENQUEUE only — the record must stay
    // `uploaded` (record `failed` means bad bytes and never regresses).
    expect((await readDocumentRecord(UID, docId))?.status).toBe("uploaded");
  });

  // Issue #10: a confirm timeout means the envelope MAY have landed — the
  // outcome is `unknown`, never `failed`, and the record is untouched.
  it("a confirm timeout returns 'unknown' and leaves the record at uploaded", async () => {
    publishMock.mockRejectedValue(new IngestConfirmTimeoutError("ingest publish confirm timed out"));
    const { docId, storagePath } = await mintDocumentRecord({
      file_name: "notes.txt",
      title: "Notes",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });
    await seedStorageObject(storagePath, "abc", "text/plain");

    await expect(finalizeUpload(docId, "notes.txt", 3, "text/plain", "Notes")).resolves.toEqual({
      enqueue: "unknown",
    });

    expect((await readDocumentRecord(UID, docId))?.status).toBe("uploaded");
  });
});
