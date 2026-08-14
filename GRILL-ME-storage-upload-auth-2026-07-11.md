# GRILL-ME — Client SDK Firebase Storage vs. Presigned URL (uploads)

**Date:** 2026-07-11 (resumed & extended 2026-07-12, 2026-07-17) · **Status:** COMPLETE — Q1–Q7 resolved. Q1–Q4 built; Q5–Q7 decided (Q6 code change + cors.json pending).
**Topic:** For document uploads, should the browser write to Firebase Storage via the
**client SDK** (`uploadBytes` + Storage Security Rules) or via an **admin-signed presigned URL**
(server action signs a write URL, client `PUT`s the bytes)?

---

## Codebase facts established

- **Canonical auth = httpOnly `refresh` session cookie.** Created in
  `app/actions/auth/session.tsx` via `createSessionCookie(idToken, {expiresIn: 5 days})`.
  Every server action trusts it through `_lib/data.tsx:requireUid()` (default `checkRevoked=true`).
- **A separate client-side Firebase Auth session also exists** (`_lib/firebase.tsx`,
  `_lib/observers.tsx`, `app/providers.tsx`) via `onAuthStateChanged`. Today it mainly feeds
  React context (header email, etc.).
- **`app/providers.tsx:40-49`** runs `verifySession()` on mount: if `verifyUser()` (checks the
  cookie) returns false, it calls `auth.signOut()`. So there is **one-directional coupling:
  cookie-invalid ⟹ client signed out.**
- Current upload code (restored to original) uses a presigned URL: `getPresignedUrl()` in
  `app/actions/document/upload_document.tsx` signs with the admin service account; `requireUid()`
  supplies the uid from the cookie. Storage Rules are bypassed.
- `_lib/database.tsx:createDocumentRecord` currently builds a **filename-based** storagePath
  (`users/{uid}/documents/{file_name}`) — chosen this session, one step at a time.
- Bucket: `doculyze.firebasestorage.app` (`FIREBASE_STORAGE_BUCKET` in `.env`).
- `doculyze/serviceAccount.json` now present locally (gitignored) so the admin SDK loads.

## The decision tree (planned ~7 branches)

1. **Where does upload authorization live?** ← IN PROGRESS
2. Do you need server-side control at upload time (mint docId, write Firestore record, validate)?
3. Validation enforcement — size/contentType. Rules enforce natively; a plain signed PUT does
   **not** cap size unless you add `x-goog-content-length-range` extension headers.
4. Progress / resumability / large files — `uploadBytesResumable` (client SDK) vs. simple `PUT`.
   (Note: MAX_FILE_SIZE is 10 MB, so resumability is marginal.)
5. CORS / setup burden — presigned needs manual bucket CORS for the browser origin; the Firebase
   client SDK hits CORS-friendly `firebasestorage.googleapis.com` endpoints (no gsutil step).
6. Ordering — docId must exist before the bytes land; even client-SDK uploads still need a server
   round-trip to write the Firestore record, so the "no server call" simplicity is partly illusory.
7. Vendor coupling / keeping the client dumb.

---

## Question 1 — Where does upload authorization live? (unresolved)

**Claim (recommend A, presigned):** Storage Security Rules authorize via `request.auth` from the
**client Firebase ID token**, which the SDK cannot derive from the httpOnly cookie. So client-SDK
uploads make the client Firebase session a *second, load-bearing* auth truth, parallel to the cookie.

**Thomas's pushback #1:** "If the client Firebase token is stale, wouldn't the refresh cookie be
revoked?"
**Answer:** No. **Stale ≠ revoked.** The ID token expires hourly by design and the SDK silently
refreshes it; that never touches the cookie (a separate 5-day Google-signed JWT). The real
divergence is *storage location*, not revocation: cookie lives in the cookie jar, Firebase Auth
state lives in IndexedDB. Valid-cookie-but-null-`request.auth` happens on: hydration race, cleared/
blocked IndexedDB, incognito, second device. Also: on real revocation the two converge only
*loosely and late* — Storage Rules don't check revocation by default, so a cached ID token can keep
uploading for up to ~1h after `revokeRefreshTokens`, while the server (`checkRevoked=true`) rejects
immediately. So client SDK is actually *weaker* on revocation.

