
"use client";

import { useState } from "react";

export default function UserRegistrationForm() {
    const [email, setEmail] = useState<string>("");
    const [password, setPassword] = useState<string>("");
    return (
        <form> 
            <input type="email" id="email" placeholder="Email" onChange={(e) => setEmail(e.target.value)}></input>
            <input type="password" id="password" placeholder="Password" onChange={(e) => setPassword(e.target.value)}></input>
            
            
            {/* <button id="submit" onClick={async e =>  {
                e.preventDefault()
                await fetch("http://localhost:1234/api/userRegistration", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({email, password})
                });
            }} >Submit</button> */}
        </form>

    );
}