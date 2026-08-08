"use client";

// The mobile panel's open/closed state — the only other thing in the bar that
// needs the client.
//
// It takes the islands as `children` rather than importing them. That
// distinction is the entire client/server boundary rule: a Client Component may
// RENDER Server Components handed down from a server parent, but anything it
// IMPORTS is compiled into the client bundle along with it. Importing the
// islands here would put getCurrentUid — and _lib/data.tsx's `server-only`
// guard — in the browser. Passing them in keeps them on the server, and this
// component never learns whether anyone is signed in.
//
// Closing on click bubbles rather than being wired per link, for the same
// reason: the links are server-rendered children, so there is no handler to
// attach to them from here.

import { useState } from "react";

export default function MobileMenu({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                className="md:hidden p-2 cursor-pointer"
                onClick={() => setOpen((wasOpen) => !wasOpen)}
                aria-label="Toggle navigation"
                aria-expanded={open}
            >
                <div className="w-5 h-0.5 bg-dark mb-1.5" />
                <div className="w-5 h-0.5 bg-dark mb-1.5" />
                <div className="w-3 h-0.5 bg-dark" />
            </button>

            {open && (
                <div
                    onClick={() => setOpen(false)}
                    className="md:hidden absolute left-0 right-0 top-16 border-t border-hairline bg-off-white px-6 py-4 flex flex-col gap-4"
                >
                    {children}
                </div>
            )}
        </>
    );
}
