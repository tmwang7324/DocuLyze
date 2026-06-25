"use server";

import { cookies } from "next/headers";
import { adminAuth } from "@/_lib/admin";
import { redirect } from 'next/navigation';
import { getCurrentUid } from "@/_lib/data"
// placeholder
export async function verifyUser() {
    return (await getCurrentUid()) !== null;
}

export async function redirectToLogin() {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("refresh")?.value;
    if (!sessionCookie) {
        redirect('/login');
    }
    const decodedToken = await adminAuth.verifySessionCookie(sessionCookie, true /** checkRevoked */);
    if (!decodedToken) {
        redirect('/login');
    }
    return decodedToken?.uid;
}
