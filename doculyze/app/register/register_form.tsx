"use client";

import React from 'react'
import { createRefresh } from '../actions/auth/session';
import { validateEmailAndPassword } from '../actions/auth/form_validation'
import { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/_lib/firebase';
import { useRouter } from "next/navigation"
import { SubmitButton } from '@/components/button'

const RegisterForm = () => {
  const [errorMessage, setErrorMessage] = useState("");
  const router = useRouter();
  
  const handleRegisterSubmit = async (formData: FormData) => {
    try {
        const email = formData.get("email")?.toString() || '';
        const password = formData.get("password")?.toString() || '';
        // server-side action
        await validateEmailAndPassword(email, password);
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        const idToken: string = await user.getIdToken();
        if (!idToken) {
            throw new Error("Failed to retrieve ID token from Firebase user");
        }
        const cookie = await createRefresh(password, idToken);
        // router.push("/dashboard");
    } catch (error: any) {
        setErrorMessage(error.message);
    }
    
  }
  return (
    <div>
      <form action={handleRegisterSubmit}>
        
        <input type="email" name="email" placeholder="Email"></input>
        <input type="password" name="password" required minLength={8} placeholder="Password"></input>
        <SubmitButton label="Register" loading="Registering..." />
        {errorMessage && <p>{errorMessage}</p>}
      </form>
    </div>
  )
}

export default RegisterForm;