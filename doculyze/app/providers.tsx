"use client";

import { auth } from "@/_lib/firebase";
import { createContext, useEffect, useContext } from "react";
import { useState } from "react";
import { verifyUser } from "./actions/auth/verify_user";
import { onAuthStateChanged, User } from 'firebase/auth';

type AuthUser = {
    email: string | null;
    uid: string | null;
    verified: boolean;
    profile_pic: string | null;
};

type AuthContextType = {
    user: AuthUser;
    setUser: (user: AuthUser) => void;
    loading: boolean; 
    setIsLoading: (loading: boolean) => void; 
}

export const defaultAuthUser = {
    email: "",
    uid: "",
    verified: false,
    profile_pic: null
};

const AuthContext = createContext<AuthContextType>({
    user: defaultAuthUser,
    setUser: () => {},
    loading: true,
    setIsLoading: () => {}
});


// NOTE (issue #21): with the onAuthStateChanged listener below commented out,
// this context no longer tracks the client SDK — `user` stays at the default and
// `loading` stays true. Nothing renders from it any more (the debug header that
// did is retired), so it is parked, not live.
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<AuthUser>(defaultAuthUser);
    const [loading, setLoading] = useState<boolean>(true);
  //
    useEffect(() => {
        setLoading(true);
        console.log('Verifying session...');
        //update user state based on verification
        const verifySession = async () => {
            if(!await verifyUser())
            {
                await auth.signOut();
                setUser(defaultAuthUser);
                console.log('User is not verified, signed out and reset to default.');
            }

        };
        verifySession(); // Call the verifySession function to check the session on component mount
        setLoading(false);
        console.log('Session verification completed.');
        console.log('Provider re-rendered');
        // Superseded by issue #21: the nav's auth state now resolves server-side
        // from the verified session cookie in app/layout.tsx and is passed to
        // SiteNav as a prop. This listener settled asynchronously on the client,
        // which meant a signed-in user saw the signed-out nav on first paint.
        // Kept commented as the record of how nav auth state was approached.
        //
        // const subscribe = onAuthStateChanged(auth, (userData: User | null) => {
        //     setLoading(true);
        //     if (userData)
        //     {
        //         //console.log("User is set in Header"); && await verifyUser() async
        //         setUser({
        //             email: userData.email || "",
        //             uid: userData.uid || "",
        //             verified: true,
        //             profile_pic: userData.photoURL || null,
        //         });
        //     }
        //     else {
        //         setUser(defaultAuthUser);
        //     }
        //     setLoading(false);
        //
        // });
        // return () => subscribe(); // Cleanup the subscription on unmount
    }, []);
    return (
        <AuthContext.Provider value={{user: user, setUser: setUser, loading: loading, setIsLoading: setLoading}}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
        

