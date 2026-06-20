"use client";
import { useAuth } from '@/app/providers';
import { auth } from '@/_lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import React, { useState, useEffect } from 'react';
import { revokeSession } from '@/app/actions/auth/session';


const Header = () => {
    const [isLoading, setIsLoading] = React.useState(true);
    const [user, setUser] = useState({
        email: "",
        uid: "",
        verified: false
    });
    //const { user } = useAuth();
    const handleSignOut = async (): Promise<void> => {
        await auth.signOut();
        setIsLoading(true);
        try {
            await revokeSession();
        } finally {
            setIsLoading(false);
        }
    }
    React.useEffect(() => {
        const subscribe = onAuthStateChanged(auth, (userData: User | null) => {
            if (userData) {
                const data = {
                    "email": userData?.email || "",
                    "uid": userData?.uid || "",
                    "verified": true
                }
                setUser(data);
                setIsLoading(false);
                console.log("User is signed in with data:", data);
            } else {
                setUser({
                    email: "",
                    uid: "",
                    verified: false
                });
                setIsLoading(false);
                console.log("User is signed out");
            }
        });
        return subscribe;
    }, [setUser]);
    return (
    <div>
        { isLoading ? <p>Loading...</p> : <div>{user.email ? `Welcome, ${user.email}  ` : "Not logged in"}
            <p onClick={handleSignOut}>signout</p>
            </div>}
    </div>
  )
}

export default Header

