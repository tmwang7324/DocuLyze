# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working with the user's code

Do not edit code the user has written unless it's necessary for the task at hand. Leave their naming, comments, formatting, and structure as-is — even when they diverge from conventions here or look improvable. Cosmetic or stylistic cleanups (renaming variables, rewording comments, reformatting, "tidying") to user-authored code must be *proposed*, not applied unprompted; let the user accept them. When a change to user-written code is genuinely required for correctness or to complete the task, make the minimal edit and call it out explicitly.

## Project Overview

DocuLyze is a RAG (Retrieval Augmented Generation) document analysis tool. Users upload documents (PDFs, Word files, text/code files) and will interact with them via a chat interface. Currently implemented: Firebase email/password auth with server-side session cookies, and direct-to-Storage document upload with Firestore metadata records. The ingest pipeline (parse → chunk → embed → ChromaDB via a tenant gateway) is implemented; the chat interface, RAG query path, and Redis are planned but not yet built.

## Repository Layout

```
DocuLyze/
├── doculyze/            # Next.js 16 frontend + server actions (App Router, TypeScript, Tailwind v4)
│   ├── app/
│   │   ├── (protected)/     # Route group gated by layout.tsx (server-side session check)
│   │   │   ├── dashboard/   # Server Component — lists the user's documents via the DAL
│   │   │   └── upload/      # Upload form (client) + presigned-URL flow
│   │   ├── actions/         # Server actions ("use server") — the app's real backend
│   │   │   ├── auth/        # session.tsx (cookie mint/revoke), verify_user.tsx
│   │   │   ├── db/          # DAL.tsx
│   │   │   └── document/    # upload_document.tsx (getPresignedUrl, finalizeUpload)
│   │   ├── login/ register/ # Public auth pages
│   │   └── providers.tsx    # Client-side AuthContext (onAuthStateChanged)
│   ├── _lib/
│   │   ├── firebase.tsx     # Client SDK init — exports `auth`
│   │   ├── admin.tsx        # server-only: Admin SDK init — exports adminAuth, db, storage
│   │   ├── data.tsx         # server-only: session verification (getCurrentUid, requireUid)
│   │   ├── database.tsx     # server-only: Firestore DAL (document records, paths)
│   │   ├── fileupload_schema.ts  # Neutral module: upload validation shared by client + server
│   │   └── api_with_express.tsx  # LEGACY — old fetch helpers for the Express backend
│   ├── components/          # Shared React components (file_dropzone, form, button, header)
│   └── tests/               # vitest (emulator-backed): upload seams + harness
├── ingest-worker/       # Python 3.12 ingest worker (issue #4): pika consumer + sandboxed parsers
│   ├── src/ingest/          # config, paths, firestore_status, precheck, parsers, sandbox, job, consumer
│   └── tests/               # pytest (emulator-backed) at the run_ingest_job seam
├── backend/             # LEGACY Express 5 server — superseded by server actions (see below)
├── docker-compose.yml   # RabbitMQ broker (localhost-only ports) + internal ingest-worker
├── docker-compose.dev.yml  # Dev override: worker -> host's Firestore emulator (Option A)
├── cors.json            # GCS bucket CORS config (allows the browser's direct PUT)
├── docs/agents/         # Agent skill config: issue-tracker.md, triage-labels.md, domain.md
├── docs/adr/            # Architecture decision records (created lazily)
├── GRILL-ME-*.md        # Design-interrogation docs — rationale behind auth/upload decisions
└── PLAN.md              # Original high-level architecture plan (partially outdated)
```

## Commands

### Frontend (`doculyze/`)
```bash
cd doculyze
npm run dev        # Start Next.js dev server on http://localhost:3000
npm run build      # Production build
npm run lint       # Run ESLint
npm run lint:fix   # Auto-fix ESLint issues
```

The Next.js app is self-sufficient — server actions talk to Firebase directly. The Express backend is NOT required.

Note: `npm run lint` is currently broken (the ESLint 9 flat config was removed in an earlier revert); use `npx tsc --noEmit` for type checking.

### Tests
```bash
cd doculyze
npm run test:emulators   # vitest under firebase emulators:exec (Firestore 8085, Storage 9199)
npm run emulators        # or: start emulators standalone (Firestore listens on 0.0.0.0)

cd ../ingest-worker      # Python worker (venv at .venv/, deps in requirements.txt)
.venv/Scripts/python -m pytest tests   # needs the emulators running
```

