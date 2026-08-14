// The fixed nav plus the clearance it needs, as one unit.
//
// Issue #21: the nav's presentation is resolved server-side rather than from the
// client AuthContext, which settles asynchronously and would flash the signed-out
// nav on first paint. It is NOT resolved in the root layout, though — a cookies()
// call there is a shared segment above every route and opts the whole app out
// of static rendering. Instead each route group supplies the value it already
// knows:
//
//   (auth)      -> "auth", hardcoded. The group never reads the cookie, so
//                  /login and /register prerender as static. It also no longer
//                  has to pretend the visitor is signed out to get there: the
//                  auth variant simply has no auth-state-dependent entries.
//   (protected) -> "signed-in", and it's a proof rather than a guess: that
//                  layout redirects to /login when the cookie doesn't verify, so
//                  it cannot render at all unless the user is authenticated.
//   (public)    -> read from the cookie.
//
// That last read is worth being honest about. It used to be free: / was going to
// branch on auth (landing page signed out, archive signed in), so the group was
// dynamic regardless. Since 2026-07-26 the archive stays at /dashboard and / is
// the landing page in both states, which makes this read the *only* reason /
// renders dynamically. It stays anyway — the alternative is hardcoding the
// signed-out nav, which would show a signed-in visitor the wrong nav on the page
// they are most likely to arrive at cold.
//
// This is presentation only. Access control still lives in
// app/(protected)/layout.tsx and every write still derives its uid from the
// cookie via requireUid().

import SiteNav, { type NavVariant } from "@/components/site_nav";

export default function NavShell({
    variant,
    children,
}: {
    variant: NavVariant;
    children: React.ReactNode;
}) {
    return (
        <>
            <SiteNav variant={variant} />
            {/* The nav is fixed at h-16; everything below it clears that. */}
            <div className="flex-1 pt-16">{children}</div>
        </>
    );
}
