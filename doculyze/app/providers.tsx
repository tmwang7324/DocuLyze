"use client";

import { createContext, use, useContext } from "react";
import { useState } from "react";
type AuthUser = {
    email: string | null;
    uid: string | null;
    verified: boolean;
};

type AuthContextType = {
    user: AuthUser;
    setUser: (user: AuthUser) => void;
}

export const defaultAuthUser = {
    email: "",
    uid: "",
    verified: false
};

const AuthContext = createContext<AuthContextType>({
    user: defaultAuthUser,
    setUser: () => {}
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<AuthUser>(defaultAuthUser);

    return (
        <AuthContext.Provider value={{user: user, setUser: setUser}}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
        

