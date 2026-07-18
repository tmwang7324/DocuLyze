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
    verified: false
};

const AuthContext = createContext<AuthContextType>({
    user: defaultAuthUser,
    setUser: () => {},
    loading: true,
    setIsLoading: () => {}
});


export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<AuthUser>(defaultAuthUser);
    const [loading, setLoading] = useState<boolean>(true);
  //
    useEffect(() => {
        //update user state based on verification
        const verifySession = async () => {
            if(!await verifyUser())
            {
                await auth.signOut();
                setUser(defaultAuthUser);
            }
            
        };
        verifySession(); // Call the verifySession function to check the session on component mount

        const subscribe = onAuthStateChanged(auth, (userData: User | null) => {
            setLoading(true);
            if (userData)
            {    
                //console.log("User is set in Header"); && await verifyUser() async
                setUser({
                    email: userData.email || "",
                    uid: userData.uid || "",
                    verified: true
                });
            }
            else {
                setUser(defaultAuthUser);
            }
            setLoading(false);
            
        });
        return () => subscribe(); // Cleanup the subscription on unmount
    }, []);
    return (
        <AuthContext.Provider value={{user: user, setUser: setUser, loading: loading, setIsLoading: setLoading}}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
        

