// The two presentations every navbar entry has, as class names.
//
// The bar renders twice: once in the desktop row, once inside the mobile menu.
// Same islands, same auth read, different styling — the desktop row is muted
// text that darkens on hover, the mobile panel is already-dark text in a stacked
// column. Rather than fork each island, they take a `layout` and look their
// classes up here.
//
// Neutral module: class names only, no hooks, no imports — the same reasoning as
// components/status_tone.ts. Server islands and the client mobile menu both read
// it, so neither may own it.

export type NavLayout = "desktop" | "mobile";

// Matches the design's global button radius.
export const ROUNDED = "rounded-[0.625rem]";

export function navLinkClass(layout: NavLayout): string {
    return layout === "desktop"
        ? "font-body text-sm font-medium text-muted hover:text-dark transition-colors"
        : "text-sm font-medium text-dark";
}

// The quieter half of the right-hand cluster: "Upload" signed in, "Sign in"
// signed out. A text link in both layouts.
export function ctaQuietClass(layout: NavLayout): string {
    return layout === "desktop"
        ? "px-4 py-2 text-sm font-medium text-dark hover:text-orange-primary transition-colors"
        : "text-sm font-medium text-dark";
}

// The loud half: "Get started". Filled button on desktop, orange text in the
// mobile column — the design doesn't put a filled button inside the panel.
export function ctaLoudClass(layout: NavLayout): string {
    return layout === "desktop"
        ? `px-5 py-2.5 text-sm font-semibold bg-orange-primary text-white hover:bg-orange-deep transition-colors ${ROUNDED}`
        : "text-sm font-medium text-orange-primary";
}

// Sign-out is outlined on desktop and plain orange text on mobile, and it is a
// <button> in both — hence its own entry rather than reusing the CTA classes.
export function signOutClass(layout: NavLayout): string {
    return layout === "desktop"
        ? "px-5 py-2.5 text-sm font-semibold border border-dark text-dark hover:border-orange-primary hover:text-orange-primary transition-colors cursor-pointer disabled:opacity-50"
        : "text-left text-sm font-medium text-orange-primary disabled:opacity-50";
}
