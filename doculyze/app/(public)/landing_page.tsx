"use client";

// The signed-out — and signed-in — landing page at "/". Ported from the Figma
// Make export "Dynamic Document Retrieval Pages". Client component because the
// hero is scroll-driven; nothing on this page reads user data, so it renders the
// same in both auth states and only the nav above it changes. (issue #22)
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

import { useState, useEffect } from "react";
import Link from "next/link";
import SiteFooter from "@/components/site_footer";
import { FORMAT_FAMILIES, HERO_STATS, type FormatFamily } from "@/_lib/format_families";
import {
    IconPDF,
    IconMD,
    IconDOCX,
    IconCode,
    IconTXT,
    IconMarkup,
    IconArrow,
    IconSearch,
} from "@/components/brand_icons";

const ROUNDED = "rounded-[0.625rem]"; // matches the design's global button radius

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

// The hero's right-hand column illustrates the pipeline's stages. The design put
// live-looking counts here ("09 docs", "1,284" chunks) above a heading that read
// "Live index" — a document count dressed as telemetry. The stages are real; the
// numbers were not, so the tiles name what each stage produces instead.
const pipelineStages: [string, string][] = [
    ["PARSE", "Markdown"],
    ["CHUNK", "Sections"],
    ["EMBED", "Vectors"],
];

