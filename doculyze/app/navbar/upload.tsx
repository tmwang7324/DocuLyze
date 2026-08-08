// Island: the right-hand cluster — Upload + Sign out, or Sign in + Get started.
//
// Async Server Component, so the branch is settled before any HTML leaves the
// server. That is the property worth protecting here: this is the one island
// whose two states are visibly contradictory, and a client-side version would
// paint "Sign in" to a signed-in user for as long as the auth listener took to
// settle. (providers.tsx:66-88 is the record of that approach; the listener sits
// commented out precisely because of this flash.)
//
// The sign-out control is the exception that proves the rule — it needs onClick
// and the browser SDK, so it's a "use client" leaf nested inside this server
// island rather than a reason to client-ify anything above it.

import Link from "next/link";
import { getCurrentUid } from "@/_lib/data";
import { authProfileLinks } from "./nav_model";
import SignOutButton from "./sign_out_button";
import type { NavLayout } from "./layout_classes";
import { ctaLoudClass, ctaQuietClass, signOutClass } from "./layout_classes";

export default async function AuthProfile({ layout }: { layout: NavLayout }) {
    const authed = (await getCurrentUid()) !== null;

    return (
        <>
            {authProfileLinks(authed).map(({ href, label, emphasis }) => (
                <Link
                    key={href}
                    href={href}
                    className={emphasis === "loud" ? ctaLoudClass(layout) : ctaQuietClass(layout)}
                >
                    {label}
                </Link>
            ))}
            {authed && <SignOutButton className={signOutClass(layout)} />}
        </>
    );
}
