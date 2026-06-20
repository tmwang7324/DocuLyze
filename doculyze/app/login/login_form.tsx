"use client";

import React from 'react'
import { auth } from '@/_lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { createRefresh } from '../actions/auth/session';
import { useRouter } from "next/navigation";


const LoginForm = () => {
  const [errorMessage, setErrorMessage] = React.useState("");
  const router = useRouter();

  const handleLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
        const formData = new FormData(e.currentTarget);
        // Pass formData to server action
        const email = formData.get("email")?.toString() || '';
        const password = formData.get("password")?.toString() || '';
        if (email.length === 0 || password.length === 0) {
            throw new Error("Email and password are required");
        } 

        const userCredentials = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredentials.user;
        const idToken = await user.getIdToken();
        
        
        // Call server action to create session cookie
        const cookie = await createRefresh(idToken);
        router.push("/dashboard");
    } catch (error: any) {
        console.log(error.message);
        setErrorMessage(error.message);
    }
  }
  return (
    <div>
        <form onSubmit={handleLoginSubmit}>
            <input name="email" type="email" id="email" placeholder="Email"></input>
            <input name="password" type="password" id="password" required minLength={8} placeholder="Password"></input>
            <button id="submit">Submit</button>
        </form>
        {errorMessage && <p>{errorMessage}</p>}

    </div>
  )
}

export default LoginForm