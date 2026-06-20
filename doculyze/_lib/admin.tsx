import "server-only";

import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { ServiceAccount } from "firebase-admin";

function getRequiredEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

const serviceAccount: ServiceAccount = {
    projectId: getRequiredEnv("FIREBASE_ADMIN_PROJECT_ID"),
    privateKey: getRequiredEnv("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
    clientEmail: getRequiredEnv("FIREBASE_ADMIN_CLIENT_EMAIL"),
};

const adminApp = getApps().length
    ? getApp()
    : initializeApp({
          credential: cert(serviceAccount),
      });

const adminAuth = getAuth(adminApp);

export { adminApp, adminAuth };

