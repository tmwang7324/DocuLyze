// Runs before every test file. The emulator host vars are set in vitest.config.ts
// (test.env), but we re-assert them here so a misconfigured run fails loudly
// instead of silently talking to a real Firebase project.
//
// This is the guardrail for the whole harness: if FIRESTORE_EMULATOR_HOST is
// missing, the Admin SDK — which initializes with real service-account creds —
// would hit production. Refuse to run in that case.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST is not set. Refusing to run tests against a real Firebase project. " +
      "Run via `npm run test:emulators` (or start the emulators first)."
  );
}

if (!process.env.STORAGE_EMULATOR_HOST) {
  throw new Error(
    "STORAGE_EMULATOR_HOST is not set. Refusing to run Storage tests against a real bucket."
  );
}
