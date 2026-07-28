import { describe, it, expect } from "vitest";
import { passwordMatchState, MIN_PASSWORD_LENGTH } from "@/_lib/password_match";

// Seam: the pure state function behind the registration form's live
// password-match affordance (issue #24). The markup around it is verified by
// eye — this is the branching logic, so it is the part worth pinning.
//
// Precedence under test, in order:
//   1. nothing typed in confirm yet   -> "idle"      (don't nag mid-typing)
//   2. the two fields disagree        -> "mismatch"  (the actionable signal)
//   3. they agree but it's too short  -> "too-short" (matches the server gate)
//   4. otherwise                      -> "match"
describe("passwordMatchState", () => {
    it("stays idle until the confirm field has something in it", () => {
        expect(passwordMatchState("", "")).toBe("idle");
        expect(passwordMatchState("hunter2hunter2", "")).toBe("idle");
    });

    it("reports a mismatch as soon as the two fields disagree", () => {
        expect(passwordMatchState("hunter2hunter2", "hunter2hunter")).toBe("mismatch");
        // Typing into confirm before password is still a disagreement, not idle.
        expect(passwordMatchState("", "h")).toBe("mismatch");
    });

    it("reports a matching pair that is under the server's minimum as too short", () => {
        // form_validation.tsx rejects anything under 8 characters server-side;
        // saying "match" for a pair that the submit will bounce is a lie.
        expect(passwordMatchState("short", "short")).toBe("too-short");
    });

    it("reports a match once the fields agree and clear the minimum", () => {
        expect(passwordMatchState("hunter2hunter2", "hunter2hunter2")).toBe("match");
    });

    it("treats exactly the minimum length as long enough", () => {
        const exact = "12345678";
        expect(exact).toHaveLength(MIN_PASSWORD_LENGTH);
        expect(passwordMatchState(exact, exact)).toBe("match");
    });

    it("does not trim or normalize — a trailing space is a different password", () => {
        expect(passwordMatchState("hunter2hunter2", "hunter2hunter2 ")).toBe("mismatch");
    });
});
