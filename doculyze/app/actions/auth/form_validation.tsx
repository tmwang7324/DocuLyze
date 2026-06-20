"use server";

export async function validateEmailAndPassword(email: string, password: string) {
    if (!email || !password) {
        throw new Error("Email and password are required");
    }
    if (password.length < 8 || !email.includes("@")) {
        throw new Error("Password must be at least 8 characters long and email must be valid");
    }
    
}