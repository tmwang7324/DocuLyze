"use client";

import React from 'react'
import { createRefresh } from '@/app/actions/auth/session';
import { validateEmailAndPassword } from '@/app/actions/auth/form_validation'
import { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/_lib/firebase';
import { useRouter } from "next/navigation"
import { SubmitButton } from '@/components/button'
import { passwordMatchState, MIN_PASSWORD_LENGTH } from '@/_lib/password_match'

// Renders whatever passwordMatchState decided. Module scope, not nested in
// RegisterForm: a component defined inside another is a new type on every render,
// so React would unmount and remount it on each keystroke. aria-live so the
// change is announced as the user types rather than only being a colour shift.
const MatchHint = ({ state }: { state: ReturnType<typeof passwordMatchState> }) => {
  if (state === "idle") return null;
  const [symbol, text, tone] =
    state === "match"
      ? ["✓", "Passwords match", "text-ok"]
      : state === "too-short"
        ? ["!", `Use at least ${MIN_PASSWORD_LENGTH} characters`, "text-muted"]
        : ["✗", "Passwords don't match", "text-orange-deep"];
  return (
    <p
      aria-live="polite"
      className={`mt-2 flex items-center gap-2 font-mono-label text-[11px] tracking-wide uppercase ${tone}`}
    >
      <span aria-hidden="true">{symbol}</span>
      {text}
    </p>
  );
};

const RegisterForm = () => {
  const [errorMessage, setErrorMessage] = useState("");
  const router = useRouter();

  // Issue #24: the live password-match affordance. Both fields are controlled so
  // the hint can update as the user types; the decision itself lives in the pure
  // passwordMatchState (tested in tests/auth/password-match.test.ts) rather than
  // in this component. This is UX only — validateEmailAndPassword below is still
  // the gate that decides whether an account gets created.
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const matchState = passwordMatchState(password, confirmPassword);

  const handleRegisterSubmit = async (formData: FormData) => {
    try {
        const email = formData.get("email")?.toString() || '';
        const password = formData.get("password")?.toString() || '';
        const confirm = formData.get("confirm_password")?.toString() || '';
        // Don't create an account against a password the user mistyped in one of
        // the two boxes — they'd be locked out of a credential they can't reproduce.
        if (passwordMatchState(password, confirm) === "mismatch") {
            throw new Error("Passwords do not match.");
        }
        // server-side action
        await validateEmailAndPassword(email, password);
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        const idToken: string = await user.getIdToken();
        if (!idToken) {
            throw new Error("Failed to retrieve ID token from Firebase user");
        }
        const cookie = await createRefresh(password, idToken);
        // router.push("/dashboard");
    } catch (error: any) {
        setErrorMessage(error.message);
    }
    
  }
  // Issue #24: markup only below this line, plus the match hint. The registration
  // flow above is untouched — server-side validation, Firebase account creation,
  // then the ID token exchanged for a session cookie by createRefresh.
  return (
    <div>
      <form action={handleRegisterSubmit}>

        <div className="mb-5">
          <label htmlFor="register-email" className="block font-mono-label text-[11px] tracking-widest uppercase text-muted mb-2">
            Email
          </label>
          <input
            type="email"
            name="email"
            id="register-email"
            autoComplete="email"
            placeholder="you@company.com"
            className="w-full border-2 border-dark bg-white px-4 py-3 font-body text-sm text-dark placeholder:text-placeholder outline-none focus:border-orange-primary transition-colors"
          ></input>
        </div>
        <div className="mb-5">
          <label htmlFor="register-password" className="block font-mono-label text-[11px] tracking-widest uppercase text-muted mb-2">
            Password
          </label>
          <input
            type="password"
            name="password"
            id="register-password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border-2 border-dark bg-white px-4 py-3 font-body text-sm text-dark placeholder:text-placeholder outline-none focus:border-orange-primary transition-colors"
          ></input>
          <p className="mt-2 font-mono-label text-[11px] tracking-wide uppercase text-muted">
            At least {MIN_PASSWORD_LENGTH} characters
          </p>
        </div>
        <div className="mb-5">
          <label htmlFor="register-confirm-password" className="block font-mono-label text-[11px] tracking-widest uppercase text-muted mb-2">
            Confirm password
          </label>
          <input
            type="password"
            name="confirm_password"
            id="register-confirm-password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={`w-full border-2 bg-white px-4 py-3 font-body text-sm text-dark placeholder:text-placeholder outline-none focus:border-orange-primary transition-colors ${
              matchState === "mismatch" ? "border-orange-primary" : "border-dark"
            }`}
          ></input>
          <MatchHint state={matchState} />
        </div>
        <SubmitButton label="Register" loading="Registering..." />
        {errorMessage && (
          <p
            role="alert"
            className="mt-5 border-l-2 border-orange-primary bg-orange-pale px-4 py-3 font-body text-sm text-orange-deep"
          >
            {errorMessage}
          </p>
        )}
      </form>
    </div>
  )
}

export default RegisterForm;