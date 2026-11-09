import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/document/delete_document", () => ({ removeDocument: vi.fn() }));
import ArchiveView from "@/app/(protected)/dashboard/archive_view";
import { projectArchive } from "@/_lib/archive_projection";

it.each(["", "   "])("renders the filename inside the link for a blank title %j", (title) => {
  const archive = projectArchive([{ docId: "doc-a", title, file_name: "lecture.pdf", size: 100, status: "ready", uploadedAt: null }]);
  const html = renderToStaticMarkup(createElement(ArchiveView, archive));
  expect(html).toMatch(/href="\/api\/documents\/doc-a\/open"[^>]*>lecture\.pdf<\/a>/);
});
