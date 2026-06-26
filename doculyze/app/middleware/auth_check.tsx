import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/_lib/admin";
import { refresh } from "next/cache";
import { create } from "domain";
import { createAccess } from "../actions/auth/session";

export async function requireAuth(req: NextRequest) {
    const cookies = req.cookies.get("refresh")?.value;
    let refreshCookie: string;
    if (!cookies) {
        console.log("No session cookie found");
        return NextResponse.redirect("/login");
    }
    const sessionCookie = cookies;
    const decodedToken = await adminAuth.verifySessionCookie(sessionCookie, true /** checkRevoked */);
    if (!decodedToken) {
        console.log("Invalid session cookie");
        return NextResponse.redirect("/login");
    }

    return NextResponse.next();
}