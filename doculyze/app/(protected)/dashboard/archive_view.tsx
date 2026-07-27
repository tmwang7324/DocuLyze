"use client";

// The archive table. Client component for one reason: the filter and sort
// controls are local UI state. Everything it displays was computed server-side
// by projectArchive() — this file decides how a row looks, never what it says.
// (issue #23)

import { useMemo, useState } from "react";
import Link from "next/link";
import {
    filterAndSort,
    type ArchiveQuery,
    type ArchiveRow,
    type ArchiveStats,
} from "@/_lib/archive_projection";
import { IconSearch, IconUpload } from "@/components/brand_icons";
// The four tones the projection can return, as tokens. No raw hexes here — the
// one colour that isn't a token is the per-family badge, which comes down on the
// row itself because it's data (it matches the file-type icons). Moved to
// components/status_tone.ts in #25, where the upload screen's recent column
// reads the same map rather than declaring a second one.
import { TONE_CLASS } from "@/components/status_tone";

const ROUNDED = "rounded-[0.625rem]";

// Taken from the projection rather than re-declared: the sort vocabulary is its,
// and two copies of a union are how the two drift apart.
type Sort = ArchiveQuery["sort"];

export default function ArchiveView({
    rows,
    stats,
    isEmpty,
}: {
    rows: ArchiveRow[];
    stats: ArchiveStats;
    isEmpty: boolean;
}) {
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<Sort>("recent");

    const visible = useMemo(() => filterAndSort(rows, { query, sort }), [rows, query, sort]);

    return (
        <div className="max-w-6xl mx-auto px-6 py-14">
            <header className="flex flex-col lg:flex-row lg:items-end gap-6 mb-10">
                <div>
                    <div className="font-mono-label text-orange-primary text-xs tracking-widest uppercase mb-3">
                        Archive
                    </div>
                    {/* Weight comes from the real utility, not an inline style —
                        the size and tracking stay inline because clamp() has no
                        utility. (issue #21's font-weight correction) */}
                    <h1
                        className="font-display font-black text-dark uppercase leading-none"
                        style={{ fontSize: "clamp(40px, 6vw, 64px)", letterSpacing: "-0.025em" }}
                    >
                        Your documents
                    </h1>
                </div>

                {/* Computed from the records actually returned — see projectArchive.
                    The prototype hard-coded these three numbers. */}
                <dl className="lg:ml-auto flex gap-8 pt-2">
                    {([
                        ["Documents", String(stats.count)],
                        ["Formats", String(stats.familyCount)],
                        ["Total size", stats.totalSize],
                    ] as [string, string][]).map(([label, value]) => (
                        <div key={label}>
                            <dd className="font-display text-2xl text-dark font-bold uppercase">{value}</dd>
                            <dt className="font-mono-label text-muted text-[10px] tracking-wider uppercase mt-0.5">
                                {label}
                            </dt>
                        </div>
                    ))}
                </dl>
            </header>

            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <label className="relative flex-1">
                    <span className="sr-only">Filter documents by name</span>
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                        <IconSearch />
                    </span>
                    <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Filter by name…"
                        disabled={isEmpty}
                        className={`w-full border-2 border-dark bg-white pl-12 pr-4 py-3 text-sm text-dark placeholder:text-placeholder focus:border-orange-primary focus:outline-none disabled:opacity-40 ${ROUNDED}`}
                    />
                </label>

                <div className="flex items-center gap-px bg-hairline border border-hairline">
                    {([["recent", "Recent"], ["name", "Name"]] as [Sort, string][]).map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setSort(key)}
                            aria-pressed={sort === key}
                            disabled={isEmpty}
                            className={`px-5 py-3 font-mono-label text-[11px] tracking-wider uppercase cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                sort === key
                                    ? "bg-dark text-off-white"
                                    : "bg-off-white text-muted hover:text-dark"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="border border-hairline bg-white overflow-x-auto">
                <table className="w-full min-w-[720px] text-left border-collapse">
                    <thead>
                        <tr className="border-b border-dark">
                            {["Document", "Type", "Size", "Status", "Added"].map((heading) => (
                                <th
                                    key={heading}
                                    scope="col"
                                    className="font-mono-label text-[10px] tracking-widest uppercase text-muted font-medium px-5 py-4"
                                >
                                    {heading}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map((row) => (
                            <tr key={row.docId} className="border-b border-hairline last:border-b-0 hover:bg-off-white transition-colors">
                                <td className="px-5 py-4">
                                    <div className="font-display text-lg font-bold uppercase text-dark leading-tight">
                                        {row.title}
                                    </div>
                                    <div className="text-muted text-sm mt-0.5">{row.fileName}</div>
                                    {/* The real Firestore id. The prototype showed a
                                        decorative one derived from the row index. */}
                                    <div className="font-mono-label text-placeholder text-[10px] tracking-wider mt-1">
                                        {row.docId}
                                    </div>
                                </td>
                                <td className="px-5 py-4">
                                    <span
                                        className="inline-block font-mono-label text-[10px] tracking-wider font-bold px-2 py-1 border"
                                        style={{ color: row.typeColor, borderColor: row.typeColor }}
                                    >
                                        {row.type}
                                    </span>
                                </td>
                                <td className="px-5 py-4 font-mono-label text-xs text-muted whitespace-nowrap">
                                    {row.size}
                                </td>
                                <td className="px-5 py-4">
                                    <span className={`inline-flex items-center gap-2 text-sm font-medium ${TONE_CLASS[row.statusTone]}`}>
                                        <span className="w-1.5 h-1.5 bg-current" aria-hidden="true" />
                                        {row.statusLabel}
                                    </span>
                                </td>
                                <td className="px-5 py-4 font-mono-label text-xs text-muted whitespace-nowrap">
                                    {row.addedLabel}
                                </td>
                            </tr>
                        ))}

                        {/* Two different silences, two different statements. The
                            frame stays in both cases so the screen never reads as
                            broken. */}
                        {isEmpty && (
                            <tr>
                                <td colSpan={5} className="px-5 py-20 text-center">
                                    <div className="font-display text-2xl font-bold uppercase text-dark mb-2">
                                        Nothing here yet
                                    </div>
                                    <p className="text-muted text-sm mb-7 max-w-sm mx-auto">
                                        Upload a document and DocuLyze parses it into structured text — PDF,
                                        Word, Markdown, code, markup, or plain text.
                                    </p>
                                    <Link
                                        href="/upload"
                                        className={`inline-flex items-center gap-2 px-7 py-4 bg-orange-primary text-white font-semibold text-sm uppercase tracking-wider hover:bg-orange-deep transition-colors ${ROUNDED}`}
                                    >
                                        <IconUpload /> Upload a document
                                    </Link>
                                </td>
                            </tr>
                        )}

                        {!isEmpty && visible.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-5 py-16 text-center">
                                    <p className="text-muted text-sm">
                                        No documents match{" "}
                                        <span className="font-mono-label text-dark">“{query.trim()}”</span>.
                                    </p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
