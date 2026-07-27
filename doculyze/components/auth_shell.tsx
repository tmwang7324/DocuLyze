// Split-panel chrome for /login and /register (issue #24), ported from the Figma
// Make export "Dynamic Document Retrieval Pages".
//
// Both auth screens are the same shape — an editorial panel on one side, the form
// on the other — differing only in the panel's tone and contents, so the shape
// lives here once. Presentation only: no auth state is read or decided in this
// file. Both routes sit in the (auth) group, whose layout deliberately reads
// nothing, and these components hold no state, so /login and /register keep
// prerendering as static.

import type { ReactNode } from "react";

// The nav is fixed at h-16 and NavShell already pays for that clearance, so a
// full-bleed panel measures against the remaining viewport.
const BELOW_NAV = "min-h-[calc(100vh-4rem)]";

type AuthSplitProps = {
    /** dark = sign-in, accent = registration. */
    tone: "dark" | "accent";
    panel: ReactNode;
    /** Decorative panels are dropped on small screens instead of pushing the
     *  form down a phone-height scroll; substantive ones stack under it. */
    hidePanelOnMobile?: boolean;
    children: ReactNode;
};

export function AuthSplit({ tone, panel, hidePanelOnMobile = false, children }: AuthSplitProps) {
    const panelTone = tone === "dark" ? "bg-dark text-off-white" : "bg-orange-primary text-white";

    return (
        <div className={`${BELOW_NAV} grid lg:grid-cols-2`}>
            {/* Form first in the DOM so it is first on a phone and first for a
                screen reader — the panel is supporting material either way. */}
            <section className="order-1 lg:order-2 flex items-center justify-center px-6 py-14 sm:px-10 lg:px-16">
                <div className="w-full max-w-sm">{children}</div>
            </section>

            <section
                className={`order-2 lg:order-1 ${panelTone} ${
                    hidePanelOnMobile ? "hidden lg:flex" : "flex"
                } flex-col justify-center px-6 py-14 sm:px-10 lg:px-16`}
            >
                <div className="w-full max-w-md lg:ml-auto">{panel}</div>
            </section>
        </div>
    );
}

/**
 * The design's section marker: mono, uppercase, tracked out. `tone` names the
 * surface it sits on, not the colour it paints — "light" is the off-white form
 * side, the other two are the panel itself.
 */
export function PanelEyebrow({
    tone,
    children,
}: {
    tone: "dark" | "accent" | "light";
    children: ReactNode;
}) {
    const color =
        tone === "dark" ? "text-orange-light" : tone === "accent" ? "text-white/70" : "text-orange-primary";
    return (
        <div className={`font-mono-label ${color} text-xs tracking-widest uppercase mb-6`}>
            {children}
        </div>
    );
}

/** The panel's headline, in the display face at the design's heaviest weight. */
export function PanelHeading({ children }: { children: ReactNode }) {
    return (
        <h2
            className="font-display uppercase leading-[0.9] mb-6"
            style={{ fontSize: "clamp(40px, 4.5vw, 62px)", fontWeight: 900, letterSpacing: "-0.03em" }}
        >
            {children}
        </h2>
    );
}

// The field treatment itself — mono uppercase label over a thick-bordered input
// that takes the accent colour on focus — is applied directly to the <input>
// elements in login_form.tsx and register_form.tsx rather than wrapped in a
// component here, so each form keeps its own plain markup.