export default function LandingPage() {
    const [scrollY, setScrollY] = useState(0);

    useEffect(() => {
        const updateScroll = () => setScrollY(window.scrollY);
        updateScroll();
        window.addEventListener("scroll", updateScroll, { passive: true });
        return () => window.removeEventListener("scroll", updateScroll);
    }, []);

    // The hero resolves over the first ~560px of scroll: copy drifts up and
    // fades slightly, the document card lifts and rotates, the pipeline tiles
    // brighten. Everything below is a pure function of this one value.
    const progress = Math.min(scrollY / 560, 1);

    return (
        <div className="min-h-screen bg-off-white">
            {/* Hero — a single editorial canvas: document fragments shift as the reader moves. */}
            <section className="relative overflow-hidden min-h-[760px] border-b border-hairline">
                <div
                    className="absolute inset-0 opacity-[0.45]"
                    style={{
                        backgroundImage:
                            "linear-gradient(#E2DDD8 1px, transparent 1px), linear-gradient(90deg, #E2DDD8 1px, transparent 1px)",
                        backgroundSize: "48px 48px",
                    }}
                />
                <div className="relative max-w-6xl mx-auto px-6 py-16 lg:py-24 grid lg:grid-cols-[1.05fr_.95fr] gap-12 items-center">
                    <div
                        className="relative z-10 max-w-xl"
                        style={{
                            transform: `translateY(${progress * -36}px)`,
                            opacity: 1 - progress * 0.16,
                            transition: "transform 120ms linear, opacity 120ms linear",
                        }}
                    >
                        <div className="font-mono-label text-orange-primary text-xs tracking-widest uppercase mb-6">
                            Document retrieval engine / 01
                        </div>
                        <h1
                            className="font-display text-dark uppercase leading-[0.87] mb-7"
                            style={{ fontSize: "clamp(48px, 9vw, 108px)", fontWeight: 900, letterSpacing: "-0.035em" }}
                        >
                            Find the<br />signal in<br />
                            <span className="text-orange-primary">everything.</span>
                        </h1>
                        {/* Corrected: the design called this "a living retrieval layer",
                            present tense, for a retrieval layer that is ticket #5. What
                            runs today is the ingest half — upload, parse, archive. */}
                        <p className="text-muted text-base leading-relaxed mb-8 max-w-md">
                            Drop in PDFs, Word documents, Markdown, code, or markup. DocuLyze parses
                            every one into structured text and files it in a single archive — the
                            groundwork retrieval is built on. Scroll to watch raw material resolve.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <Link
                                href="/register"
                                className={`flex items-center justify-center gap-2 px-7 py-4 bg-orange-primary text-white font-semibold text-sm uppercase tracking-wider hover:bg-orange-deep transition-colors ${ROUNDED}`}
                            >
                                Start for free <IconArrow />
                            </Link>
                            {/* ROADMAP (#5/#6): no chat route exists. Rendered visibly
                                inactive rather than linking to a 404 — flipping it live
                                is a one-line change when the route lands. */}
                            <span
                                aria-disabled="true"
                                className={`flex items-center justify-center gap-2 px-7 py-4 border border-dark/40 text-dark/40 font-medium text-sm uppercase tracking-wider cursor-not-allowed ${ROUNDED}`}
                                title="Coming soon"
                            >
                                Open chat <IconSearch />
                            </span>
                        </div>
                        {/* Corrected: was "2M+ documents indexed", "<500ms avg retrieval"
                            and a file-format count. All three figures now come from
                            HERO_STATS, which derives them from the enforced limits. */}
                        <div className="flex flex-wrap gap-8 mt-12 pt-6 border-t border-dark/20">
                            {HERO_STATS.map((stat) => (
                                <div key={stat.label}>
                                    <div className="font-display text-2xl text-dark font-bold uppercase">{stat.value}</div>
                                    <div className="font-mono-label text-muted text-[10px] tracking-wider uppercase mt-0.5">
                                        {stat.label}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div
                        className="relative min-h-[470px] flex items-center justify-center"
                        aria-label="Illustration of a document resolving as it is parsed"
                    >
                        <div className="absolute inset-x-0 top-6 font-mono-label text-[10px] tracking-[0.24em] uppercase text-muted flex justify-between">
                            {/* Was "Live index" over invented counts. This panel is an
                                illustration and now says so. */}
                            <span>Pipeline</span>
                            <span>{Math.round(progress * 100).toString().padStart(3, "0")}% resolved</span>
                        </div>
                        <article
                            className="absolute w-[min(100%,390px)] bg-white border border-dark p-6 shadow-[8px_8px_0_#F45D22]"
                            style={{
                                transform: `translate(${progress * 28}px, ${progress * -44}px) rotate(${progress * -2}deg)`,
                                transition: "transform 120ms linear",
                            }}
                        >
                            <div className="flex justify-between items-start border-b border-hairline pb-4 mb-5">
                                <div>
                                    <div className="font-mono-label text-orange-primary text-[10px] tracking-widest">SAMPLE_REPORT.PDF</div>
                                    <div className="font-display text-2xl uppercase text-dark mt-1">Revenue outlook</div>
                                </div>
                                <span className="font-mono-label text-[10px] text-muted">P. 14</span>
                            </div>
                            <div className="space-y-3">
                                <div className="h-2 bg-hairline w-[92%]" />
                                <div className="h-2 bg-hairline w-[76%]" />
                                <div className="h-2 bg-orange-pale w-[88%]" />
                                <div className="h-2 bg-orange-primary w-[54%]" />
                                <div className="h-2 bg-hairline w-[70%]" />
                            </div>
                            {/* Sample document content, not a statement about DocuLyze —
                                the surrounding chrome names it a sample. */}
                            <p className="mt-6 text-sm leading-relaxed text-dark">
                                Enterprise expansion is projected to drive a{" "}
                                <mark className="bg-orange-pale text-dark px-1">23% QoQ increase</mark> in Q3 revenue.
                            </p>
                        </article>
                        <div
                            className="absolute bottom-3 left-0 right-0 grid grid-cols-3 gap-2"
                            style={{ transform: `translateY(${progress * 16}px)`, transition: "transform 120ms linear" }}
                        >
                            {pipelineStages.map(([label, value], index) => (
                                <div
                                    key={label}
                                    className="border border-hairline bg-off-white p-3"
                                    style={{ opacity: 0.55 + progress * (index === 2 ? 0.45 : 0.2) }}
                                >
                                    <div className="font-mono-label text-[9px] text-muted tracking-wider">{label}</div>
                                    <div className="font-display text-base sm:text-lg text-dark mt-1">{value}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

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
