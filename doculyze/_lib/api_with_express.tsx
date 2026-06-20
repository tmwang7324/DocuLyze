import { auth } from "./firebase";
import type { User } from "firebase/auth";

export async function fetchCurrentUserFromBackend(user: User | null = auth.currentUser) {
    try {
        if (!user) {
            throw new Error("No authenticated user found");
        }
        const idToken: string = await user.getIdToken();
        const response: Response = await fetch("http://localhost:5000/api/getCurrentUser", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${idToken}`
            },
        });
        if (!response.ok) {
            throw new Error("Failed to fetch user data from backend because API request failed with status " + response.status);
        }
        return response.json();
    } catch (error) {
        console.log(error);
    }

} 

export async function createUserSessionOnBackend(user: User | null = auth.currentUser, csrfToken: string | null = null): Promise<any> {
    try {
    
        if (!user) {
            throw new Error("No authenticated user found");

        }
        const idToken: string = await user.getIdToken();
        //const csrfToken = getCookie("csrfToken");
        const response: Response = await fetch("http://localhost:5000/api/session/login", {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ idToken,  csrfToken})
        });

        if (!response.ok) {
            throw new Error("Failed to create user session on backend because API request failed with status " + response.status);

        }
        
        return response.json();
    } catch (error) {
        console.log(error);
    }
}

export async function createCSRFToken() {
    try {
        // Bug fix: credentials: "include" is required so the browser stores the
        // cross-origin csrfToken cookie that the backend sets in its response.
        // Without it, document.cookie never contains csrfToken.
        const response: Response = await fetch("http://localhost:5000/api/createCSRFToken", {
            method: "GET",
            credentials: "include",
        });
        
        if (!response.ok) {
            throw new Error("Failed to create CSRF token because API request failed with status " + response.status);
        }
        return response.json();
    } catch (error) {
        console.log(error);
    }
}

export function getCookie(name: string): string | null {
    const cookie = document.cookie.split(";").find((c) => c.trim().startsWith(`${name}=`));
    return cookie ? decodeURIComponent(cookie.split("=")[1]) : null;
}

