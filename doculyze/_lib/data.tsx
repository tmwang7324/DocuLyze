import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { adminAuth } from "@/_lib/admin";
import type { DecodedIdToken } from "firebase-admin/auth";


// Verify the `refresh` session cookie at most once per request. React's cache()
// dedupes calls within a single render / server action, so multiple DAL
// operations in one request don't each re-hit Firebase. `checkRevoked` is a
// network round-trip — keep it off for hot reads, on for writes / login.
const getSession = cache(
    async (checkRevoked = false): Promise<DecodedIdToken | null> => {
        const cookieStore = await cookies();
        const sessionCookie = cookieStore.get("refresh")?.value;
        if (!sessionCookie) {
            return null;
        }
        try {
            return await adminAuth.verifySessionCookie(sessionCookie, checkRevoked);
        } catch (error) {
            return null; // expired / revoked / malformed
        }
    }
);

// Null when unauthenticated — for read paths that branch or redirect.
export const getCurrentUid = cache(async (): Promise<string | null> => {
    return (await getSession())?.uid || null;
});

// Throws when unauthenticated — for write paths that must not proceed. This is
// what the DAL calls; the uid always comes from the verified cookie, never from
// a caller argument or formData.
export async function requireUid(checkRevoked = true): Promise<string> {
    const decodedToken = await getSession(checkRevoked);
    if (!decodedToken) {
        throw new Error("User is not authenticated");
    }
    return decodedToken?.uid;
}


