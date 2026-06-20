"use server";

import { cookies } from "next/headers";
import { adminAuth } from "@/_lib/admin";

export default async function verifyUser() {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("refresh")?.value;
    if (!sessionCookie) {
        console.log("No session cookie found");
        return false;
    }

    const decodedToken = await adminAuth.verifySessionCookie(sessionCookie, true /** checkRevoked */);
    if (!decodedToken) {
        console.log("Invalid session cookie");
        return false;
    }
    console.log("Session cookie found");
    return true;
}