**Thomas's pushback #2:** "`providers.tsx` — if there is no cookie, will the client SDK sign out?"
**Answer:** Yes, it signs *out* (`verifySession` → `auth.signOut()`), which closes the
"client uploads after server would say no" direction — conceded, it's a good mechanism. **But it
only forces sign-out, never sign-in.** It can't populate `currentUser` when the cookie is valid but
the client has no Firebase session (that needs the user's credential, which a boolean server action
lacks). So the "valid cookie ⟹ live client session" guarantee that client-SDK uploads *require*
still doesn't hold (hydration race, cleared IDB, incognito, 2nd device remain broken).
**Meta-point:** presigned lets the client Firebase session stay *cosmetic*; client-SDK uploads
*promote* the fragile `providers/observers/verifySession` machinery to a load-bearing security path
with gaps it structurally can't fix.

**✅ RESOLVED (2026-07-11, resumed):** Thomas concedes **(A) presigned**. Reason accepted as
the load-bearing one: single source-of-truth auth = the httpOnly cookie, with revocation as the
decisive tiebreaker (presigned + `checkRevoked=true` rejects immediately; client-SDK keeps
uploading on a cached ID token for up to ~1h). Client Firebase session stays cosmetic.

## Question 2 — What does the server own at upload time, and in what order? (✅ RESOLVED 2026-07-11)

Live inconsistency found in current code: `getPresignedUrl(filePath, ...)` signs a **caller-supplied**
path (`users/${uid}/${filePath}`), while `createDocumentRecord` independently builds
`users/${uid}/documents/${file_name}` — two path-construction sites that must agree, nothing enforces it.

**Resolutions (Thomas):**
- **Single server action owns everything** — mint docId, write Firestore record, compute storagePath,
  sign URL for that exact path, return `{ uploadUrl, docId }`. Client only PUTs bytes (metadata, not
  bytes, goes through the action — so the "server actions can't take big files" constraint is respected).
- **Record-first** (before bytes).
- **storagePath keys on `docId`**, not filename → resolves the contradiction with [[document-storage-paths]]
  (which already said docId-keyed) and kills same-filename collisions. Current filename-keyed code must change.

**Consequence grilled — phantom documents:** record-first + the just-restored dashboard (`listDocuments`
returns every row, unfiltered) means a record whose PUT never lands shows as a real document card.
- Chosen: **(a) two-phase status.** Add a pre-upload state `"pending"` to `DocStatus` (union today has no
  such state). Mint writes `pending`; a **second** server round-trip (confirm) flips it to `uploaded`.
  Dashboard filters out `pending`. So the flow is TWO actions: mint+sign, then confirm. Confirm is also
  the future RAG-ingest trigger point.
- Confirm step **verifies the object actually exists in Storage** before trusting the client's "done"
  (not a blind status flip). → feeds directly into Q3: existence check is also where TRUE size/contentType
  can be read from Storage metadata, since a plain signed PUT doesn't cap size (branch 3).

## Question 3 — Where is size/contentType actually *enforced*? (✅ RESOLVED 2026-07-12)

Starting misconception (Thomas): *"the presigned URL automatically handles content type and
filesize, so zod is redundant."* Two corrections landed it:

