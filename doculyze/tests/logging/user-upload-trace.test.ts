import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Transport from "winston-transport";
import { createLogger } from "winston";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  verifySessionCookie: vi.fn(),
  createSessionCookie: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
  revalidatePath: vi.fn(),
  createChannel: vi.fn(),
}));

// Authentication is outside this server-action seam. The upload's Firestore and
// Storage operations remain real against their emulators; only token verification
// and the browser-owned session cookie are injected here.
vi.mock("@/_lib/data", () => ({
  getCurrentUid: async () => (globalThis as Record<string, unknown>).__TEST_UID__ ?? null,
  requireUid: async () => {
    const uid = (globalThis as Record<string, unknown>).__TEST_UID__;
    if (!uid) throw new Error("User is not authenticated");
    return uid as string;
  },
}));
vi.mock("@/_lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/_lib/admin")>();
  return {
    ...actual,
    adminAuth: {
      verifyIdToken: mocks.verifyIdToken,
      verifySessionCookie: mocks.verifySessionCookie,
      createSessionCookie: mocks.createSessionCookie,
    },
  };
});
vi.mock("@/_lib/rabbitmq", () => ({ createChannel: mocks.createChannel }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet, delete: mocks.cookieDelete }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));

import { createRefresh } from "@/app/actions/auth/session";
import { finalizeUpload, getPresignedUrl } from "@/app/actions/document/upload_document";
import { documentStoragePath } from "@/_lib/database";
import {
  resetOperationalLoggerForTests,
  setOperationalLoggerForTests,
} from "@/_lib/operational_logger";
import { authAs, resetEmulators, seedStorageObject } from "../helpers/harness";

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

function requestIdsFor(transport: CapturingTransport, operations: readonly string[]): Set<unknown> {
  return new Set(
    transport.events
      .filter((event) => operations.includes(event.operation as string))
      .map((event) => event.requestId),
  );
}

const UID = "trace-user";
const PASSWORD = "correct-horse-battery-staple";
const ID_TOKEN = "header.private-token.signature";
const SESSION_COOKIE = "sensitive-session-cookie";
const FILE_NAME = "confidential-roadmap.txt";
const TITLE = "Confidential roadmap";
const CONTENTS = "do not log this document content";

beforeEach(async () => {
  await resetEmulators();
  authAs(UID);
  vi.clearAllMocks();
  mocks.verifyIdToken.mockResolvedValue({ uid: UID, email: "trace-user@example.test" });
  mocks.verifySessionCookie.mockResolvedValue(null);
  mocks.createSessionCookie.mockResolvedValue(SESSION_COOKIE);
  mocks.cookieGet.mockReturnValue(undefined);
  mocks.createChannel.mockResolvedValue({
    sendToQueue: (_queue: string, _body: Buffer, _options: object, callback: (error: Error | null) => void) => callback(null),
  });
});

afterEach(() => resetOperationalLoggerForTests());

describe("user authentication and document upload trace seam", () => {
  it("traces a signed-in user's upload lifecycle without exposing supplied secrets", async () => {
    const transport = captureEvents();

    await expect(createRefresh(PASSWORD, ID_TOKEN)).rejects.toThrow("REDIRECT:/dashboard");

    const presign = await getPresignedUrl(FILE_NAME, TITLE, Buffer.byteLength(CONTENTS));
    expect(presign).toMatchObject({
      docId: expect.any(String),
      contentType: "text/plain",
      url: expect.any(String),
    });
    await seedStorageObject(
      documentStoragePath(UID, presign.docId),
      CONTENTS,
      presign.contentType,
    );

    await expect(
      finalizeUpload(presign.docId, FILE_NAME, Buffer.byteLength(CONTENTS), presign.contentType, TITLE),
    ).resolves.toEqual({ enqueue: "queued" });

    expect(transport.events.map((event) => [event.operation, event.lifecycle])).toEqual([
      ["createRefresh", "started"],
      ["createUserProfile", "succeeded"],
      ["createRefresh", "succeeded"],
      ["getPresignedUrl", "started"],
      ["validateUploadClaim", "passed"],
      ["mintDocumentRecord", "succeeded"],
      ["getPresignedUrl", "succeeded"],
      ["finalizeUpload", "started"],
      ["finalizeDocumentRecord", "succeeded"],
      ["publishIngestJob", "started"],
      ["publishIngestJob", "queued"],
      ["finalizeUpload", "queued"],
    ]);

    const authIds = requestIdsFor(transport, ["createRefresh", "createUserProfile"]);
    const presignIds = requestIdsFor(transport, ["getPresignedUrl", "validateUploadClaim", "mintDocumentRecord"]);
    const finalizeIds = requestIdsFor(transport, ["finalizeUpload", "finalizeDocumentRecord", "publishIngestJob"]);
    expect(authIds.size).toBe(1);
    expect(presignIds.size).toBe(1);
    expect(finalizeIds.size).toBe(1);
    expect([...authIds][0]).not.toBe([...presignIds][0]);
    expect([...presignIds][0]).not.toBe([...finalizeIds][0]);

    const serializedTrace = JSON.stringify(transport.events);
    for (const secret of [PASSWORD, ID_TOKEN, SESSION_COOKIE, FILE_NAME, TITLE, CONTENTS]) {
      expect(serializedTrace).not.toContain(secret);
    }
  });
});
