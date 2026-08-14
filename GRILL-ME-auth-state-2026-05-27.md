# Grill Me Session — User Auth State Handling
**Date:** 2026-05-27  
**Topic:** Global auth state, session management, and route protection architecture

---

## Context

The goal is to separate backend session management from fast client-side rendering. Firebase `onAuthStateChanged` drives UI state; backend session cookies control route and data access.

---

## Questions & Decisions

---

### Q1: What is the single source of truth for "is this user authenticated"?

**Options:**
- **A — Firebase client SDK.** `onAuthStateChanged` controls everything. Handle 401s reactively by logging the user out client-side.
- **B — Backend session cookie.** Ping a protected endpoint on load; 200 = authenticated, 401 = not.

**Initial answer: A**

**Revised mid-session:** Neither exclusively. The architecture uses **two parallel systems**:
- **`onAuthStateChanged`** drives the client-side `AuthProvider` context (UI rendering, navbar, page visibility).
- **Backend session cookie** drives route access (Next.js middleware) and data access (`requireAuth` on protected API endpoints).

These systems do not cross-talk. Middleware gates *access*; `onAuthStateChanged` gates *rendering*. The `AuthProvider` never calls the backend.

---

### Q2: How will you handle the auth loading state between page load and the first `onAuthStateChanged` callback?

**Options:**
- **A — Three-state model: `loading | User | null`.** Global state starts as `loading`, resolves to `User` or `null`. UI shows a skeleton while loading.
- **B — Optimistic render.** Assume logged in on load, correct if observer returns `null`.
- **C — Ignore it.** Accept the brief flash.

**Answer: A**

State shape: `{ user: User | null, loading: boolean }`. `loading: true` until the observer fires for the first time. `null` means definitively not logged in; the loading state means "we don't know yet."

---

### Q3: Where does the global auth state live?

**Options:**
- **A — React Context in `providers.tsx`.** `AuthProvider` client component subscribes to `onAuthStateChanged`, holds state, wraps app in `layout.tsx`. Consumers call `useAuth()`.
- **B — External state library (Zustand, Jotai).** A store holds auth state; a top-level `useEffect` writes to it.

**Answer: A**

React Context is sufficient for a single rarely-changing piece of state read by many components. `providers.tsx` exports an `AuthProvider` (`"use client"`), `layout.tsx` wraps `{children}` with it.

The `onAuthStateChanged` call currently at module level in `_lib/firebase.tsx` must move into a `useEffect` inside `AuthProvider`. The module-level call should be removed.

---

### Q4: How will you protect the `/dashboard` route from unauthenticated access?

**Options:**
- **A — Redirect inside `dashboard/page.tsx`.** `useAuth()` + `router.push("/login")` if unauthenticated. Brief flash possible.
- **B — Redirect in `dashboard/layout.tsx`.** Centralizes guard for all nested dashboard routes. Same timing issue.
- **C — Next.js Middleware (`middleware.ts`).** Runs server-side before any page renders. Reads session cookie, redirects to `/login` if missing. Zero flash.

**Answer: C**

Middleware checks `req.cookies.get("session")`; if absent, redirects to `/login`. No cryptographic verification in middleware — Edge Runtime cannot run `firebase-admin`. Real verification happens at the API layer. A secondary `useAuth()` guard in the layout acts as a mid-session safety net.

---

### Q5: Who is responsible for redirecting to `/dashboard` after a successful login — the `onAuthStateChanged` observer or the login/register submit handler?

**Options:**
- **A — The observer redirects.** `onAuthStateChanged` fires, sees a non-null user, calls `router.push("/dashboard")`. Runs before `createUserSessionOnBackend` completes → middleware blocks redirect (no cookie yet).
- **B — The submit handler redirects.** After `await createUserSessionOnBackend(...)` resolves, the handler calls `router.push("/dashboard")`. Observer only manages persistent state on page refreshes.

**Answer: B**

The observer's responsibility is restoring state on cold page loads — not reacting to a login event already handled synchronously in the handler. Mixing navigation into the observer creates a race condition where middleware checks for a session cookie that hasn't been created yet.

---

### Q6: What is the logout sequence?

**Options:**
- **A — Client first.** `signOut(auth)` then `POST /api/session/logout`. Session cookie lingers if backend call fails.
- **B — Backend first.** `POST /api/session/logout` then `signOut(auth)`. Broken state if `signOut` fails.
- **C — Parallel.** `Promise.allSettled([signOut(auth), fetch("/api/session/logout")])`. Both run independently; redirect after both settle.

