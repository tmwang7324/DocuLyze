import { expect, it, vi } from "vitest";

const getReadPresignedURL = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/document/delete_document", () => ({ getReadPresignedURL }));
import { GET } from "@/app/api/documents/[docId]/open/route";

it("redirects to an authorized signed URL without caching it", async () => {
  getReadPresignedURL.mockResolvedValueOnce("https://storage.example.test/signed");
  const response = await GET(new Request("https://example.test"), { params: Promise.resolve({ docId: "doc-a" }) });
  expect(getReadPresignedURL).toHaveBeenCalledWith("doc-a", false);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://storage.example.test/signed");
  expect(response.headers.get("cache-control")).toContain("no-store");
});

it("requests attachment disposition for a download", async () => {
  getReadPresignedURL.mockResolvedValueOnce("https://storage.example.test/signed");
  await GET(new Request("https://example.test?download=1"), { params: Promise.resolve({ docId: "doc-a" }) });
  expect(getReadPresignedURL).toHaveBeenLastCalledWith("doc-a", true);
});

it("does not redirect when access is denied", async () => {
  getReadPresignedURL.mockRejectedValueOnce(new Error("denied"));
  const response = await GET(new Request("https://example.test"), { params: Promise.resolve({ docId: "doc-a" }) });
  expect(response.status).toBe(404);
  expect(response.headers.get("location")).toBeNull();
});
