"use client";

import React, { useActionState, useContext, useEffect } from 'react'
import { auth } from '@/_lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { createRefresh } from '@/app/actions/auth/session';
import { SubmitButton } from '@/components/button';
import { useRouter } from 'next/navigation'; 
import { useAuth } from '@/app/providers';

const LoginForm = () => {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = React.useState("");
  const formRef = React.useRef<HTMLFormElement>(null);
  const { setUser } = useAuth();

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
        
        setUser({
                email: user.email || "",
                uid: user.uid || "",
                verified: true,
                profile_pic: user.photoURL || null
            });
        // Call server action to create session cookie
        router.push("/dashboard");
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


  // Issue #24: markup only below this line. The sign-in flow above is untouched —
  // client sign-in, ID token exchanged for a server-minted session cookie, then
  // createRefresh's own redirect.
  return (
    <div>
        <form action={formAction} ref={formRef}>
            <div className="mb-5">
                <label htmlFor="email" className="block font-mono-label text-[11px] tracking-widest uppercase text-muted mb-2">
                    Email
                </label>
                <input
                    name="email"
                    type="email"
                    id="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    className="w-full border-2 border-dark bg-white px-4 py-3 font-body text-sm text-dark placeholder:text-placeholder outline-none focus:border-orange-primary transition-colors"
                ></input>
            </div>
            <div className="mb-5">
                <label htmlFor="password" className="block font-mono-label text-[11px] tracking-widest uppercase text-muted mb-2">
                    Password
                </label>
                <input
                    name="password"
                    type="password"
                    id="password"
                    required
                    minLength={8}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full border-2 border-dark bg-white px-4 py-3 font-body text-sm text-dark placeholder:text-placeholder outline-none focus:border-orange-primary transition-colors"
                ></input>
            </div>
            <SubmitButton label="Login" loading="Logging in..." />
        </form>
        {/* "success" is the sentinel handleLoginSubmit returns on the happy path,
            not something to show the user — surfacing it in the error style would
            report a successful sign-in as a failure. */}
        {formState.message && formState.message !== "success" && (
            <p
                role="alert"
                className="mt-5 border-l-2 border-orange-primary bg-orange-pale px-4 py-3 font-body text-sm text-orange-deep"
            >
                {formState.message}
            </p>
        )}

    </div>
  )
}

export default LoginForm