**Answer: C**

The two operations are independent. `Promise.allSettled` tolerates partial failure — if one fails, the other still ran. A `POST /api/session/logout` endpoint must be added to the backend that calls `res.clearCookie("session")`.

---

### Q7: How will you handle a 401 response from a protected backend route?

**Options:**
- **A — Handle per-call.** Each fetch checks status and calls logout inline.
- **B — Centralize in `api.tsx`.** A fetch wrapper intercepts 401s and triggers logout automatically. All components use this wrapper.
- **C — Ignore for now.** Session cookie is valid for 5 days; edge case for later.

**Initial answer: C (deferred)**

**Revised:** Centralize in `api.tsx` (Option B). On any 401:
1. Call `signOut(auth)` — clears Firebase client state, triggers `onAuthStateChanged(null)`, resets `AuthProvider` to `{ user: null, loading: false }`.
2. `window.location.href = "/login"` — hard redirect (avoids `useRouter` hook dependency in `api.tsx`).

```typescript
async function apiFetch(url: string, options?: RequestInit) {
    const response = await fetch(url, { credentials: "include", ...options });
    if (response.status === 401) {
        await signOut(auth);
        window.location.href = "/login";
    }
    return response;
}
```

This resolves the mid-session gap: if the session cookie expires while the user is on the dashboard, their next data fetch 401s, `signOut` syncs Firebase state, and they're redirected to login.

---

### Q8: Will you add a dedicated session-verification endpoint or reuse an existing one?

**Options:**
- **A — Add `GET /api/session/verify`.** Uses `requireAuth`, returns `{ email, uid }` on 200, 401 if invalid. Single-purpose, clearly named.
- **B — Reuse `GET /api/dashboard`.** Couples auth check to a data endpoint — fragile.

**Answer: A**

> **Note:** This question was originally asked under the assumption that `AuthProvider` would call the backend to verify the session on mount. That assumption was later invalidated (see Q1 revision — `AuthProvider` only subscribes to `onAuthStateChanged`). The endpoint is still useful as a clean protected route for other purposes, but `AuthProvider` does not call it.

---

### Q9: What happens when `onAuthStateChanged` reports a valid user but the session cookie is expired mid-session?

Firebase auto-refreshes its own ID token, so the observer keeps reporting a valid user even after the backend session cookie expires. Middleware already let the user through on the initial load. The only signal available is a 401 from a protected API call.

**Answer:** Resolved by Q7. The `apiFetch` wrapper catches the 401, calls `signOut(auth)`, and redirects to `/login`. No additional handling needed.

---

## Final Architecture Summary

| Concern | Mechanism |
|---|---|
| Client-side auth state (`user`, `loading`) | `onAuthStateChanged` → `AuthProvider` React Context |
| Route protection (unauthenticated access) | Next.js Middleware — checks `session` cookie existence |
| Data access protection | `requireAuth` middleware on Express routes — verifies `session` cookie via Firebase Admin SDK |
| Loading state | `{ user: User \| null, loading: boolean }` — `loading: true` until observer fires |
| Post-login redirect | Submit handler — after `createUserSessionOnBackend` resolves |
| Logout | `Promise.allSettled([signOut(auth), POST /api/session/logout])` |
| Mid-session 401 handling | `apiFetch` wrapper in `api.tsx` — `signOut` + `window.location.href = "/login"` |
| Session verification endpoint | `GET /api/session/verify` (uses `requireAuth`, returns `{ email, uid }`) |

## Implementation Checklist

- [ ] `providers.tsx` — implement `AuthProvider` with `useEffect` → `onAuthStateChanged` subscription; expose `{ user, loading }` via context
- [ ] `_lib/firebase.tsx` — remove module-level `onAuthStateChanged` call
- [ ] `_lib/api.tsx` — add `apiFetch` wrapper with 401 interceptor (`signOut` + redirect)
- [ ] `middleware.ts` (repo root of `doculyze/`) — check `session` cookie; redirect to `/login` if absent
- [ ] `backend/server.js` + `backend/apiFunctions.js` — add `GET /api/session/verify` and `POST /api/session/logout` endpoints
- [ ] `app/login/page.tsx` + `app/register/page.tsx` — redirect to `/dashboard` in submit handler after `createUserSessionOnBackend` resolves
