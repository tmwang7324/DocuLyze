"use server";
import { adminAuth } from "@/_lib/admin";
import { auth } from "@/_lib/firebase";
import { User } from "firebase/auth"; //user.
import { cookies } from "next/headers";
import { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createUserProfile } from "@/_lib/database";


export async function createRefresh(password: string, idToken: string): Promise<string | null> {
    //let idToken;
    const cookieStore = await cookies();
    const decodedToken = await adminAuth.verifyIdToken(idToken, true);
    if (!decodedToken) {
        throw new Error("Invalid ID token");
        //return null; // This line is unreachable because of the throw above
    }
    const uid = decodedToken.uid;    
    // const existingCookie = cookieStore.get("refresh");
    // if (existingCookie) {
    //     try {
    //         const decodedClaims = await adminAuth.verifySessionCookie(existingCookie.value, true);
    //         if (decodedClaims) {
    //             if (decodedClaims.sub === uid && decodedClaims.exp * 1000 > Date.now()) {
    //                 console.log("Valid session cookie for user:", uid);
    //                 return existingCookie.value; // Return the existing valid session cookie
    //             }
    //             // If the session cookie is valid, you can perform any necessary actions here.
    //             // For example, you might want to refresh the session cookie or update user information.
    //         }
    //     } catch (error) {
    //         console.log("Error verifying session cookie:", error);
    //         cookieStore.delete("refresh"); // Delete the invalid session cookie
    //     }
    // } // End of check for existing cookie
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
    redirect("/dashboard");
    // return refreshCookie; // Return the newly created session cookie
}

export async function revokeSession() {
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
    } catch (error) {
        console.log(error);
    } 
    redirect("/login");
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