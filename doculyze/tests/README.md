# Test harness (emulator-backed integration tests)

This is the repo's first test harness, established for **GitHub issue #2 — Mint-first
lifecycle reversal** (`../../GRILL-ME-*` design docs; SPEC issue #1). It exercises the
upload server actions at the seam the spec names as **Seam 1**: `getPresignedUrl` and
`finalizeUpload` run against the **Firebase emulators** (Firestore + Storage), with only
the auth boundary faked.

## What is real vs. mocked

| Piece | Under test | Why |
|---|---|---|
| Firestore (document records) | **Real** — Firestore emulator | The lifecycle state machine is the thing being proven |
| Storage (object existence + size) | **Real** — Storage emulator | `finalizeUpload` reads authoritative size from Storage metadata |
| `_lib/database.tsx` DAL | **Real** | The seam under test |
| `_lib/data.tsx` (`getCurrentUid`/`requireUid`) | **Mocked** | The auth boundary is outside the DB seam; uid is injected via `authAs()` |
| `next/cache`, `next/navigation` | **Mocked** | No Next request context under test |

The safety boundary is the `*_EMULATOR_HOST` env vars (set in `vitest.config.ts`): with
them set, the Admin SDK never reaches a real project even though it initializes with real
service-account credentials. `tests/setup/emulator-env.ts` refuses to run if they're absent.

## Prerequisites

- **`doculyze/serviceAccount.json`** present (the Admin SDK reads it at init; gitignored).
- **Java** installed — the Firestore/Storage emulators are Java processes.
- Dependencies installed:

```bash
cd doculyze
npm install
```

This adds `vitest` and `firebase-tools` as dev dependencies (already in `package.json`).

## Running

**One-shot** — starts emulators, runs tests, then **always tears the emulators down**,
pass or fail (`emulators:exec` has no keep-alive option). Good for CI:

```bash
npm run test:emulators
```

**Keep emulators up (recommended for iterating and for inspecting a failure).** Run the
emulators in one terminal — they stay up regardless of how the tests exit — and run the
tests against them in another:

```bash
# terminal 1 — stays running until you Ctrl-C it
npm run emulators
# terminal 2 — re-run as often as you like; emulator state persists between runs
npm run test         # or: npm run test:watch
```

After a failing run, the emulators are still up, so you can open the **Emulator UI** and
inspect exactly what Firestore/Storage state the test left behind.

### Emulator UI

With `"ui": { "enabled": true, "port": 4000 }` in `firebase.json`, the UI is served at:

- **http://127.0.0.1:4000** — hub, with tabs for Firestore and Storage.

The exact URL is also printed in the `npm run emulators` / `npm run test:emulators`
startup banner (`View Emulator UI at ...`). Note that `resetEmulators()` wipes state in
`beforeEach`, so to inspect a failure, look **while the run is paused/stopped** — the next
test's reset will clear it.

## Layout

```
doculyze/
├── firebase.json          # emulator ports (firestore 8085, storage 9199, auth 9099, ui 4000)
├── .firebaserc            # default project: doculyze (must match serviceAccount.json's project_id)
├── firestore.rules        # deny-all (Admin SDK bypasses; emulator needs the file)
├── storage.rules          # deny-all (same rationale)
├── vitest.config.ts       # aliases (@/, server-only stub), emulator env, setup
└── tests/
    ├── setup/emulator-env.ts   # guardrail: refuse to run without emulator hosts
    ├── stubs/empty.ts          # `server-only` stub
    ├── helpers/harness.ts      # authAs(), resetEmulators(), seedStorageObject(), readDocumentRecord()
    └── upload/mint-first.test.ts  # #2 acceptance tests (3 live + the rest as it.todo)
```

## Status

Three live smoke tests cover #2 checkboxes 1–3 (pending-on-presign,
`pending → uploaded`, size-mismatch → `failed`) and prove the harness end to end.
The remaining acceptance criteria are `it.todo` stubs mapped to the ticket's
checkboxes — fill them in as #2 is implemented (design-only until 2026-07-27).
