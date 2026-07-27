import { createUserWithEmailAndPassword } from "firebase/auth/web-extension";
import { auth } from "../../_lib/firebase";
import RegisterForm from "./register_form";

export default function Register() {
    
    return (
        <div>
            <h1>Register New</h1>
            <RegisterForm></RegisterForm>
        </div>
    );
}


// export default function Register() {
//     const [email, setEmail] = useState("");
//     const [password, setPassword] = useState("");
//     const [errorMessage, setErrorMessage] = useState("");
//     const router = useRouter();
//     // onAuthStateChanged(auth, (user) => {
//     //     if (user) {
//     //         console.log("User is signed in:", user);
//     //     }
//     //     else {
//     //         console.log("No user is signed in.");
//     //     }
//     // })
    
//     async function handleSubmit(e: React.FormEvent<HTMLButtonElement>) {
//         e.preventDefault();
//         // Bug fix: await CSRF token creation before registering so the cookie is
//         // guaranteed to be stored before getCookie("csrfToken") is called.
//         await createCSRFToken();
//         try {
//             const userCredential = await createUserWithEmailAndPassword(auth, email, password);
//             const user = userCredential.user;
//             const CSRFToken = getCookie("csrfToken");
//             const data = await createUserSessionOnBackend(user, CSRFToken);
//             console.log("Session cookie created on backend:", data);
//             //router.push("/email-verification");
//         } catch (error: any) {
//             setErrorMessage(error.message);
//         }
//     }
//     return (
//         <div>Register
//         <form> 
//             <input type="email" id="email" placeholder="Email" onChange={(e) => {setEmail(e.target.value);}}></input>
//             <input type="password" id="password" placeholder="Password" onChange={(e) => {setPassword(e.target.value);}}></input>
//             <button id="submit" onClick = {handleSubmit}>Submit</button>
//         </form>
//         {errorMessage && <p>{errorMessage}</p>}
//         </div>
//     )
// }