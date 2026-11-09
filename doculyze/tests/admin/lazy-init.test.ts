import { expect, it, vi } from "vitest";

it("can load Firebase Admin during route discovery without runtime credentials", async () => {
  vi.resetModules();
  vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "");
  vi.stubEnv("FIREBASE_ADMIN_CLIENT_EMAIL", "");
  vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", "");
  try {
    const admin = await import("@/_lib/admin");
    expect(() => admin.db.collection("documents")).toThrow("Missing required environment variable: FIREBASE_ADMIN_PROJECT_ID");
  } finally {
    vi.unstubAllEnvs();
  }
});
