import NavShell from "@/app/_route_archive/nav_shell";

// /login and /register. This layout reads nothing — no cookies(), no session
// verification — which is the whole point: it lets both routes prerender as
// static instead of being server-rendered on demand for a nav whose contents
// don't depend on the session anyway.
//
// The "auth" variant is stripped to the wordmark and the two marketing anchors:
// no Home, no Chat, no Sign in, no Get started. These screens are themselves the
// call to action, so a nav CTA here either points at the page you're on or
// competes with the form. (issue #21)
export default function AuthLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return <NavShell variant="signed-out">{children}</NavShell>;
}
