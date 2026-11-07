import { describe, expect, it } from "vitest";
import { resolveScope } from "@/_lib/scope";

// Pure: no Firestore. The route-handler tests cover how a Scope is stored and sent.
const A = { doc_id: "a", file_name: "a.pdf" };
const B = { doc_id: "b", file_name: "b.pdf" };
const C = { doc_id: "c", file_name: "c.pdf" };

describe("chat ticket 08 — resolveScope", () => {
  it("searches every ready document when nothing is pinned", () => {
    expect(resolveScope(undefined, [A, B, C])).toEqual({ documents: [A, B, C], widened: false });
    expect(resolveScope([], [A, B, C])).toEqual({ documents: [A, B, C], widened: false });
  });

  it("limits the search to the pinned documents", () => {
    expect(resolveScope(["b"], [A, B, C])).toEqual({ documents: [B], widened: false });
  });

  it("drops pinned documents that are no longer ready (deleted or reprocessing)", () => {
    expect(resolveScope(["a", "b"], [A, C])).toEqual({ documents: [A], widened: false });
  });

  it("widens to everything, and says so, when no pinned document is left", () => {
    expect(resolveScope(["gone"], [A, B])).toEqual({ documents: [A, B], widened: true });
  });

  it("never searches zero documents on its own — an empty library stays empty", () => {
    expect(resolveScope(["gone"], [])).toEqual({ documents: [], widened: false });
  });

  it("ignores ids the caller doesn't own: only their ready documents can ever be in Scope", () => {
    expect(resolveScope(["someone-elses", "b"], [A, B])).toEqual({ documents: [B], widened: false });
  });
});
