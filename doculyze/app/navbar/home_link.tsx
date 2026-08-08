// Island: where "home" goes.
//
// Async Server Component. It reads the session cookie itself rather than being
// told — that is the whole shape of this refactor, and it's what lets the shell
// above it stay free of hooks and of "use client".
//
// getCurrentUid is cache()-wrapped (_lib/data.tsx), so the three islands plus
// their mobile-menu copies share ONE verifySessionCookie call per request. The
// duplication below the fold is free; the round-trip is paid once.

import Link from "next/link";
import { getCurrentUid } from "@/_lib/data";
import { homeEntry } from "./nav_model";
import type { NavLayout } from "./layout_classes";
import { navLinkClass } from "./layout_classes";

export default async function HomeLink({ layout }: { layout: NavLayout }) {
    const { href, label } = homeEntry((await getCurrentUid()) !== null);
    return (
        <Link href={href} className={navLinkClass(layout)}>
            {label}
        </Link>
    );
}
