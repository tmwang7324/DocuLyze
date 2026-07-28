import NavShell from "@/components/nav_shell";
import { getCurrentUid } from "@/_lib/data";

// The home route. This is the one group that reads the cookie, and since
// 2026-07-26 the read exists *only* to pick the nav's presentation — / is the
// landing page whether or not you're signed in, so nothing below this layout
// branches on auth. The cost (this route renders dynamically) is accepted
// deliberately; see components/nav_shell.tsx for the alternative and why not.
//
// getSession is wrapped in React cache(), so if a page below ever does derive
// the uid, the two share a single verifySessionCookie call per request.
export default async function PublicLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    const authenticated = (await getCurrentUid()) !== null;
    return (
        <NavShell variant={authenticated ? "signed-in" : "signed-out"}>
            {children}
        </NavShell>
    );
}
