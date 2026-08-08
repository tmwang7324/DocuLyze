import { createUserWithEmailAndPassword } from "firebase/auth/web-extension";
import { auth } from "@/_lib/firebase";
import RegisterForm from "./register_form";
import Link from "next/link";
import { AuthSplit, PanelEyebrow, PanelHeading } from "@/components/auth_shell";
import { REGISTER_PANEL_BENEFITS, FORMAT_CHIPS } from "@/_lib/auth_panel_copy";

export default function Register() {

    return (
        <AuthSplit
            tone="accent"
            panel={
                <>
                    <PanelEyebrow tone="accent">Create an account / 01</PanelEyebrow>
                    <PanelHeading>
                        Start
                        <br />
                        your archive.
                    </PanelHeading>

                    {/* Copy comes from _lib/auth_panel_copy.ts, not from this markup:
                        the per-file limit is computed from the same constant the
                        upload validator enforces, and the chips from the same
                        allowlist the signer honours. See that module for why. */}
                    <ul className="mb-10 border-t border-white/25">
                        {REGISTER_PANEL_BENEFITS.map((benefit) => (
                            <li
                                key={benefit}
                                className="flex items-baseline gap-3 border-b border-white/25 py-3.5 font-body text-sm leading-relaxed text-white/90"
                            >
                                <span aria-hidden="true" className="font-mono-label text-xs text-white/60">
                                    +
                                </span>
                                {benefit}
                            </li>
                        ))}
                    </ul>

                    <div className="font-mono-label text-[11px] tracking-widest uppercase text-white/60 mb-3">
                        Formats accepted
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {FORMAT_CHIPS.map((chip) => (
                            <span
                                key={chip}
                                className="border border-white/40 px-2.5 py-1 font-mono-label text-[11px] tracking-wider text-white"
                            >
                                {chip}
                            </span>
                        ))}
                    </div>
                </>
            }
        >
            <PanelEyebrow tone="light">Get started</PanelEyebrow>
            <h1
                className="font-display uppercase text-dark leading-[0.9] mb-8"
                style={{ fontSize: "clamp(38px, 4vw, 52px)", fontWeight: 900, letterSpacing: "-0.03em" }}
            >
                Register New
            </h1>

            <RegisterForm></RegisterForm>

            <div className="mt-8 pt-6 border-t border-hairline">
                <Link
                    href="/login"
                    className="font-body text-sm text-dark hover:text-orange-primary transition-colors"
                >
                    Already have an account?{" "}
                    <span className="font-semibold underline underline-offset-4">Sign in.</span>
                </Link>
            </div>
        </AuthSplit>
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