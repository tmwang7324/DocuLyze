import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUid: vi.fn(),
  runTransaction: vi.fn(),
  transactionGet: vi.fn(),
  transactionUpdate: vi.fn(),
  publishDeleteJob: vi.fn(),
  revalidatePath: vi.fn(),
}));

const ref = { firestore: { runTransaction: mocks.runTransaction } };

vi.mock("@/_lib/data", () => ({ requireUid: mocks.requireUid }));
vi.mock("@/_lib/database", () => ({
  documentRef: vi.fn(() => ref),
  documentStoragePath: (uid: string, docId: string) => `users/${uid}/documents/${docId}`,
}));
vi.mock("@/_lib/admin", () => ({ storage: { bucket: vi.fn() } }));
vi.mock("@/_lib/delete_broker", () => ({ publishDeleteJob: mocks.publishDeleteJob }));
vi.mock("@/_lib/operational_logger", () => ({
  logOperationalEvent: vi.fn(),
  runWithRequestContext: (operation: () => unknown) => operation(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { removeDocument } from "@/app/actions/document/delete_document";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUid.mockResolvedValue("user-a");
  mocks.publishDeleteJob.mockResolvedValue(undefined);
  mocks.runTransaction.mockImplementation(async (operation) =>
    operation({ get: mocks.transactionGet, update: mocks.transactionUpdate }),
  );
});

describe("removeDocument", () => {
  it("marks the owned record deleting before publishing its pointer", async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: true,
      get: vi.fn().mockReturnValue("ready"),
    });

    await expect(removeDocument("doc-a")).resolves.toEqual({ ok: true, state: "deleting" });

    expect(mocks.transactionUpdate).toHaveBeenCalledWith(
      ref,
      expect.objectContaining({ status: "deleting" }),
    );
    expect(mocks.publishDeleteJob).toHaveBeenCalledWith("user-a", "doc-a");
    expect(mocks.transactionUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishDeleteJob.mock.invocationCallOrder[0],
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("treats an already absent record as complete without publishing", async () => {
    mocks.transactionGet.mockResolvedValue({ exists: false });

    await expect(removeDocument("doc-a")).resolves.toEqual({ ok: true, state: "absent" });

    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
    expect(mocks.publishDeleteJob).not.toHaveBeenCalled();
  });
});
