import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/document/delete_document", () => ({ removeDocument: vi.fn() }));
import ArchiveView from "@/app/(protected)/dashboard/archive_view";

it("shows a download action for each available document", () => {
  const row = { docId: "doc-a", title: "Lecture", fileName: "lecture.pdf", status: "ready", type: "PDF", typeColor: "black", size: "1 KB", statusLabel: "Ready", statusTone: "success", addedLabel: "Today", uploadedAt: 0 };
  const html = renderToStaticMarkup(createElement(ArchiveView, { rows: [row] as never, stats: { count: 1, familyCount: 1, totalSize: "1 KB" }, isEmpty: false }));
  expect(html).toMatch(/href="\/api\/documents\/doc-a\/open\?download=1"[^>]*>Download<\/a>/);
});
