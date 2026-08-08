"use client";

// The one genuinely client-side piece of the navbar.
//
// Sign-out is two steps that must both happen: drop the Firebase client SDK's
// session, then revoke the server cookie. The first is browser-only, which is
// why this leaf exists at all — everything else in the bar renders on the
// server. Keeping the boundary this small is the point: a "use client" on the
// shell would pull every island into the client bundle with it, and an island in
// the client bundle can't read the session cookie.
//
// No navigation here. revokeSession ends in redirect("/login"), and its
// revalidatePath("/", "layout") drops the cached layout — which is what makes
// the islands re-read the cookie and come back signed-out.

import { useState } from "react";
import { auth } from "@/_lib/firebase";
import { revokeSession } from "@/app/actions/auth/session";

export default function SignOutButton({ className }: { className?: string }) {
    const [signingOut, setSigningOut] = useState(false);

    const handleSignOut = async (): Promise<void> => {
        setSigningOut(true);
        try {
            await auth.signOut();
            await revokeSession();
        } catch (error) {
            console.error("Error signing out:", error);
            setSigningOut(false); // only reached if sign-out failed before the redirect
        }
    };

    return (
        <button onClick={handleSignOut} disabled={signingOut} className={className}>
            {signingOut ? "Signing out…" : "Sign out"}
        </button>
    );
}
