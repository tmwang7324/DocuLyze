// The signed-out — and signed-in — landing page at "/". Ported from the Figma
// Make export "Dynamic Document Retrieval Pages". Nothing on this page reads user
// data, so it renders the same in both auth states and only the nav above it
// changes. (issue #22)
//
// Server component: the scroll-driven hero is the only part that needs the
// browser, and it lives behind its own client boundary in landing_hero.tsx.
// Everything in this file is static markup that never reaches the JS bundle.
//
// COPY RULE (spec #20). Two classes of claim, treated differently:
//
//   Kept — capability copy describing features on the roadmap (semantic search,
//   citations, embedding, enrichment). Those tickets ship before this deploys, and
//   the deployment gate is the launch checklist, not this file.
//
//   Corrected — anything shipping a feature cannot make true. The design asserted
//   2M+ documents indexed, sub-500ms retrieval, thousands of customers, a live
//   index with document and chunk counts, and a PPTX parser that does not exist.
//   Those are gone. The hero headline stays: it is a vision statement, not a
//   factual claim, and it is the most typographically load-bearing element here.
//
// The format grid and the hero figures are not authored in this file — they come
// from _lib/format_families.ts, which tests/landing/format_families.test.ts pins
// against the upload allowlist. That is what keeps a PPTX cell from reappearing.

import Link from "next/link";
import LandingHero from "./landing_hero";
import SiteFooter from "@/components/site_footer";
import { FORMAT_FAMILIES, type FormatFamily } from "@/_lib/format_families";
import {
    IconPDF,
    IconMD,
    IconDOCX,
    IconCode,
    IconTXT,
    IconMarkup,
} from "@/components/brand_icons";

// Matches the design's global button radius. Mirrored in landing_hero.tsx rather
// than imported from here — that file is a client module and must not pull a
// server component into its graph to get one string.
const ROUNDED = "rounded-[0.625rem]";

// One icon per family key. Exhaustive by type: adding a family without an icon is
// a compile error rather than a blank grid cell.
const FAMILY_ICONS: Record<FormatFamily["key"], React.ReactNode> = {
    pdf: <IconPDF />,
    docx: <IconDOCX />,
    markdown: <IconMD />,
    text: <IconTXT />,
    code: <IconCode />,
    markup: <IconMarkup />,
};

const features = [
    {
        num: "01",
        // ROADMAP (#5, #6): retrieval ships with the RAG pipeline.
        title: "Semantic search across all formats",
        body: "Ask natural language questions and retrieve precise passages from any document in your vault — regardless of format.",
    },
    {
        num: "02",
        // Half-shipped: upload does enqueue and parse automatically today; the
        // vectorize half is #5.
        title: "Indexing on upload",
        body: "Documents are parsed, chunked, and vectorized the moment they land. No manual triggers, no separate import step.",
    },
    {
        num: "03",
        // ROADMAP (#6): chunks don't carry page/line anchors yet.
        title: "Precision retrieval with citations",
        body: "Every result links back to the section it came from — so you can verify a passage instead of taking it on trust.",
    },
    {
        num: "04",
        // ROADMAP (#7: NER / summary / sentiment). This card replaces the design's
        // "Role-based access controls", which had no ticket and contradicted a
        // decision already recorded in CONTEXT.md: the vector store's tenant
        // gateway injects the caller's uid precisely so that no call site can read
        // across users. Sharing is cross-user reading — delivering that card would
        // have meant reopening the invariant, not building a feature.
        title: "Enrichment on every document",
        body: "Summaries, named entities, and sentiment are extracted alongside the text, so a document tells you what it is before you read it.",
    },
];

