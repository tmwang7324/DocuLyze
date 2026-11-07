import { describe, expect, it } from "vitest";
import { citedNumbers, resolveOpenSource, splitCitations } from "@/_lib/citations";

describe("chat ticket 04 — citation markers", () => {
  it("splits answer text into text and [n] citation segments", () => {
    expect(splitCitations("Heaps are trees [1][3]. Done.", 3)).toEqual([
      { kind: "text", text: "Heaps are trees " },
      { kind: "cite", n: 1 },
      { kind: "cite", n: 3 },
      { kind: "text", text: ". Done." },
    ]);
  });

  it("leaves numbers with no matching Source as plain text", () => {
    expect(splitCitations("See [7] and [0].", 3)).toEqual([{ kind: "text", text: "See [7] and [0]." }]);
  });

  it("lists which Sources were cited, so the rest can show as 'Also searched'", () => {
    expect(citedNumbers("A [2]. B [2][1].", 3)).toEqual(new Set([1, 2]));
  });
});

describe("chat ticket 04 — citation sidebar", () => {
  const src = (n: number, file: string) => ({ n, doc_id: `d${n}`, file_name: file, section: "S", text: `text ${n}` });
  const messages = [
    { sources: [src(1, "a.pdf"), src(2, "b.pdf")] },
    { sources: undefined },
    { sources: [src(1, "c.pdf")] },
  ];

  it("resolves the clicked chip to that message's own Source (numbers repeat across messages)", () => {
    expect(resolveOpenSource(messages, { messageIndex: 2, n: 1 })?.file_name).toBe("c.pdf");
    expect(resolveOpenSource(messages, { messageIndex: 0, n: 2 })?.file_name).toBe("b.pdf");
  });

  it("shows nothing when no chip is open or the Source can't be found", () => {
    expect(resolveOpenSource(messages, null)).toBeNull();
    expect(resolveOpenSource(messages, { messageIndex: 1, n: 1 })).toBeNull();
    expect(resolveOpenSource(messages, { messageIndex: 9, n: 1 })).toBeNull();
  });
});
