import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

// Load .env so FIREBASE_ADMIN_* vars reach admin.tsx in test workers.
// Without this, any test that imports admin.tsx (via upload_document, etc.)
// crashes at module scope and vitest can only report a file-level failure.
const fileEnv = loadEnv("test", root, "");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: path.resolve(root, "tests/stubs/empty.ts") },
      { find: /^@\//, replacement: `${root}/` },
    ],
  },

  test: {
    environment: "node",
    globals: true,
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup/emulator-env.ts"],
    env: {
      // Base: .env values (provides FIREBASE_ADMIN_* for admin.tsx init)
      ...fileEnv,
      // Emulator overrides take priority — the safety boundary that stops
      // the Admin SDK from reaching a real project.
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085",
      STORAGE_EMULATOR_HOST: "http://127.0.0.1:9199",
      FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIREBASE_STORAGE_BUCKET: "doculyze.appspot.com",
      GCLOUD_PROJECT: "doculyze",
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
