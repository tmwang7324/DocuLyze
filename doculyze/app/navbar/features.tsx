// Island: the marketing anchors.
//
// The only island that can render nothing at all. Signed in, showMarketing is
// false and this returns null — the entry doesn't dim or disable, it leaves.
//
// Returning null from a Server Component is the cheap version of what the old
// `variant` prop did with a `showMarketing &&` guard in the shell. The guard
// moves down here, which is what lets the shell stop knowing about auth.

import Link from "next/link";
import { getCurrentUid } from "@/_lib/data";
import { MARKETING_ANCHORS, showMarketing } from "./nav_model";
import type { NavLayout } from "./layout_classes";
import { navLinkClass } from "./layout_classes";

export default async function Features({ layout }: { layout: NavLayout }) {
    if (!showMarketing((await getCurrentUid()) !== null)) {
        return null;
    }
    return (
        <>
            {MARKETING_ANCHORS.map(({ href, label }) => (
                <Link key={href} href={href} className={navLinkClass(layout)}>
                    {label}
                </Link>
            ))}
        </>
    );
}
