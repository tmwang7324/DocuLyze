import { describe, it, expect } from "vitest";
import {
    homeEntry,
    authProfileLinks,
    showSignOut,
    MARKETING_ANCHORS,
} from "@/app/navbar/nav_model";

// Seam: what each navbar island decides, as data.
//
// The nav used to resolve its presentation once, in the route-group layout, and
// hand SiteNav a single `variant` prop. It now renders from the ROOT layout, so
// there is no group left to ask — each auth-dependent entry is its own island
// that reads the session cookie itself.
//
// That split is exactly what makes a seam worth having. Three islands now decide
// independently, and nothing in the type system stops them disagreeing: a
// HomeLink that thinks you're signed in while the CTA cluster offers you "Sign
// in" is a coherent-looking nav that lies about your session. The rules live
// here, in one module all three read, so "disagreeing" would mean failing a test
// rather than shipping a mismatched navbar.
describe("navbar islands", () => {
    describe("homeEntry", () => {
        it("points a signed-in user at the archive, not the landing page", () => {
            expect(homeEntry(true)).toEqual({ href: "/dashboard", label: "Documents" });
        });

        it("points an anonymous visitor at the landing page", () => {
            expect(homeEntry(false)).toEqual({ href: "/", label: "Home" });
        });

        // /dashboard sits in the (protected) group, whose layout redirects to
        // /login when the cookie doesn't verify. Offering it to a visitor with no
        // session is an invitation to a bounce.
        it("never offers the protected route to an anonymous visitor", () => {
            expect(homeEntry(false).href).not.toBe("/dashboard");
        });
    });

    describe("marketing anchors", () => {

        // These anchors target sections of the landing page. The nav now renders
        // on EVERY route from the root layout, so a bare "#features" would scroll
        // to nothing from /upload, /dashboard or /login. Route-qualifying them is
        // what keeps them meaningful off the landing page — and the root-layout
        // move makes that property load-bearing rather than incidental.
        it("qualifies every anchor with the landing route", () => {
            for (const { href } of MARKETING_ANCHORS) {
                expect(href.startsWith("/#")).toBe(true);
            }
        });

        it("advertises the sections the landing page is expected to have", () => {
            expect(MARKETING_ANCHORS.map((a) => a.label)).toEqual(["Features", "How to use"]);
        });
    });

    describe("authProfileLinks", () => {
        it("offers a signed-in user the upload route", () => {
            expect(authProfileLinks(true)).toEqual([
                { href: "/upload", label: "Upload", emphasis: "quiet" },
            ]);
        });

        it("offers an anonymous visitor both conversion routes", () => {
            expect(authProfileLinks(false)).toEqual([
                { href: "/login", label: "Sign in", emphasis: "quiet" },
                { href: "/register", label: "Get started", emphasis: "loud" },
            ]);
        });

        // Emphasis is carried per entry rather than inferred from position. The
        // renderer had been reading "last one in the signed-out pair" off the
        // index, which quietly encodes that the pair is exactly two long and
        // ordered — both true today, neither stated anywhere.
        it("marks exactly one entry as the loud call to action, and only when signed out", () => {
            expect(authProfileLinks(false).filter((l) => l.emphasis === "loud")).toHaveLength(1);
            expect(authProfileLinks(true).filter((l) => l.emphasis === "loud")).toHaveLength(0);
        });
    });

    describe("showSignOut", () => {
        it("renders the sign-out control for a signed-in user only", () => {
            expect(showSignOut(true)).toBe(true);
            expect(showSignOut(false)).toBe(false);
        });
    });

    // The pairs below are the ones a user would read as a contradiction. They are
    // asserted across the whole model rather than per-island, because the failure
    // mode is two islands disagreeing, not one island being individually wrong.
    describe("the two states never bleed into each other", () => {
        it("never shows an authenticated route to an anonymous visitor", () => {
            const anonymous = [homeEntry(false), ...authProfileLinks(false)].map((l) => l.href);
            expect(anonymous).not.toContain("/upload");
            expect(anonymous).not.toContain("/dashboard");
            expect(showSignOut(false)).toBe(false);
        });

        it("never invites a signed-in user to sign in or register again", () => {
            const authenticated = [homeEntry(true), ...authProfileLinks(true)].map((l) => l.href);
            expect(authenticated).not.toContain("/login");
            expect(authenticated).not.toContain("/register");
        });

        it("gives the signed-in nav exactly one way out of the session", () => {
            expect(showSignOut(true)).toBe(true);
            expect(authProfileLinks(true).some((l) => l.href === "/login")).toBe(false);
        });
    });
});
