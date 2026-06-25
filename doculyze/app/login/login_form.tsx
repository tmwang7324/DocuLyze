"use client";

import React, { useActionState, useEffect } from 'react'
import { auth } from '@/_lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { createRefresh } from '../actions/auth/session';
import { SubmitButton } from '@/components/button';
import { useRouter } from 'next/navigation'; 

const LoginForm = () => {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = React.useState("");
  const formRef = React.useRef<HTMLFormElement>(null);

  type FormState = {
    message: string;
  };

  const handleLoginSubmit = async (prevState: FormState, formData: FormData) =>  {
    try {
        
        // Pass formData to server action
        const email = formData.get("email")?.toString() || '';
        const password = formData.get("password")?.toString() || '';
        if (email.length === 0 || password.length === 0) {
            throw new Error("Email and password are required");
        } 

        const userCredentials = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredentials.user;
        const idToken = await user.getIdToken();
        const cookie = await createRefresh(password, idToken);
        // setUser({
        //         email: user.email || "",
        //         uid: user.uid || "",
        //         verified: true
        //     });
        // Call server action to create session cookie
        //router.push("/dashboard");
        console.log({message: "success"});
        return { message: "success" }; // return a success message as the new state
    } catch (error: any) {
        console.log(error.message);
        return { message: error.message }; // return the new state instead of calling setErrorMessage (that's the whole point of useActionState — it replaces the useState for form result)
    }
  }
  
  const [formState, formAction] = useActionState(handleLoginSubmit, {
    message: ""
  });

  useEffect(() => {
    if (formState.message === "success") {
      // Reset the form after successful login
      if (formRef.current) {
        formRef.current.reset();
      }
    }
  }, [formState]);


  return (
    <div>
        <form action={formAction} ref={formRef}>
            <input name="email" type="email" id="email" placeholder="Email"></input>
            <input name="password" type="password" id="password" required minLength={8} placeholder="Password"></input>
            <SubmitButton label="Login" loading="Logging in..." />
        </form>
        {formState.message && <p>{formState.message}</p>}
        
    </div>
  )
}

export default LoginForm