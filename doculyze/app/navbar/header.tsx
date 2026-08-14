// The navbar shell: static markup plus the islands that aren't.
//
// A Server Component with no "use client", no hooks and no session read of its
// own. That is deliberate and load-bearing — a directive here would compile
// every island below into the client bundle, and an island in the browser cannot
// call getCurrentUid(). The two pieces that genuinely need the client
// (sign_out_button, mobile_menu) are leaves, reached from the server side.
//
// Rendered once, from app/layout.tsx. The root layout used to be forbidden from
// touching the session for exactly the reason it now can: a cookies() call in a
// shared segment opts every route out of static rendering. Moving the read down
// into the islands is what lifts that — the shell itself reads nothing.
//
// It does NOT make the routes static, though. Without a Suspense boundary there
// is nothing for React to stream around, so the page's HTML waits on the
// islands' one shared verifySessionCookie (getCurrentUid is cache()-wrapped, so
// four island renders cost one round-trip). That was the accepted trade: no
// skeleton, no layout shift, a correct nav in the first byte, at the price of
// every route rendering dynamically. Adding Suspense — or cacheComponents:true,
// which requires it — is the way back if that cost ever shows up.


import Link from "next/link";
import HomeLink from "./home_link";
import Features from "./features";
import AuthProfile from "./upload";
import MobileMenu from "./mobile_menu";
import { ROUNDED, type NavLayout } from "./layout_classes";

// Static: the chat route doesn't exist yet — the RAG pipeline lands with ticket
// #5. Kept in the bar to preserve the design's shape, pointing nowhere until
// there's something to point at. Not an island; it reads the same signed in or
// out.
function ChatPlaceholder({ layout }: { layout: NavLayout }) {
    return (
        <span
            aria-disabled="true"
            className={
                layout === "desktop"
                    ? "font-body text-sm font-medium text-muted/60 cursor-not-allowed"
                    : "text-sm font-medium text-muted/60 cursor-not-allowed"
            }
            title="Coming soon"
        >
            Chat
        </span>
    );
}

export default function Header() {
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
                    <HomeLink layout="desktop" />
                    <ChatPlaceholder layout="desktop" />
                    <Features layout="desktop" />
                </div>

                <div className="hidden md:flex items-center gap-3">
                    <AuthProfile layout="desktop" />
                </div>

                {/* Same islands, same single cookie read, stacked instead of in a
                    row. They are passed as children rather than imported by the
                    menu — see mobile_menu.tsx for why that distinction matters. */}
                <MobileMenu>
                    <HomeLink layout="mobile" />
                    <ChatPlaceholder layout="mobile" />
                    <Features layout="mobile" />
                    <AuthProfile layout="mobile" />
                </MobileMenu>
            </div>
        </nav>
    );
}
