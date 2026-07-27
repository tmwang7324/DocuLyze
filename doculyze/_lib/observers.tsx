"use client";

import { auth } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useAuth } from "@/app/providers";
import { defaultAuthUser } from "@/app/providers";


export default function authContextSetter() {
    const {user, setUser } = useAuth();
    const subscribe = onAuthStateChanged(auth, (userData) => {
        
        if (userData) {
            const data = {
                "email": userData.email,
                "uid": userData.uid,
                "verified": true,
                // Added for issue #21 only so `npx tsc --noEmit` is green — the
                // AuthUser type has required profile_pic and this module (which
                // has no callers) predated it.
                "profile_pic": userData.photoURL || null
            }
            setUser(data);
            console.log("User is signed in with data:", data);
            console.log("User state in context:", user);

        }
        else {
            setUser(defaultAuthUser);
            console.log("No user is signed in.");
        }
    });
    return subscribe;
    
}