- **contentType — zod is NOT redundant.** The signed URL only *pins* whatever `contentType` you
  feed `getSignedUrl`, and that value comes from the client (`file.type`). Drop the allowlist and
  you'll sign a URL for `application/x-msdownload` the instant a client names it. So the layers do
  **different jobs**: **zod `z.enum(ALLOWED_TYPES)` = the authorization gate (what you're willing
  to sign); the signature = the lock (client can't deviate from that type at PUT time).**
- **filesize — the premise is false.** A plain signed PUT accepts an unbounded body (the current
  `getPresignedUrl` passes only `contentType`, nothing about length — a 2 GB PUT succeeds). Size is
  capped **only** by signing with `extensionHeaders: { 'x-goog-content-length-range': '0,10485760' }`
  (client must echo the header or GCS 403s). Once added, the 10 MB max is baked into the URL, so
  **zod's `size` field becomes redundant for enforcement → drop the field, add the range.**

**contentType sourcing:** `fileObj.file.type` is the right source, and that one string must be
**byte-identical in three places** or the PUT 403s: (1) the zod allowlist check, (2)
`getSignedUrl({ contentType })`, (3) the PUT's `Content-Type` header — GCS enforces (3) == (2)
because the content-type is part of the signature. Edge case: `file.type` is sometimes `""` (a
`.docx` with no Office association) → fails `z.enum` and is awkward to sign. Fallback: infer from
extension when empty.

**Byte-level verification — consciously SKIPPED.** `file.type` is extension-derived, never a byte
sniff; a renamed `.exe`→`.pdf` passes every check above. A magic-byte sniff *could* run at the
confirm step (read the object back), but **Thomas accepts the renamed-file risk** for a personal
RAG tool. Recorded as a deliberate choice, not an oversight.

**Enforcement map (final):**
- **Client** (`<input accept>`, `file.size` in JS, drag-drop gating) → **UX only**, trivially
  bypassed — an attacker curls the signed URL and never touches the input.
- **Server action** (zod contentType allowlist + what it signs) → **the trust boundary**.
- **GCS constraints on the signed URL** (`content-length-range`, `contentType`) → enforcement on
  the one channel the server can't watch.
- **Confirm-time metadata re-read** → ground truth before `pending`→`uploaded` (byte-sniff hook
  lives here but is skipped).

## Question 4 (partial) — client upload UX: react-dropzone or vanilla? (✅ RESOLVED 2026-07-12)

The native `<input type=file>` filename label is browser chrome — it **can't be prevented before**
validation runs (dialog closes → browser paints the label → *then* `onChange` fires); you can only
clear it *after* via `input.value=""` (a flash). Clean gating pattern: **hide the native input
(`sr-only`), render the filename from validated React state** — the native label never shows, so
nothing flashes. This needs **no library**; react-dropzone works the same way under the hood. So
**filename control does NOT decide dropzone** — decide on drag-and-drop + rejection ergonomics.

**Decision:** Thomas wants **drag-and-drop**, built **vanilla (no react-dropzone dependency)**.
Component shipped: `doculyze/components/file_dropzone.tsx` — `sr-only` label-triggered input,
drag **depth-counter** for flicker-free `dragActive`, client `validate()` gates the filename
(reject → show the error, never the name), and surfaces the File to the parent via
`onFileAccepted`. Drag-dropped files live in React state, **not** the DOM input, so the parent must
consume the callback (matches the presigned fetch flow — bytes never go through FormData).
Not wired into `upload_form.tsx` yet (its commented lines left untouched by request).

## Question 5 — What reconciles an orphaned Storage object when `finalize` never runs? (✅ RESOLVED 2026-07-17)

The record-after-upload pivot (Q2) inverted the risk: every Firestore record now has bytes
behind it (`finalize` does `file.exists()` first), but **bytes can now exist with no record** —
if the PUT succeeds and then `finalizeUpload` throws (size mismatch, cookie expired mid-upload,
network drop, tab closed), the object sits at `users/{uid}/documents/{docId}` forever: invisible
to the dashboard (`listDocuments` reads only Firestore), never retried (a resubmit mints a *fresh*
docId → a second orphan). Removing the `"pending"` status (Q2) is precisely what made these
orphans discoverable only by a **Storage scan**, not a Firestore query.

**Decision (Thomas): (a) accept the leak now → (c) reconciliation sweep as the deferred fix.**
Not (b) prefix + lifecycle-move (reintroduces a two-phase Storage dance + a copy on every upload
to handle a rare failure) and not (d) resurrect a `pending` record (undoes the Q2 pivot). For a
personal RAG tool with a 5 MB cap and low volume, an orphan is a few MB of dead bytes the dashboard
and RAG pipeline never see. When volume justifies it, a periodic job (lists Storage objects with no
matching Firestore record older than N min, deletes them) is the natural owner — `finalize` already
proves the "does Storage match Firestore?" query is cheap.

## Question 6 — Where does `contentType` come from, and does the chain survive an empty `file.type`? (✅ RESOLVED 2026-07-17)

**Live bug found:** the Q3 "infer from extension when empty" decision only half-landed. `contentType`
was sourced from the browser's `file.type` in three places (`getPresignedUrl` arg, PUT header,
`finalizeUpload` arg). For several allowlisted types — `.md`, `.ts`, often `.doc` — browsers report
`file.type === ""`. Trace: the zod gate passes (extension fallback in `isAcceptedType`) → the URL is
signed with `contentType: ""` → the PUT succeeds → **GCS stores `application/octet-stream`** (no real
type pinned) → `finalizeUpload` cross-checks `actualType ("application/octet-stream") !== "" ` →
throws "Content-type mismatch" → the record is never written → **the legit upload becomes a Q5
orphan.** Second flaw: the `contentType` cross-check is not a real integrity check — the stored
`actualType` derives from the client's own claim (the client picked what got signed), so a lying
client controls *both* sides; it can only ever fire on this false-positive. The **size** check is
different: GCS measures `metadata.size` from the bytes independently → it genuinely catches
truncation/wrong-bytes → keep it.