### Ingest stack (issue #4)
```bash
docker compose up -d       # RabbitMQ (localhost 5672/15672) + ingest worker (internal-only)
# Dev E2E (worker -> host's Firestore emulator, Storage stays real):
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## Architecture

### Authentication

Auth is a two-layer flow implemented entirely in Next.js (client SDK + server actions):

1. **Client**: `signInWithEmailAndPassword` via `doculyze/_lib/firebase.tsx`, then the ID token is passed to the `createRefresh` server action (`app/actions/auth/session.tsx`).
2. **Server action**: verifies the ID token with the Admin SDK, mints a Firebase session cookie (5-day expiry), and sets it as an httpOnly/secure/strict `refresh` cookie. Also upserts the user profile in Firestore, then redirects to `/dashboard`.
3. **Session reads**: `_lib/data.tsx` is the single place session cookies are verified. `getSession` is wrapped in React `cache()` so multiple DAL calls in one request verify at most once. Two accessors:
   - `getCurrentUid()` — returns `null` when unauthenticated (read paths that branch/redirect)
   - `requireUid()` — throws when unauthenticated (write paths); `checkRevoked` defaults on for writes, off for hot reads (it's a network round-trip)
4. **Route protection**: `app/(protected)/layout.tsx` calls `verifyUser()` server-side and redirects to `/login`. The uid always comes from the verified cookie — never from a caller argument or formData.
5. **Client UI state**: `app/providers.tsx` exposes `useAuth()` backed by `onAuthStateChanged` — display-only; it is not the trust boundary.

### Document upload (presigned URL, record-after-upload)

Server actions can't receive large file bodies, so bytes go directly to Firebase/GCS Storage:

1. Client dropzone (`components/file_dropzone.tsx`) gates UX with `fileSchema`; the server action re-validates the metadata *claim* with `uploadClaimSchema`. Both come from `_lib/fileupload_schema.ts` — a deliberately neutral module (no `"use client"` / `server-only`) so the two gates can't drift.
2. `getPresignedUrl` derives the canonical content-type from the file *extension* ("Policy B" — the browser's `file.type` is never trusted), mints a docId + storage path via `newDocumentPath()` **without writing Firestore**, and signs a v4 URL pinned to that content-type and a `x-goog-content-length-range` of 1 byte–5 MB.
3. Client PUTs the file to the signed URL via XHR (for progress), echoing the server-resolved content-type.
4. `finalizeUpload` verifies the object actually exists in Storage, cross-checks size against Storage metadata (rejects on mismatch), then writes the Firestore record with status `"uploaded"` via `finalizeDocumentRecord` — idempotent because it writes at the pre-minted docId. No record ever exists for bytes that didn't land.

The storage path formula lives in exactly one place — `documentStoragePath()` in `_lib/database.tsx`: `users/{uid}/documents/{docId}`. The signer, the finalize verify, and the Firestore record all call it. docIds are server-generated (Firestore auto-ids), never derived from filename or title.

`cors.json` at the repo root is the bucket CORS config allowing the browser's cross-origin PUT (`gsutil cors set cors.json gs://<bucket>`).

### Pull-based ingest (issue #4 tracer)

After a successful finalize, `finalizeUpload` publishes a pointer envelope `{uid, docId}` (never bytes) via `_lib/ingest_broker.ts` to the durable RabbitMQ queue `doc.ingest` — flip-then-publish, swallow-and-log: a publish failure or unset `RABBITMQ_URL` never fails the upload (doc rests at `uploaded`, recoverable). Since issue #10, the outcome is classified rather than silent: `finalizeUpload` returns `{ enqueue: "queued" | "failed" | "unknown" }` (type in the neutral `_lib/ingest_contract.ts`; `unknown` = confirm timeout, envelope may have landed). The Python worker (`ingest-worker/`) consumes with prefetch 1 + manual ack, claims the doc via a Firestore transaction (`uploaded → processing`; Claim enum CLAIMED/RERUN/SKIP/ABSENT — `ready`/`failed` never regress), downloads the object at the canonical path (4th caller of the formula), runs a magic-number precheck, then parses in a subprocess sandbox (20s timeout; pymupdf4llm / python-docx / utf-8 — output is normalized Markdown since issue #11, tables and headings preserved; legacy `.doc` was dropped from the allowlist end-to-end). Bad bytes → `failed` (object retained); good files are chunked (table-aware markdown splitting via `chunker.py`, tiktoken cl100k_base token counting), embedded via the Voyage client boundary (`embedding.py`; model pinned by `EMBEDDING_MODEL`, default `voyage-3.5-lite`), and written to ChromaDB through the tenant gateway `write_user_chunks` in `vector_store.py` (issue #29) — delete-then-add for idempotent replay, every chunk tagged `{userId, docId}` plus the embedding pin. A gateway read-back confirms non-empty chunks, then `mark_ready` transitions `processing → ready`. An embed/write failure or empty verification transitions to `failed`. Document-level failures ACK; unexpected exceptions NACK (requeue=false) to `doc.ingest.dead` — one-shot, no retries. The worker's only Firestore writes are status transitions; Storage is read-only to it. Full decision ledger: the implementation-guide comment on issue #4.

