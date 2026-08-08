import "server-only";

import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { ServiceAccount } from "firebase-admin";

function getRequiredEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}
// Credentials come from env vars, not serviceAccount.json. The JSON file is
// gitignored, so it does not exist in a Vercel build — a static import of it
// fails the build outright. These three fields are the only ones cert() reads.
// privateKey: .env stores the PEM on one line with literal "\n" escapes, so they
// are unescaped here. Pasting a real multi-line key into Vercel's dashboard also
// works — the replace is then a no-op.
const serviceAccountFromEnv: ServiceAccount = {
    projectId: getRequiredEnv("FIREBASE_ADMIN_PROJECT_ID"),
    privateKey: getRequiredEnv("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
    clientEmail: getRequiredEnv("FIREBASE_ADMIN_CLIENT_EMAIL"),
};
let config = {
        credential: cert(serviceAccountFromEnv),
        // Default bucket for getStorage().bucket(). Set FIREBASE_STORAGE_BUCKET
        // in .env.local once the bucket exists (usually <projectId>.firebasestorage.app
        // or <projectId>.appspot.com). Until then, storage uploads will throw.
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    }

const adminApp = getApps().length
    ? getApp()
    : initializeApp(config);


const adminAuth = getAuth(adminApp);
const db = getFirestore(adminApp);
const storage = getStorage(adminApp);

export { adminApp, adminAuth, db, storage };

