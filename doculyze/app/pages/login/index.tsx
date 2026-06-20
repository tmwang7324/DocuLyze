import { useState, useEffect } from "react";
import { auth } from "../../../_lib/firebase"
import { signInWithEmailAndPassword, GoogleAuthProvider } from "firebase/auth";

export default function login() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    return (
        <div> LOGIN 
            <form>
                <input type="email" id="email" placeholder="Email" onChange={(e) => {e.preventDefault(); setEmail(e.target.value)}}></input>
                <input type="password" id="password" placeholder="Password" onChange={(e) => {e.preventDefault(); setPassword(e.target.value)}}></input>
                <button id="submit" onClick = {e => {e.preventDefault();
                    signInWithEmailAndPassword(auth, email, password).then((userCredential) => {
                        // Signed in
                        const user = userCredential.user;
                        console.log(user);
                    }).catch((error) => {
                        console.error(error);
                    });
                    console.log(email, password)}}>Submit</button>
            </form>
            <button onClick={(e) => { 
                e.preventDefault(); 
                }}>Google OAuth</button>
            <a href="/forgot-password">Forgot Password?</a>
        </div>
        
    )
}