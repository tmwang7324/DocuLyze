import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Transport from "winston-transport";
import { createLogger } from "winston";

const mocks = vi.hoisted(() => {
  class IngestConfirmTimeoutError extends Error {}
  class DuplicateDocumentError extends Error {}
  return {
    IngestConfirmTimeoutError,
    DuplicateDocumentError,
    getCurrentUid: vi.fn(),
    mintDocumentRecord: vi.fn(),
    finalizeDocumentRecord: vi.fn(),
    createUserProfile: vi.fn(),
    storageFile: vi.fn(),
    publishIngestJob: vi.fn(),
    verifyIdToken: vi.fn(),
    verifySessionCookie: vi.fn(),
    createSessionCookie: vi.fn(),
    revokeRefreshTokens: vi.fn(),
    cookieGet: vi.fn(),
    cookieSet: vi.fn(),
    cookieDelete: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/_lib/data", () => ({ getCurrentUid: mocks.getCurrentUid }));
vi.mock("@/_lib/database", () => ({
  DuplicateDocumentError: mocks.DuplicateDocumentError,
  SIGNED_URL_TTL_MS: 900_000,
  mintDocumentRecord: mocks.mintDocumentRecord,
  finalizeDocumentRecord: mocks.finalizeDocumentRecord,
  documentStoragePath: (uid: string, docId: string) => `users/${uid}/documents/${docId}`,
  createUserProfile: mocks.createUserProfile,
}));
vi.mock("@/_lib/admin", () => ({
  storage: { bucket: () => ({ file: mocks.storageFile }) },
  adminAuth: {
    verifyIdToken: mocks.verifyIdToken,
    verifySessionCookie: mocks.verifySessionCookie,
    createSessionCookie: mocks.createSessionCookie,
    revokeRefreshTokens: mocks.revokeRefreshTokens,
  },
}));
vi.mock("@/_lib/ingest_broker", () => ({
  publishIngestJob: mocks.publishIngestJob,
  IngestConfirmTimeoutError: mocks.IngestConfirmTimeoutError,
  IngestDisabledError: class IngestDisabledError extends Error {},
}));
vi.mock("@/_lib/firebase", () => ({ auth: {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet, delete: mocks.cookieDelete }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { createRefresh, revokeSession } from "@/app/actions/auth/session";
import { finalizeUpload, getPresignedUrl } from "@/app/actions/document/upload_document";
import {
  resetOperationalLoggerForTests,
  setOperationalLoggerForTests,
} from "@/_lib/operational_logger";

class CapturingTransport extends Transport {
  readonly events: Record<string, unknown>[] = [];

  log(info: Record<string, unknown>, callback: () => void): void {
    this.events.push({ ...info });
    callback();
  }
}

function captureEvents(): CapturingTransport {
  const transport = new CapturingTransport();
  setOperationalLoggerForTests(createLogger({ transports: [transport] }));
  return transport;
}

function eventsFor(transport: CapturingTransport, operation: string): Record<string, unknown>[] {
  return transport.events.filter((event) => event.operation === operation);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUid.mockResolvedValue("user-a");
  mocks.mintDocumentRecord.mockResolvedValue({ docId: "doc-a", storagePath: "users/user-a/documents/doc-a" });
  mocks.finalizeDocumentRecord.mockResolvedValue(undefined);
  mocks.createUserProfile.mockResolvedValue(undefined);
  mocks.storageFile.mockReturnValue({
    getSignedUrl: vi.fn().mockResolvedValue(["https://signed.example/upload"]),
    exists: vi.fn().mockResolvedValue([true]),
    getMetadata: vi.fn().mockResolvedValue([{ size: "3" }]),
  });
  mocks.publishIngestJob.mockResolvedValue(undefined);
  mocks.verifyIdToken.mockResolvedValue({ uid: "user-a", email: "user@example.test" });
  mocks.verifySessionCookie.mockResolvedValue(null);
  mocks.createSessionCookie.mockResolvedValue("session-cookie");
  mocks.revokeRefreshTokens.mockResolvedValue(undefined);
  mocks.cookieGet.mockReturnValue(undefined);
});

afterEach(() => resetOperationalLoggerForTests());

describe("server operation lifecycle seams", () => {
  it("records a safe successful getPresignedUrl lifecycle without changing its result", async () => {
    const transport = captureEvents();

    await expect(getPresignedUrl("notes.txt", "Quarterly notes", 3)).resolves.toEqual({
      url: "https://signed.example/upload",
      docId: "doc-a",
      contentType: "text/plain",
    });

    expect(eventsFor(transport, "getPresignedUrl")).toEqual([
      expect.objectContaining({ operation: "getPresignedUrl", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "getPresignedUrl",
        lifecycle: "succeeded",
        level: "info",
        durationMs: expect.any(Number),
      }),
    ]);
    expect(eventsFor(transport, "getPresignedUrl")[1]).not.toHaveProperty("title");
    expect(eventsFor(transport, "getPresignedUrl")[1]).not.toHaveProperty("fileName");
    expect(eventsFor(transport, "validateUploadClaim")).toEqual([
      expect.objectContaining({ operation: "validateUploadClaim", lifecycle: "passed", level: "info" }),
    ]);
  });

  it("records a safe failed validateUploadClaim result when presign rejects metadata", async () => {
    const transport = captureEvents();

    await expect(getPresignedUrl("malware.exe", "Untrusted input", 3))
      .rejects.toThrow("Unsupported file type.");

    expect(eventsFor(transport, "validateUploadClaim")).toEqual([
      expect.objectContaining({ operation: "validateUploadClaim", lifecycle: "failed", level: "info" }),
    ]);
  });

  it("records a duplicate rejection without exposing its filename-bearing error", async () => {
    const transport = captureEvents();
    mocks.mintDocumentRecord.mockRejectedValue(
      new mocks.DuplicateDocumentError('"confidential-notes.txt" already exists'),
    );

    await expect(getPresignedUrl("notes.txt", "Quarterly notes", 3)).resolves.toEqual({
      url: "",
      docId: "",
      contentType: "",
      error: '"confidential-notes.txt" already exists',
    });

    expect(eventsFor(transport, "getPresignedUrl")[1]).toEqual(expect.objectContaining({
      lifecycle: "rejected",
      level: "warn",
      reason: "duplicate_document",
    }));
    expect(eventsFor(transport, "getPresignedUrl")[1]).not.toHaveProperty("error");
  });

  it("records finalizeUpload's uncertain enqueue as a warn terminal while preserving its result", async () => {
    const transport = captureEvents();
    mocks.publishIngestJob.mockRejectedValue(new mocks.IngestConfirmTimeoutError("confirm timed out"));

    await expect(finalizeUpload("doc-a", "notes.txt", 3, "text/plain", "Quarterly notes"))
      .resolves.toEqual({ enqueue: "unknown" });

    expect(eventsFor(transport, "finalizeUpload")).toEqual([
      expect.objectContaining({ operation: "finalizeUpload", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "finalizeUpload",
        lifecycle: "unknown",
        level: "warn",
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it("records createRefresh success before its existing redirect and excludes credentials", async () => {
    const transport = captureEvents();

    await expect(createRefresh("correct horse battery staple", "id-token")).rejects.toThrow("REDIRECT:/dashboard");

    expect(eventsFor(transport, "createRefresh")).toEqual([
      expect.objectContaining({ operation: "createRefresh", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "createRefresh",
        lifecycle: "succeeded",
        level: "info",
        durationMs: expect.any(Number),
      }),
    ]);
    expect(eventsFor(transport, "createRefresh")[1]).not.toHaveProperty("password");
    expect(eventsFor(transport, "createRefresh")[1]).not.toHaveProperty("idToken");
  });

  it("preserves a createRefresh authentication error while recording a failed terminal event", async () => {
    const transport = captureEvents();
    mocks.verifyIdToken.mockRejectedValue(new Error("ID token rejected"));

    await expect(createRefresh("password", "id-token")).rejects.toThrow("ID token rejected");

    expect(eventsFor(transport, "createRefresh")).toEqual([
      expect.objectContaining({ operation: "createRefresh", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "createRefresh",
        lifecycle: "failed",
        level: "error",
        reason: "authentication_failed",
      }),
    ]);
  });

  it("records revokeSession success before its existing login redirect", async () => {
    const transport = captureEvents();
    mocks.cookieGet.mockReturnValue({ value: "session-cookie" });
    mocks.verifySessionCookie.mockResolvedValue({ sub: "user-a" });

    await expect(revokeSession()).rejects.toThrow("REDIRECT:/login");

    expect(eventsFor(transport, "revokeSession")).toEqual([
      expect.objectContaining({ operation: "revokeSession", lifecycle: "started", level: "info" }),
      expect.objectContaining({
        operation: "revokeSession",
        lifecycle: "succeeded",
        level: "info",
        durationMs: expect.any(Number),
      }),
    ]);
    expect(mocks.revokeRefreshTokens).toHaveBeenCalledWith("user-a");
  });
});
