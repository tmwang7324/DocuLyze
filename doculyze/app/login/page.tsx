"use client";
import { useState, useEffect } from "react";
import { auth } from "../../_lib/firebase"
import { signInWithEmailAndPassword, GoogleAuthProvider } from "firebase/auth";
import { createCSRFToken, createUserSessionOnBackend, getCookie } from "@/_lib/api_with_express";

import LoginForm from "./login_form";
import Link from "next/link";

export default function Login() {
    return (
        <div>
            <h1>Login</h1>
            <LoginForm></LoginForm>
            <Link href="/forgot-password">Forgot Password</Link>
            <Link href="/register">Don't have an account? Register here.</Link>
        </div>
    );
}


// export default function login() {
//     const [email, setEmail] = useState("");
//     const [password, setPassword] = useState("");
//     const [errorMessage, setErrorMessage] = useState("");
//     const signIn = async (e: React.FormEvent<HTMLButtonElement>) => {
//         e.preventDefault();
//         // Bug fix: await CSRF token creation before signing in so the cookie is
//         // guaranteed to be stored before getCookie("csrfToken") is called.
//         await createCSRFToken();
//         try {
//             const userCredential = await signInWithEmailAndPassword(auth, email, password);
//             const user = userCredential.user;
//             const CSRFToken = getCookie("csrfToken");
//             const data = await createUserSessionOnBackend(user, CSRFToken);
//             console.log("Session cookie created on backend:", data);
//         } catch (error: any) {
//             setErrorMessage(error.message);
//         }
//     }
//     return (
//         <div> LOGIN 
//             <form>
//                 <input type="email" id="email" placeholder="Email" onChange={(e) => {e.preventDefault(); setEmail(e.target.value)}}></input>
//                 <input type="password" id="password" placeholder="Password" onChange={(e) => {e.preventDefault(); setPassword(e.target.value)}}></input>
//                 <button id="submit" onClick = {signIn}>Submit</button>
//             </form>
//             <button onClick={(e) => { 
//                 e.preventDefault(); 
//                 }}>Google OAuth</button>
//             <Link to="/forgot-password">Forgot Password</Link>
//         </div>
        
//     )
// }
