// The design's footer, lifted out of the landing page so the archive can reuse it
// (issue #23 asks for the same footer, and the Product link is the only way back
// to the landing page from a signed-in screen).
//
// No hooks — renders in a Server Component. Every link here goes somewhere real:
// the design's Privacy / Terms / Docs row was three `href="#"` stubs, and a page
// whose stated purpose is that its claims survive being checked shouldn't ship
// links that go nowhere. (issue #22)

import Link from "next/link";

const REPO_URL = "https://github.com/tmwang7324/DocuLyze";

const LINK_CLASS =
    "font-mono-label text-muted text-[11px] tracking-wider uppercase hover:text-orange-primary transition-colors";

export default function SiteFooter() {
    return (
        <footer className="bg-dark px-6 py-10">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="font-display text-white text-xl font-black uppercase">
                    DocuLyze<span className="text-orange-primary">.</span>
                </div>
                <div className="font-mono-label text-muted text-[11px] tracking-wider">
                    © 2026 DocuLyze
                </div>
                <div className="flex gap-6">
                    {/* "Product" is the landing page itself. It used to point at a
                        dedicated /product route, which existed only because the
                        archive was going to take over "/" — it isn't, so this is
                        just the home route. */}
                    <Link href="/" className={LINK_CLASS}>
                        Product
                    </Link>
                    <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                        Source
                    </a>
                </div>
            </div>
        </footer>
    );
}
