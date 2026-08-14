import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Transport from "winston-transport";
import { createLogger } from "winston";

// The session boundary is outside the DAL seam; Firestore stays emulator-backed.
vi.mock("@/_lib/data", () => ({
  requireUid: async () => (globalThis as Record<string, unknown>).__TEST_UID__ as string,
}));

import {
  createUserProfile,
  DuplicateDocumentError,
  finalizeDocumentRecord,
  listDocuments,
  mintDocumentRecord,
  reapStalePendingDocuments,
} from "@/_lib/database";
import {
  resetOperationalLoggerForTests,
  setOperationalLoggerForTests,
} from "@/_lib/operational_logger";
import { authAs, backdateDocument, resetEmulators } from "../helpers/harness";

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

beforeEach(async () => {
  await resetEmulators();
  authAs("user-a");
});

afterEach(() => resetOperationalLoggerForTests());

describe("Firestore data-layer operation lifecycle seam", () => {
  it("lists documents with one safe terminal event and a status aggregate", async () => {
    await mintDocumentRecord({
      file_name: "confidential-notes.txt",
      title: "Confidential notes",
      contentType: "text/plain",
      size: 3,
      status: "uploaded",
    });
    const transport = captureEvents();

    await expect(listDocuments()).resolves.toHaveLength(1);

    expect(transport.events).toEqual([
      expect.objectContaining({
        operation: "listDocuments",
        lifecycle: "succeeded",
        level: "info",
        durationMs: expect.any(Number),
        documentCount: 1,
        statusCounts: { uploaded: 1 },
      }),
    ]);
    expect(transport.events[0]).not.toHaveProperty("file_name");
    expect(transport.events[0]).not.toHaveProperty("title");
  });

  it("mints a document with one safe terminal event", async () => {
    const transport = captureEvents();

    const result = await mintDocumentRecord({
      file_name: "confidential-notes.txt",
      title: "Confidential notes",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });

    expect(transport.events).toEqual([
      expect.objectContaining({
        operation: "mintDocumentRecord",
        lifecycle: "succeeded",
        level: "info",
        durationMs: expect.any(Number),
        docId: result.docId,
        status: "pending",
      }),
    ]);
    expect(transport.events[0]).not.toHaveProperty("file_name");
    expect(transport.events[0]).not.toHaveProperty("title");
  });

  it("finalizes a document with one safe terminal event", async () => {
    const { docId } = await mintDocumentRecord({
      file_name: "confidential-notes.txt",
      title: "Confidential notes",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });
    const transport = captureEvents();

    await expect(finalizeDocumentRecord({
      docId,
      file_name: "confidential-notes.txt",
      title: "Confidential notes",
      contentType: "text/plain",
      size: 3,
      status: "uploaded",
    })).resolves.toBeUndefined();

    expect(transport.events).toEqual([
      expect.objectContaining({
        operation: "finalizeDocumentRecord",
        lifecycle: "succeeded",
        level: "info",
        durationMs: expect.any(Number),
        docId,
        status: "uploaded",
      }),
    ]);
    expect(transport.events[0]).not.toHaveProperty("file_name");
    expect(transport.events[0]).not.toHaveProperty("title");
  });

  it("reaps stale pending documents with one safe terminal event", async () => {
    const { docId } = await mintDocumentRecord({
      file_name: "confidential-notes.txt",
      title: "Confidential notes",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });
    await backdateDocument("user-a", docId, 2 * 60 * 60 * 1000);
    const transport = captureEvents();

    await expect(reapStalePendingDocuments()).resolves.toBe(1);

    expect(transport.events).toEqual([
      expect.objectContaining({
        operation: "reapStalePendingDocuments",
        lifecycle: "succeeded",
        level: "info",
        durationMs: expect.any(Number),
        reapedCount: 1,
      }),
    ]);
  });

  it("creates a user profile with one safe terminal event", async () => {
    const transport = captureEvents();

    await expect(createUserProfile({
      email: "user@example.test",
      password: "correct horse battery staple",
      sessionCookie: "session-cookie",
    })).resolves.toBe("user-a");

    expect(transport.events).toEqual([
      expect.objectContaining({
        operation: "createUserProfile",
        lifecycle: "succeeded",
        level: "info",
        durationMs: expect.any(Number),
        userId: "user-a",
      }),
    ]);
    expect(transport.events[0]).not.toHaveProperty("email");
    expect(transport.events[0]).not.toHaveProperty("password");
    expect(transport.events[0]).not.toHaveProperty("sessionCookie");
  });

  it("preserves a duplicate rejection while logging one safe terminal event", async () => {
    await mintDocumentRecord({
      file_name: "confidential-notes.txt",
      title: "Confidential notes",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    });
    const transport = captureEvents();

    await expect(mintDocumentRecord({
      file_name: "confidential-notes.txt",
      title: "Another title",
      contentType: "text/plain",
      size: 3,
      status: "pending",
    })).rejects.toBeInstanceOf(DuplicateDocumentError);

    expect(transport.events).toEqual([
      expect.objectContaining({
        operation: "mintDocumentRecord",
        lifecycle: "rejected",
        level: "warn",
        durationMs: expect.any(Number),
        reason: "duplicate_document",
      }),
    ]);
    expect(JSON.stringify(transport.events)).not.toContain("confidential-notes.txt");
  });
});
