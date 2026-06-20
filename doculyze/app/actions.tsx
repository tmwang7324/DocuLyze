"use server";

import { createUserWithEmailAndPassword } from "firebase/auth";
import { createSession } from "./actions/auth/session";
import { auth } from "@/_lib/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";

import { revalidatePath } from "next/dist/server/web/spec-extension/revalidate";
//.UserUser


export async function handle_register(IdToken: string) {
    try {
        
        const cookie = await createSession(IdToken);
        if (!cookie) {
            throw new Error("Failed to create session cookie on backend");
        }
        revalidatePath("/dashboard");
        

        console.log("Session cookie created on backend:", cookie);

    } catch (error) {
        console.log(error);
    }
    
}

// export async function handle_login(formData: FormData) {
//     try {
//         const email = formData.get("email")?.toString();
//         const password = formData.get("password")?.toString();
//         if (!email || !password) {
//             throw new Error("Email and password are required");
//         }
//         const userCredential = await signInWithEmailAndPassword(auth, email, password);
//         const user = userCredential.user;
//         const idToken: string = await user.getIdToken();
//         const cookie = await createSession(user);