const steps = [
    {
        step: "01",
        title: "Upload your documents",
        body: "Drag and drop PDFs, Word documents, Markdown, source code, markup, or plain text. DocuLyze handles the rest.",
    },
    {
        step: "02",
        title: "DocuLyze indexes everything",
        // The design promised this "within seconds". A parse budget is published
        // in the hero; a speed promise is not something shipping can make true.
        body: "Your content is parsed into structured Markdown and embedded with vector models — automatically, as soon as the bytes land.",
    },
    {
        step: "03",
        title: "Retrieve with precision",
        body: "Ask a question in plain language. Get the exact passage, table, or code snippet you need.",
    },
];

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-off-white">
            <LandingHero />

            {/* Supported formats — the six families, straight from the allowlist. */}
            <section id="features" className="py-20 px-6 border-t border-hairline scroll-mt-16">
                <div className="max-w-6xl mx-auto">
                    <div className="flex flex-col lg:flex-row lg:items-end gap-6 mb-14">
                        <div>
                            <div className="font-mono-label text-orange-primary text-xs tracking-widest uppercase mb-3">Supported formats</div>
                            <h2
                                className="font-display uppercase leading-tight text-dark"
                                style={{ fontSize: "clamp(36px, 5vw, 56px)", fontWeight: 800, letterSpacing: "-0.02em" }}
                            >
                                Every format.<br />One search.
                            </h2>
                        </div>
                        <p className="lg:ml-auto lg:max-w-xs text-muted text-sm leading-relaxed">
                            Six families in, one archive out. DocuLyze converts each of them to
                            structured Markdown on the way in — no conversion step of your own.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-hairline border border-hairline">
                        {FORMAT_FAMILIES.map((family) => (
                            <div
                                key={family.key}
                                className="bg-off-white flex flex-col items-center justify-center py-10 px-4 hover:bg-orange-pale transition-colors group"
                            >
                                <div className="mb-3 group-hover:scale-110 transition-transform">{FAMILY_ICONS[family.key]}</div>
                                <div className="font-display text-dark text-lg font-bold uppercase">{family.label}</div>
                                <div className="font-mono-label text-muted text-[10px] tracking-wider text-center mt-1">{family.blurb}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Capabilities */}
            <section className="py-20 px-6 bg-dark">
                <div className="max-w-6xl mx-auto">
                    <div className="font-mono-label text-orange-primary text-xs tracking-widest uppercase mb-4">Capabilities</div>
                    <h2
                        className="font-display text-off-white uppercase leading-tight mb-16"
                        style={{ fontSize: "clamp(36px, 5vw, 52px)", fontWeight: 800 }}
                    >
                        Built for precision<br />retrieval at scale.
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-dark-3 border border-dark-3">
                        {features.map((feature) => (
                            <div key={feature.num} className="bg-dark p-8 hover:bg-dark-2 transition-colors">
                                <div className="font-mono-label text-orange-primary text-[11px] tracking-widest mb-5">{feature.num}</div>
                                <h3 className="font-display text-off-white text-2xl font-bold uppercase leading-tight mb-3">{feature.title}</h3>
                                <p className="text-muted text-sm leading-relaxed">{feature.body}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* How it works */}
            <section id="how" className="py-20 px-6 border-b border-hairline scroll-mt-16">
                <div className="max-w-6xl mx-auto">
                    <div className="font-mono-label text-orange-primary text-xs tracking-widest uppercase mb-4">Process</div>
                    <h2
                        className="font-display text-dark uppercase leading-tight mb-16"
                        style={{ fontSize: "clamp(36px, 5vw, 52px)", fontWeight: 800 }}
                    >
                        Three steps.<br />That&apos;s all.
                    </h2>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {steps.map((step, index) => (
                            <div key={step.step} className="relative">
                                {index < steps.length - 1 && (
                                    <div className="hidden lg:block absolute top-6 left-full w-full h-px bg-hairline -translate-x-4" />
                                )}
                                <div
                                    className="font-display text-[80px] text-orange-primary leading-none opacity-20 mb-2"
                                    style={{ fontWeight: 900 }}
                                >
                                    {step.step}
                                </div>
                                <h3 className="font-display text-xl font-bold uppercase text-dark mb-2">{step.title}</h3>
                                <p className="text-muted text-sm leading-relaxed">{step.body}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section className="bg-orange-primary py-20 px-6">
                <div className="max-w-3xl mx-auto text-center">
                    <h2
                        className="font-display text-white uppercase leading-tight mb-4"
                        style={{ fontSize: "clamp(40px, 6vw, 72px)", fontWeight: 900 }}
                    >
                        Ready to find anything?
                    </h2>
                    {/* Corrected: the design opened with "Join thousands of teams". */}
                    <p className="text-white/70 text-base mb-8 max-w-md mx-auto">
                        Create an account and put your first document in. Free to start.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <Link
                            href="/register"
                            className={`px-8 py-4 bg-white text-orange-primary font-bold text-sm uppercase tracking-wider hover:bg-orange-pale transition-colors ${ROUNDED}`}
                        >
                            Create free account
                        </Link>
                        <Link
                            href="/login"
                            className={`px-8 py-4 border border-white/40 text-white font-medium text-sm uppercase tracking-wider hover:bg-white/10 transition-colors ${ROUNDED}`}
                        >
                            Sign in
                        </Link>
                    </div>
                </div>
            </section>

            <SiteFooter />
        </div>
    );
}
