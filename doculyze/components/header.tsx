"use client";

// ⚠️ WORK IN PROGRESS — navbar auth state.
// Renders from AuthProvider context (`user` / `loading`). Sign-out wired up.
// OPEN ISSUE: `user` currently trusts Firebase client state only (providers.tsx
// no longer gates on the backend `refresh` cookie), so the header does NOT yet
// reflect backend session expiry. Revisit once the cookie-driven revalidate()
// is wired into the login/register handlers. See GRILL-ME-auth-state notes.

import { useAuth } from '@/app/providers';
import { auth } from '@/_lib/firebase';
import { useState, useEffect } from 'react';
import { revokeSession } from '@/app/actions/auth/session';

const Header = () => {
    const { user, loading } = useAuth();
    const [signingOut, setSigningOut] = useState(false);

    const handleSignOut = async (): Promise<void> => {
        setSigningOut(true);
        try {
            await auth.signOut();
            await revokeSession(); // redirects to /login on success
        } catch (error) {
            console.error("Error signing out:", error);
            setSigningOut(false); // only reached if sign-out failed before redirect
        }
    };

    // WIP reference — previous in-component auth listener, kept for context while
    // the cookie-driven approach is decided. Body intentionally commented out.
    useEffect(() => {
     // console.log(`User = ${JSON.stringify(user)}`)
     // // setIsLoading(false);

// const subscribe = onAuthStateChanged(auth, async (userData: User | null) => {
    // // setIsLoading(true);
    // console.log(await verifyUser());
    // if (userData && await verifyUser()) {
    //     const data = {
    //         "email": userData?.email || "",
    //         "uid": userData?.uid || "",
    //         "verified": true
    //         };
    //     setUser(data);
    // // setIsLoading(false);
    //     console.log("User is signed in with data:", data);
    // } else {
    //     setUser({
    //         email: "",
    //         uid: "",
    //         verified: false
    //         });
    //     await auth.signOut();
    //         // setIsLoading(false);
    //     console.log("User is signed out");
    //     }
    // });
    // return subscribe;

    }, [user]);

    return (
        <div>
            {loading ? (
                <p>Loading...</p>
            ) : (
                <div>
                    {user.email ? `Welcome, ${user.email}  ` : "Not logged in"}
                    {user.email && (
                        <button onClick={handleSignOut} disabled={signingOut}>
                            {signingOut ? "Signing out..." : "Sign out"}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default Header;
