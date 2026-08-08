// What each navbar island renders, as data rather than markup.
//
// Neutral module by construction: no "use client", no `server-only`, no hooks,
// no imports. The islands that read it are Server Components; the mobile menu
// that lays them out is a Client Component. Both have to agree, so neither may
// own this.
//
// Why it exists at all. The nav used to resolve its presentation once — the
// route group knew the answer and handed SiteNav a single `variant` prop, so the
// whole bar was necessarily self-consistent. Rendering from the root layout
// gives that up: three islands now each read the session cookie and decide
// alone. Consistency stops being structural and becomes a claim, and a claim is
// the kind of thing that needs somewhere to live and something to check it.
// tests/navbar/islands.test.ts is that check.

export type NavLink = { href: string; label: string };

// How hard an entry in the right-hand cluster pushes. Carried per entry rather
// than inferred from position, so the renderer never has to know how long the
// list is or what order it's in.
export type NavEmphasis = "quiet" | "loud";
export type NavCta = NavLink & { emphasis: NavEmphasis };

// Signed in, "home" is the archive — /dashboard is its permanent address, not a
// placeholder (the 2026-07-26 reversal put the archive back there and left / as
// the landing page in both states).
export function homeEntry(authed: boolean): NavLink {
    return authed
        ? { href: "/dashboard", label: "Documents" }
        : { href: "/", label: "Home" };
}

// Route-qualified deliberately. These target sections of the landing page, and
// the nav now renders on every route, so a bare "#features" would scroll to
// nothing from /upload or /login. (The target sections arrive with #22.)
export const MARKETING_ANCHORS: readonly NavLink[] = [
    { href: "/#features", label: "Features" },
    { href: "/#how", label: "How to use" },
];

// Marketing copy is for readers who haven't converted. A signed-in user has.
export function showMarketing(authed: boolean): boolean {
    return !authed;
}

// The right-hand cluster. Signed in this is one link plus the sign-out control
// below; signed out it is the two conversion routes, of which only "Get started"
// is loud — two filled buttons side by side would compete.
export function authProfileLinks(authed: boolean): readonly NavCta[] {
    return authed
        ? [{ href: "/upload", label: "Upload", emphasis: "quiet" }]
        : [
              { href: "/login", label: "Sign in", emphasis: "quiet" },
              { href: "/register", label: "Get started", emphasis: "loud" },
          ];
}

