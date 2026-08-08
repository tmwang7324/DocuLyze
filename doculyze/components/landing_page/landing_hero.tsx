"use client";

// The landing page's hero, and the only part of "/" that needs the browser.
//
// It lives in its own module so the client boundary stops here: the scroll
// listener below is the sole reason any of this page is a client component, and
// everything under the hero (format grid, capabilities, process, CTA, footer) is
// static markup that a server component can render once and never ship as JS.
// See landing_page.tsx for the page itself. (issue #22)

import { useState, useEffect } from "react";
import Link from "next/link";
import { HERO_STATS } from "@/_lib/format_families";
import { IconArrow, IconSearch } from "@/components/brand_icons";

const ROUNDED = "rounded-[0.625rem]"; // matches the design's global button radius

// The hero's right-hand column illustrates the pipeline's stages. The design put
// live-looking counts here ("09 docs", "1,284" chunks) above a heading that read
// "Live index" — a document count dressed as telemetry. The stages are real; the
// numbers were not, so the tiles name what each stage produces instead.
const pipelineStages: [string, string][] = [
    ["PARSE", "Markdown"],
    ["CHUNK", "Sections"],
    ["EMBED", "Vectors"],
];

export default function LandingHero() {
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
        // Hero — a single editorial canvas: document fragments shift as the reader moves.
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
    );
}
