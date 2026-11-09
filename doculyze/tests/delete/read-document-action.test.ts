import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUid: vi.fn(), get: vi.fn(), exists: vi.fn(), getSignedUrl: vi.fn(), file: vi.fn(),
}));
vi.mock("@/_lib/data", () => ({ requireUid: mocks.requireUid }));
vi.mock("@/_lib/database", () => ({
  documentRef: vi.fn(() => ({ get: mocks.get })),
  documentStoragePath: (uid: string, id: string) => `users/${uid}/documents/${id}`,
}));
vi.mock("@/_lib/admin", () => ({ storage: { bucket: () => ({ file: mocks.file }) } }));
vi.mock("@/_lib/delete_broker", () => ({ publishDeleteJob: vi.fn() }));
vi.mock("@/_lib/operational_logger", () => ({
  logOperationalEvent: vi.fn(), runWithRequestContext: (fn: () => unknown) => fn(),
}));
import { getReadPresignedURL } from "@/app/actions/document/delete_document";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUid.mockResolvedValue("user-a");
  mocks.exists.mockResolvedValue([true]);
  mocks.getSignedUrl.mockResolvedValue(["https://example.test/signed"]);
  mocks.file.mockReturnValue({ exists: mocks.exists, getSignedUrl: mocks.getSignedUrl });
});

it.each([["notes.pdf", "inline", "application/pdf"], ["page.html", "attachment", undefined]])(
  "signs %s with a safe viewing disposition", async (fileName, disposition, responseType) => {
    mocks.get.mockResolvedValue({ exists: true, get: (key: string) => key === "file_name" ? fileName : "ready" });
    await expect(getReadPresignedURL("doc-a")).resolves.toBe("https://example.test/signed");
    expect(mocks.file).toHaveBeenCalledWith("users/user-a/documents/doc-a");
    expect(mocks.getSignedUrl).toHaveBeenCalledWith(expect.objectContaining({
      responseDisposition: expect.stringMatching(new RegExp(`^${disposition};`)),
      ...(responseType ? { responseType } : {}),
    }));
  },
);

it("forces PDF downloads to use an attachment disposition", async () => {
  mocks.get.mockResolvedValue({ exists: true, get: (key: string) => key === "file_name" ? "notes.pdf" : "ready" });
  await getReadPresignedURL("doc-a", true);
  expect(mocks.getSignedUrl).toHaveBeenCalledWith(expect.objectContaining({
    responseDisposition: expect.stringMatching(/^attachment;/),
  }));
});
