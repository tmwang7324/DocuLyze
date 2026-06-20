"use client";

import React from 'react'
import { createRefresh } from '../actions/auth/session';
import { validateEmailAndPassword } from '../actions/auth/form_validation'
import { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/_lib/firebase';
import { useRouter } from "next/navigation"

const RegisterForm = () => {
  const [errorMessage, setErrorMessage] = useState("");
  const router = useRouter();
  const handleRegisterSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
        
        const formData = new FormData(e.currentTarget);
        const email = formData.get("email")?.toString() || '';
        const password = formData.get("password")?.toString() || '';
        await validateEmailAndPassword(email, password);
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        const idToken: string = await user.getIdToken();
        if (!idToken) {
            throw new Error("Failed to retrieve ID token from Firebase user");
        }
        const cookie = await createRefresh(idToken);
        router.push("/dashboard");
    } catch (error: any) {
        setErrorMessage(error.message);
    }
    
  }
  return (
    <div>
      <form onSubmit={handleRegisterSubmit}>
        
        <input type="email" name="email" placeholder="Email"></input>
        <input type="password" name="password" required minLength={8} placeholder="Password"></input>
        <button type="submit">Submit</button>
        {errorMessage && <p>{errorMessage}</p>}
      </form>
    </div>
  )
}

export default RegisterForm;