### Pipeline progress stream (issue #10)

The upload page continues past the byte PUT into a step view (Uploading → Queued → Parsing → Ready/Failed) driven by a per-document SSE stream: `app/api/documents/[docId]/stream/route.ts`. The route handler does its own session check (401 unauthenticated; path derives from cookie uid + docId, same tenant shape as finalize) and feeds one Admin-SDK snapshot listener per connection — initial snapshot emitted immediately (reconnect resync), payload `{status, version}` only, terminal status ends the stream, abort unsubscribes, ~15s keepalive comments, ~5 min hard deadline. Client behavior lives in `app/(protected)/upload/pipeline_progress.tsx`: enqueue `queued`/`unknown` open the stream (`unknown` shows a delayed-warning and self-heals), `failed` terminates with "upload saved — retried later", a 60s patience timer converts silence into reassurance, and unknown statuses render as a generic in-progress step.

### Data layout (Firestore)

- `users/{uid}` — user profile doc
- `users/{uid}/documents/{docId}` — `DocumentRecord`: file_name, title, storagePath, contentType, size, status (`"uploaded" | "processing" | "ready" | "failed"`), version, uploadedAt

Chunks live in ChromaDB (collection `chunks`, ids `{uid}/{docId}/{idx}`, metadata userId/docId/chunk_index/token_count/embedding_model/breadcrumb), reached only through the tenant gateway in `ingest-worker/src/ingest/vector_store.py` (`write_user_chunks` / `query_user_chunks` / `get_user_chunks`) — the gateway injects the userId filter so no call site can cross tenants.

## Frontend Conventions

- Next.js App Router. Interactive components need `"use client"`; server-only modules declare `import "server-only"`.
- Server Components read the DAL directly (see `dashboard/page.tsx`) — no fetch round-trip to an API route for own-page data.
- New server-side logic goes in `app/actions/` (server actions) with data access in `_lib/database.tsx`; don't add `fetch()` calls to page components.
- Import alias `@/` maps to `doculyze/` (configured in `tsconfig.json`).
- This version of Next.js (16) may have breaking changes from training data — verify against current docs rather than assuming. (Note: `doculyze/CLAUDE.md` imports `@AGENTS.md`, but that file was reverted and no longer exists.)

## Configuration & Secrets

- `doculyze/serviceAccount.json` — Firebase Admin credentials, imported by `_lib/admin.tsx`. Gitignored; obtain separately. (Migration to `FIREBASE_ADMIN_*` env vars is stubbed out in `admin.tsx`.)
- `doculyze/.env` — `FIREBASE_STORAGE_BUCKET` (required for uploads; Storage throws without it), plus `FIREBASE_*` client config and `FIREBASE_ADMIN_*` values for the planned env-var migration.
- The client Firebase config is currently hardcoded in `_lib/firebase.tsx`.

## Legacy Express Backend (`backend/`)

The Express server (port 5000: CSRF token + session-cookie endpoints, `requireAuth` middleware) was the original auth backend. It has been fully superseded by server actions and is slated for retirement — nothing in the active frontend calls it (`_lib/api_with_express.tsx` is the orphaned client for it). Don't add new functionality here. If you must run it: `cd backend && npm run dev` (needs `backend/.env` with `COOKIE_SECRET` and `backend/serviceAccountKey.json`).

## Design Docs

The `GRILL-ME-*.md` files at the root record the interrogated design decisions (auth state 2026-05-27, document storage 2026-06-24, storage/upload auth 2026-07-11). Code comments reference them by question number (e.g. "GRILL Q6" = Policy B content-type). Read the relevant one before changing auth or upload behavior.

## Planned but Not Yet Implemented

Per `PLAN.md` and the design docs, the following have no code yet:
- RAG pipeline query path (LLM generation over retrieved chunks; retrieval itself exists via `query_user_chunks`)
- Google Natural Language API (NER, sentiment)
- Redis cache
- Chat interface
- Google OAuth (only email/password auth exists)

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (github.com/tmwang7324/DocuLyze), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary — the five canonical role strings used as-is. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
