"use client";

// Fixed top navigation, ported from the Figma Make export. It renders in one of
// three presentations, and the *route group* picks which one — see
// components/nav_shell.tsx for why each group already knows the answer and why
// the root layout must not work it out.
//
// This is presentation only. It is NOT a trust boundary: every protected route
// still gates on app/(protected)/layout.tsx, and every write still derives its
// uid from the cookie via requireUid().

import { useState } from "react";
import Link from "next/link";
import { auth } from "@/_lib/firebase";
import { revokeSession } from "@/app/actions/auth/session";

const ROUNDED = "rounded-[0.625rem]"; // matches the design's global button radius

//   signed-out  → the public group with no session: the full marketing nav.
//   signed-in   → the protected group, and the public group with a session.
//   auth        → /login and /register: marketing anchors ONLY. No Home, no Chat,
//                 and neither CTA — these screens *are* the call to action, so a
//                 nav button either points at the page you're already on or
//                 competes with the form. Login and register cross-link to each
//                 other from inside the panels (#24), which is where that
//                 belongs. (issue #21)
export type NavVariant = "signed-out" | "signed-in" | "auth";

export default function SiteNav({ variant }: { variant: NavVariant }) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const [signingOut, setSigningOut] = useState(false);

    const authenticated = variant === "signed-in";
    // Marketing anchors are for readers who haven't converted; a signed-in user
    // has, so they drop. Shown on the auth pages precisely because that's the
    // only thing left in that variant.
    const showMarketing = variant !== "signed-in";
    const showProductLinks = variant !== "auth";

    // Route-qualified on purpose: these anchors live on the landing page, so a
    // bare "#features" from /login scrolls to nothing. On / itself the behaviour
    // is identical. (The target sections arrive with #22.)
    const marketing: [string, string][] = [
        ["/#features", "Features"],
        ["/#how", "How to use"],
    ];

    // Signed in, "Documents" points at /dashboard — the archive's permanent home.
    // An earlier revision of #23 was going to collapse the archive onto "/" and
    // retire this route; that was reversed on 2026-07-26, so this is the final
    // target rather than a placeholder.
    const homeHref = authenticated ? "/dashboard" : "/";

    // Same two-step sign-out the previous header used: drop the client SDK
    // session first, then revoke the server cookie (which redirects to /login).
    // No navigation needed here — /login sits in the (auth) group, whose layout
    // hardcodes the auth-page nav, so the redirect lands on a correct nav.
    const handleSignOut = async (): Promise<void> => {
        setSigningOut(true);
        try {
            await auth.signOut();
            await revokeSession();
        } catch (error) {
            console.error("Error signing out:", error);
            setSigningOut(false); // only reached if sign-out failed before the redirect
        }
    };

    return (
        <nav className="fixed top-0 left-0 right-0 z-50 border-b border-hairline bg-off-white/95 backdrop-blur-sm">
            <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                <Link
                    href="/"
                    className={`border border-dark bg-white px-2 py-1 font-display text-[22px] font-black tracking-tight text-dark uppercase leading-none ${ROUNDED}`}
                >
                    <span className="italic">DocuLyze</span>
                    <span className="text-orange-primary">.</span>
                </Link>

                <div className="hidden md:flex items-center gap-8">
                    {showProductLinks && (
                        <>
                            <Link
                                href={homeHref}
                                className="font-body text-sm font-medium text-muted hover:text-dark transition-colors"
                            >
                                {authenticated ? "Documents" : "Home"}
                            </Link>
                            <Link
                                href="/#how"
                                className="font-body text-sm font-medium text-muted hover:text-dark transition-colors"
                            >
                                How to use
                            </Link>
                            {/* TODO(#chat): the chat route does not exist yet — the RAG pipeline
                                lands with ticket #5. Kept in the nav to preserve the design's
                                shape; points nowhere until there's something to point at. */}
                            <span
                                aria-disabled="true"
                                className="font-body text-sm font-medium text-muted/60 cursor-not-allowed"
                                title="Coming soon"
                            >
                                Chat
                            </span>
                        </>
                    )}
                    {showMarketing &&
                        marketing.map(([href, label]) => (
                            <Link
                                key={href}
                                href={href}
                                className="font-body text-sm font-medium text-muted hover:text-dark transition-colors"
                            >
                                {label}
                            </Link>
                        ))}
                </div>

                {/* Nothing on the right in the auth variant — the wordmark and the
                    two anchors are the whole nav there. */}
                {variant !== "auth" && (
                    <div className="hidden md:flex items-center gap-3">
                        {authenticated ? (
                            <>
                                <Link
                                    href="/upload"
                                    className="px-4 py-2 text-sm font-medium text-dark hover:text-orange-primary transition-colors"
                                >
                                    Upload
                                </Link>
                                <button
                                    onClick={handleSignOut}
                                    disabled={signingOut}
                                    className="px-5 py-2.5 text-sm font-semibold border border-dark text-dark hover:border-orange-primary hover:text-orange-primary transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    {signingOut ? "Signing out…" : "Sign out"}
                                </button>
                            </>
                        ) : (
                            <>
                                <Link
                                    href="/login"
                                    className="px-4 py-2 text-sm font-medium text-dark hover:text-orange-primary transition-colors"
                                >
                                    Sign in
                                </Link>
                                <Link
                                    href="/register"
                                    className={`px-5 py-2.5 text-sm font-semibold bg-orange-primary text-white hover:bg-orange-deep transition-colors ${ROUNDED}`}
                                >
                                    Get started
                                </Link>
                            </>
                        )}
                    </div>
                )}

                <button
                    className="md:hidden p-2 cursor-pointer"
                    onClick={() => setMobileOpen((open) => !open)}
                    aria-label="Toggle navigation"
                    aria-expanded={mobileOpen}
                >
                    <div className="w-5 h-0.5 bg-dark mb-1.5" />
                    <div className="w-5 h-0.5 bg-dark mb-1.5" />
                    <div className="w-3 h-0.5 bg-dark" />
                </button>
            </div>

            {mobileOpen && (
                <div className="md:hidden border-t border-hairline bg-off-white px-6 py-4 flex flex-col gap-4">
                    {showProductLinks && (
                        <>
                            <Link href={homeHref} onClick={() => setMobileOpen(false)} className="text-sm font-medium text-dark">
                                {authenticated ? "Documents" : "Home"}
                            </Link>
                            {/* Same disabled chat entry as the desktop nav — the mobile menu is
                                a narrower version of it, not a different nav. */}
                            <span aria-disabled="true" className="text-sm font-medium text-muted/60 cursor-not-allowed" title="Coming soon">
                                Chat
                            </span>
                        </>
                    )}
                    {showMarketing &&
                        marketing.map(([href, label]) => (
                            <Link
                                key={href}
                                href={href}
                                onClick={() => setMobileOpen(false)}
                                className="text-sm font-medium text-dark"
                            >
                                {label}
                            </Link>
                        ))}
                    {/* Same guard and same branch as the desktop CTAs above — the
                        mobile menu is a narrower version of that nav, so it must
                        not decide who sees what by a different rule. */}
                    {variant !== "auth" &&
                        (authenticated ? (
                            <>
                                <Link href="/upload" onClick={() => setMobileOpen(false)} className="text-sm font-medium text-dark">
                                    Upload
                                </Link>
                                <button
                                    onClick={() => { setMobileOpen(false); handleSignOut(); }}
                                    disabled={signingOut}
                                    className="text-left text-sm font-medium text-orange-primary disabled:opacity-50"
                                >
                                    {signingOut ? "Signing out…" : "Sign out"}
                                </button>
                            </>
                        ) : (
                            <>
                                <Link href="/login" onClick={() => setMobileOpen(false)} className="text-sm font-medium text-dark">
                                    Sign in
                                </Link>
                                <Link href="/register" onClick={() => setMobileOpen(false)} className="text-sm font-medium text-orange-primary">
                                    Get started
                                </Link>
                            </>
                        ))}
                </div>
            )}
        </nav>
    );
}
