"use server";
import { adminAuth } from "@/_lib/admin";
import { cookies } from "next/headers";
import { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createUserProfile } from "@/_lib/database";
import { logOperationalEvent, runWithRequestContext } from "@/_lib/operational_logger";


export async function createRefresh(password: string, idToken: string): Promise<string | null> {
    // Preserve one request ID across token verification, session creation, and profile setup.
    return runWithRequestContext(async () => {
    const startedAt = Date.now();
    let terminalLogged = false;
    logOperationalEvent("info", { operation: "createRefresh", lifecycle: "started" });
    try {
    //let idToken;
    const cookieStore = await cookies();
    const decodedToken = await adminAuth.verifyIdToken(idToken, true);
    if (!decodedToken) {
        throw new Error("Invalid ID token");
        //return null; // This line is unreachable because of the throw above
    }
    const uid = decodedToken.uid;    
    const existingCookie = cookieStore.get("refresh");
    if (existingCookie) {
        try {
            const decodedClaims = await adminAuth.verifySessionCookie(existingCookie.value, true);
            if (decodedClaims) {
                if (decodedClaims.sub === uid && decodedClaims.exp * 1000 > Date.now()) {
                    console.log("Valid session cookie for user:", uid);
                    // A reused valid cookie is a successful terminal outcome too.
                    logOperationalEvent("info", {
                        operation: "createRefresh",
                        lifecycle: "succeeded",
                        durationMs: Date.now() - startedAt,
                    });
                    terminalLogged = true;
                    return existingCookie.value; // Return the existing valid session cookie
                }
                // If the session cookie is valid, you can perform any necessary actions here.
                // For example, you might want to refresh the session cookie or update user information.
            }
        } catch (error) {
            console.log("Error verifying session cookie:", error);
            cookieStore.delete("refresh"); // Delete the invalid session cookie
        }
    } // End of check for existing cookie
    const options: Partial<ResponseCookie> = {
            "httpOnly": true,
            "secure": true, //false Set to true in production with HTTPS
            "sameSite": "strict" as const,
            "path": '/'
        }
    // expires in 5 days
    const refreshCookie: string = await adminAuth.createSessionCookie(idToken, { expiresIn: 60 * 60 * 24 * 5 * 1000 });
    cookieStore.set("refresh", refreshCookie, options);
    await createUserProfile({ email: decodedToken.email as string, password: password, sessionCookie: refreshCookie });
    //createAccess(refreshCookie);
    revalidatePath("/dashboard");
    // Issue #21: the nav's auth state is resolved in the (public) group layout,
    // whose RSC payload the client router caches. Navigating to /dashboard after
    // login renders the (protected) layout fresh, so the nav is right there — but
    // without this, a later visit to / would serve the cached signed-out nav.
    revalidatePath("/", "layout");
    // Redirect throws by design, so record success before it leaves this action.
    logOperationalEvent("info", {
        operation: "createRefresh",
        lifecycle: "succeeded",
        durationMs: Date.now() - startedAt,
    });
    terminalLogged = true;
    redirect("/dashboard");
    // return refreshCookie; // Return the newly created session cookie
    } catch (error) {
        // A redirect after a recorded success is not an operation failure.
        if (!terminalLogged) {
            logOperationalEvent("error", {
                operation: "createRefresh",
                lifecycle: "failed",
                durationMs: Date.now() - startedAt,
                reason: "authentication_failed",
            });
        }
        throw error;
    }
    });
}

export async function revokeSession(): Promise<void> {
    // Preserve one request ID across session verification, token revocation, and cookie cleanup.
    return runWithRequestContext(async () => {
    const startedAt = Date.now();
    logOperationalEvent("info", { operation: "revokeSession", lifecycle: "started" });
    try {
        const cookieStore = await cookies();
        const sessionCookieString = cookieStore.get("refresh")?.value || '';
        const decodedClaims = await adminAuth.verifySessionCookie(sessionCookieString, true);
        if (!decodedClaims) {
            throw new Error("Invalid session cookie");
        }
        await adminAuth.revokeRefreshTokens(decodedClaims.sub);
        cookieStore.delete("refresh");
        cookieStore.delete("access");
        // Redirect throws, so the terminal success event must be recorded first.
        logOperationalEvent("info", {
            operation: "revokeSession",
            lifecycle: "succeeded",
            durationMs: Date.now() - startedAt,
        });
    } catch (error) {
        // Preserve the existing best-effort sign-out: even an invalid or expired
        // session proceeds to local cookie invalidation and the login redirect.
        logOperationalEvent("error", {
            operation: "revokeSession",
            lifecycle: "failed",
            durationMs: Date.now() - startedAt,
            reason: "session_revocation_failed",
        });
        console.log(error);
    }
    // Issue #21: same reason as createRefresh — drops the cached (public) layout
    // so / doesn't keep serving the signed-in nav after sign-out. /login itself
    // needs no invalidation: its group hardcodes the signed-out nav.
    revalidatePath("/", "layout");
    redirect("/login");
    });
}

export async function createAccess(refreshCookie: string) {
    try {
        const decodedToken = await adminAuth.verifySessionCookie(refreshCookie, true /** checkRevoked */);
        if (!decodedToken) {
            throw new Error("Invalid refresh cookie");
        }
        const expiresIn = 15 * 60 * 1000; // 15 minutes
        const accessToken = await adminAuth.createSessionCookie(refreshCookie, { expiresIn });
        const cookieStore = await cookies();
        const options: Partial<ResponseCookie> = {
                "httpOnly": true,
                "secure": true, //false Set to true in production with HTTPS
                "sameSite": "strict" as const,
                "path": '/'
        }
        cookieStore.set("access", accessToken, options);
        console.log("Access token created and stored in cookie");
        return accessToken;
    } catch (error) {
        console.log(error);
    }
}
