import "server-only";

import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

function getAdminApp(): App {
    if (getApps().length) return getApp();
    return initializeApp({
        credential: cert({
            projectId: requiredEnv("FIREBASE_ADMIN_PROJECT_ID"),
            clientEmail: requiredEnv("FIREBASE_ADMIN_CLIENT_EMAIL"),
            privateKey: requiredEnv("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
}

// Route discovery imports server modules during `next build`. Resolve SDK
// clients only when a request actually uses them, with runtime credentials.
function lazyClient<T extends object>(getClient: () => T): T {
    return new Proxy({} as T, {
        get(_target, property) {
            const client = getClient();
            const value = Reflect.get(client, property, client);
            return typeof value === "function" ? value.bind(client) : value;
        },
    });
}

export const adminApp = lazyClient(getAdminApp);
export const adminAuth = lazyClient(() => getAuth(getAdminApp()));
export const db = lazyClient(() => getFirestore(getAdminApp()));
export const storage = lazyClient(() => getStorage(getAdminApp()));