**Thomas's pushback:** "How does a client claim `application/pdf` if the dropzone only accepts files?"
**Answer (conceded + sharpened):** Through the dropzone it *can't* — `file.type` is browser-derived
and a real browser never derives `application/pdf` for a `.md`. But the dropzone isn't the boundary
(Q3): `getPresignedUrl` is a `"use server"` action = a bare POST endpoint; an attacker calls it
directly with any `contentType`. So for honest clients Policy A and B are *identical* (browser type
is the canonical MIME or `""`); they diverge **only** for the direct caller — where B is strictly
safer. The objection strengthens B and reframes its justification: *the `contentType` argument is
attacker-controlled at the RPC boundary regardless of the dropzone, so the server derives it from
the filename and never reads the claim.*

**Decisions:**
- **Policy B — extension is king.** `resolveContentType(fileName)` (reverse of `ACCEPTED_TYPES`,
  in `fileupload_schema.ts`) is a pure function of the extension; `file.type` is thrown away. `null`
  ⟹ unsupported extension.
- **`contentType` param removed from `getPresignedUrl`** (`(fileName, title, size)`). Server resolves,
  throws on `null`, signs with the resolved MIME, returns **`{ url, docId, contentType }`**. Client
  echoes the returned type into the PUT header — a *courier*, not a source — so all three sites carry
  a non-empty canonical value and GCS stores something the RAG parser can branch on. (Not Option 2 /
  no-header: the browser re-attaches `file.type` on `send(file)` and you'd need a `setMetadata` write;
  Option 1 keeps the header but with the server's value, one fewer round-trip.)
- **`contentType` cross-check dropped from `finalize`;** it stores `metadata.contentType` (now
  deterministic) and keeps the **size** cross-check. `finalizeUpload(docId, fileName, size, title)`.
- **`contentType` field removed from `uploadClaimSchema`;** the type gate is now
  `resolveContentType(fileName) !== null`.

## Question 7 — CORS on the direct-PUT path (✅ RESOLVED 2026-07-17)

Branch #5 of the original tree. The PUT is cross-origin (`localhost:3000` → `storage.googleapis.com`)
with two non-simple headers (`Content-Type`, `x-goog-content-length-range`), so a preflight `OPTIONS`
must pass. GCS honors CORS only via an explicit bucket config; the trap is that
`x-goog-content-length-range` **must** appear in `responseHeader` (GCS reflects it into
`Access-Control-Allow-Headers`) or the browser blocks the PUT with a CORS error that *looks* like a
signing bug.

**Established (Thomas): the bucket CORS is already set and uploads run end-to-end** — so the
preflight passes and `x-goog-content-length-range` is already in `responseHeader`.
**Decision: commit `cors.json` to the repo as source-of-truth (infra-as-code) and pre-list the
production origin** so a bucket recreate / fresh environment / deploy doesn't silently break uploads.

## Leaning so far

Presigned (A) fits this codebase: single source-of-truth auth (the cookie), natural place to mint
docId + Firestore record + validate in one server action, no dependence on client session
hydration. Main costs to design around later: manual bucket CORS (branch 5) and size not enforced
by a plain signed PUT (branch 3 — mitigate with `x-goog-content-length-range`).
