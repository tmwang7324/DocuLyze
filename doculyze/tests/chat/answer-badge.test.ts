import { describe, expect, it } from "vitest";
import { answerBadge } from "@/_lib/answer_mode";

describe("answer mode badges", () => {
  it("grounded answers carry no badge", () => {
    expect(answerBadge({ answerMode: "grounded", route: "retrieve" })).toBeNull();
  });

  it("open answers may include general knowledge", () => {
    expect(answerBadge({ answerMode: "open", route: "retrieve" })).toBe("May include general knowledge");
  });

  it("an open out_of_scope answer is wholly general knowledge", () => {
    expect(answerBadge({ answerMode: "open", route: "out_of_scope" })).toBe("General knowledge");
  });

  it("messages from before the setting (no mode recorded) carry no badge", () => {
    expect(answerBadge({})).toBeNull();
    expect(answerBadge({ route: "retrieve" })).toBeNull();
  });
});
