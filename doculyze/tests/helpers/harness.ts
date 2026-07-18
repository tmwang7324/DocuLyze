import { Timestamp } from "firebase-admin/firestore";
import { adminApp, db, storage } from "@/_lib/admin";

// Reset must target the SAME projectId the Admin SDK actually reads/writes under,
// or it clears an empty phantom namespace and data leaks between tests. admin.tsx
// calls initializeApp() WITHOUT an explicit projectId (only credential +
// storageBucket), so adminApp.options.projectId is undefined; the SDK resolves the
// real id from GCLOUD_PROJECT / the service-account credential. Mirror that here.
const projectId =
  (adminApp.options.projectId as string | undefined) ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  "doculyze";

// --- Session injection ------------------------------------------------------
// The auth boundary (getCurrentUid / requireUid in _lib/data) is legitimately
// OUTSIDE the DB seam, so tests mock @/_lib/data (see the test file) and drive the
// uid through this global. `authAs(null)` simulates an unauthenticated caller.
export function authAs(uid: string | null): void {
  (globalThis as Record<string, unknown>).__TEST_UID__ = uid;
}

export function currentTestUid(): string | null {
  return ((globalThis as Record<string, unknown>).__TEST_UID__ as string | null) ?? null;
}

// --- Emulator reset ---------------------------------------------------------
// Wipe all Firestore documents and Storage objects between tests so each case
// starts from empty state. Firestore has a dedicated emulator reset endpoint;
// Storage is cleared by deleting every object in the default bucket.
export async function resetEmulators(): Promise<void> {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
  const res = await fetch(
    `http://${fsHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    throw new Error(
      `Firestore emulator reset failed (HTTP ${res.status}). Are the emulators running? ` +
        `Start them with \`npm run test:emulators\`.`
    );
  }
  // Storage: delete every object under the default bucket. `force` swallows
  // per-object errors (e.g. an already-empty bucket).
  await storage.bucket().deleteFiles({ force: true }).catch(() => {});
}

// --- Storage seeding --------------------------------------------------------
// Stage an object in the Storage emulator at an exact path, so finalize's
// existence + size checks run against real emulator metadata (not a mock).
export async function seedStorageObject(
  storagePath: string,
  contents: Buffer | string,
  contentType: string
): Promise<void> {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  await storage.bucket().file(storagePath).save(bytes, { contentType, resumable: false });
}

// --- Record aging -----------------------------------------------------------
// Backdate a record's uploadedAt so it reads as minted `ageMs` ago. The reap's
// staleness cutoff compares against uploadedAt, so tests can age a record past
// the threshold without actually waiting.
export async function backdateDocument(
  uid: string,
  docId: string,
  ageMs: number
): Promise<void> {
  await db
    .collection("users")
    .doc(uid)
    .collection("documents")
    .doc(docId)
    .update({ uploadedAt: Timestamp.fromMillis(Date.now() - ageMs) });
}

// Does an object exist at this exact storage path?
export async function storageObjectExists(storagePath: string): Promise<boolean> {
  const [exists] = await storage.bucket().file(storagePath).exists();
  return exists;
}

// --- Firestore read convenience --------------------------------------------
// Read a single document record straight from Firestore for assertions.
export async function readDocumentRecord(
  uid: string,
  docId: string
): Promise<FirebaseFirestore.DocumentData | null> {
  const snap = await db.collection("users").doc(uid).collection("documents").doc(docId).get();
  return snap.exists ? snap.data() ?? null : null;
}

// List every document record under a user (no status filter, no ordering) — for
// counting records and asserting no duplicates / no cross-user leakage.
export async function listUserDocuments(
  uid: string
): Promise<Array<{ docId: string } & FirebaseFirestore.DocumentData>> {
  const snap = await db.collection("users").doc(uid).collection("documents").get();
  return snap.docs.map((d) => ({ docId: d.id, ...d.data() }));
}
