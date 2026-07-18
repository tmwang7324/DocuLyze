import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // `server-only` throws if imported outside a React Server Component build.
      // The DAL / admin modules import it as a guard; stub it out under test.
      { find: /^server-only$/, replacement: path.resolve(root, "tests/stubs/empty.ts") },
      // Mirror tsconfig's "@/*" -> "./*" so @/_lib/... and @/serviceAccount.json resolve.
      // Anchored to "@/" so it can't swallow scoped packages like @vitejs/*.
      { find: /^@\//, replacement: `${root}/` },
    ],
  },
  
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup/emulator-env.ts"],
    // These point every Firebase call at the local emulators. As long as the
    // *_EMULATOR_HOST vars are set, the Admin SDK never reaches a real project —
    // even though it initializes with real service-account credentials. This is
    // the safety boundary: emulator host set == no production writes.
    env: {
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085",
      STORAGE_EMULATOR_HOST: "http://127.0.0.1:9199",
      FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      // Must match the projectId the Admin SDK derives from serviceAccount.json,
      // so the emulator UI (launched with --project doculyze) shows the data the
      // tests write. A mismatch here means writes land in a project the UI isn't
      // displaying and the Firestore tab looks empty.
      FIREBASE_STORAGE_BUCKET: "doculyze.appspot.com",
      GCLOUD_PROJECT: "doculyze",
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
