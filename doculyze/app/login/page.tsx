import LoginForm from "./login_form";
import Link from "next/link";
import { AuthSplit, PanelEyebrow, PanelHeading } from "@/components/auth_shell";

// ⚠️ DECORATIVE — NOT LIVE DATA. The design's dark panel carries a list of recent
// searches as texture. These are fixed sample strings: there is no search history
// model, and querying itself arrives with the RAG pipeline (ticket #5). They are
// styled as a muted, non-interactive list precisely so they read as illustration
// rather than as this account's activity.
const sampleSearches = [
    "termination clause in the vendor agreement",
    "revenue recognition policy change",
    "who signed off on the Q3 forecast",
    "every mention of indemnification",
];

export default function Login() {
    return (
        <AuthSplit
            tone="dark"
            hidePanelOnMobile
            panel={
                <>
                    <PanelEyebrow tone="dark">Welcome back / 01</PanelEyebrow>
                    <PanelHeading>
                        Your archive
                        <br />
                        is <span className="text-orange-primary">waiting.</span>
                    </PanelHeading>
                    <p className="font-body text-sm leading-relaxed text-off-white/60 mb-12 max-w-sm">
                        Sign in to pick up where you left off — every document you have uploaded,
                        parsed and ready to work with.
                    </p>

                    <div className="font-mono-label text-[11px] tracking-widest uppercase text-off-white/40 mb-4">
                        The kind of question this answers
                    </div>
                    <ul className="border-t border-white/10">
                        {sampleSearches.map((search) => (
                            <li
                                key={search}
                                className="flex items-baseline gap-3 border-b border-white/10 py-3 font-body text-sm text-off-white/50"
                            >
                                <span aria-hidden="true" className="font-mono-label text-xs text-orange-primary">
                                    /
                                </span>
                                {search}
                            </li>
                        ))}
                    </ul>
                </>
            }
        >
            <PanelEyebrow tone="light">Sign in</PanelEyebrow>
            <h1
                className="font-display uppercase text-dark leading-[0.9] mb-8"
                style={{ fontSize: "clamp(38px, 4vw, 52px)", fontWeight: 900, letterSpacing: "-0.03em" }}
            >
                Login
            </h1>

            <LoginForm></LoginForm>

            <div className="mt-8 pt-6 border-t border-hairline flex flex-col gap-3">
                <Link
                    href="/forgot-password"
                    className="font-body text-sm text-muted hover:text-orange-primary transition-colors"
                >
                    Forgot Password
                </Link>
                <Link
                    href="/register"
                    className="font-body text-sm text-dark hover:text-orange-primary transition-colors"
                >
                    Don&apos;t have an account?{" "}
                    <span className="font-semibold underline underline-offset-4">Register here.</span>
                </Link>
            </div>
        </AuthSplit>
    );
}


// export default function login() {
//     const [email, setEmail] = useState("");
//     const [password, setPassword] = useState("");
//     const [errorMessage, setErrorMessage] = useState("");
//     const signIn = async (e: React.FormEvent<HTMLButtonElement>) => {
//         e.preventDefault();
//         // Bug fix: await CSRF token creation before signing in so the cookie is
//         // guaranteed to be stored before getCookie("csrfToken") is called.
//         await createCSRFToken();
//         try {
//             const userCredential = await signInWithEmailAndPassword(auth, email, password);
//             const user = userCredential.user;
//             const CSRFToken = getCookie("csrfToken");
//             const data = await createUserSessionOnBackend(user, CSRFToken);
//             console.log("Session cookie created on backend:", data);
//         } catch (error: any) {
//             setErrorMessage(error.message);
//         }
//     }
//     return (
//         <div> LOGIN 
//             <form>
//                 <input type="email" id="email" placeholder="Email" onChange={(e) => {e.preventDefault(); setEmail(e.target.value)}}></input>
//                 <input type="password" id="password" placeholder="Password" onChange={(e) => {e.preventDefault(); setPassword(e.target.value)}}></input>
//                 <button id="submit" onClick = {signIn}>Submit</button>
//             </form>
//             <button onClick={(e) => { 
//                 e.preventDefault(); 
//                 }}>Google OAuth</button>
//             <Link to="/forgot-password">Forgot Password</Link>
//         </div>
        
//     )
// }
