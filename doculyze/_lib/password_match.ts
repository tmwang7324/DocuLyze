// The live password-match affordance on the registration form (issue #24).
//
// Neutral module — no "use client" / "server-only" — following the same pattern
// as fileupload_schema.ts, so the state logic sits outside the component and can
// be tested without a DOM. The component renders this; it does not decide it.
//
// This is a UX affordance, NOT a trust boundary. The real gate is
// validateEmailAndPassword (app/actions/auth/form_validation.tsx), which runs
// server-side on submit and rejects anything under MIN_PASSWORD_LENGTH.

// Mirrors the server gate in form_validation.tsx and the `minLength={8}` on both
// password inputs. If that rule moves, this moves with it.
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordMatchState = "idle" | "mismatch" | "too-short" | "match";

export function passwordMatchState(password: string, confirm: string): PasswordMatchState {
    // Nothing to say until they've started confirming — no red text mid-typing.
    if (confirm.length === 0) return "idle";
    // Compared raw: a trailing space really is a different password.
    if (password !== confirm) return "mismatch";
    // They agree, but submit would bounce it — say so rather than claim "match".
    if (password.length < MIN_PASSWORD_LENGTH) return "too-short";
    return "match";
}
