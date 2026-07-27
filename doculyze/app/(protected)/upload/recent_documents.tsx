// The upload screen's right-hand column: the user's most recent documents,
// beside the dropzone so an upload can be seen joining the archive without
// navigating away. (issue #25)
//
// No "use client" — it has no state. Its rows were computed server-side by
// projectArchive() + selectRecent(), the same rows the archive table renders,
// and this file decides only how one of them looks in a narrow column. The
// status labels, format badges and dates are the archive's; nothing here maps a
// lifecycle status or a file extension to anything, which is the point: two
// mappings are how the two screens come to disagree about what a document is
// doing.

import Link from "next/link";
import type { ArchiveRow } from "@/_lib/archive_projection";
import { TONE_CLASS } from "@/components/status_tone";

export default function RecentDocuments({ rows }: { rows: ArchiveRow[] }) {
    return (
        <aside className="border border-hairline bg-white">
            <header className="flex items-baseline justify-between border-b border-dark px-5 py-4">
                <h2 className="font-mono-label text-[10px] tracking-widest uppercase text-muted font-medium">
                    Recent documents
                </h2>
                {rows.length > 0 && (
                    <Link
                        href="/dashboard"
                        className="font-mono-label text-[10px] tracking-wider uppercase text-orange-primary hover:text-orange-deep transition-colors"
                    >
                        View all
                    </Link>
                )}
            </header>

            {rows.length === 0 ? (
                // Distinct from the archive's first-run panel: this one sits next
                // to the thing that fixes it, so it points at the dropzone rather
                // than repeating a call to action the user is already looking at.
                <p className="px-5 py-10 text-center text-sm text-muted">
                    Nothing uploaded yet. Your documents appear here as they land.
                </p>
            ) : (
                <ul>
                    {rows.map((row) => (
                        <li
                            key={row.docId}
                            className="border-b border-hairline last:border-b-0 px-5 py-4 hover:bg-off-white transition-colors"
                        >
                            <div className="flex items-start gap-3">
                                <span
                                    className="mt-0.5 shrink-0 inline-block font-mono-label text-[10px] tracking-wider font-bold px-2 py-1 border"
                                    style={{ color: row.typeColor, borderColor: row.typeColor }}
                                >
                                    {row.type}
                                </span>
                                <div className="min-w-0 flex-1">
                                    {/* truncate, not wrap: the column is narrow and a
                                        three-line title would push the list's real
                                        content — the status — out of sight. */}
                                    <div className="font-display text-base font-bold uppercase text-dark leading-tight truncate">
                                        {row.title}
                                    </div>
                                    <div className="text-muted text-xs mt-0.5 truncate">{row.fileName}</div>
                                    <div className="flex items-center gap-3 mt-2">
                                        <span
                                            className={`inline-flex items-center gap-1.5 text-xs font-medium ${TONE_CLASS[row.statusTone]}`}
                                        >
                                            <span className="w-1.5 h-1.5 bg-current" aria-hidden="true" />
                                            {row.statusLabel}
                                        </span>
                                        <span className="font-mono-label text-[10px] tracking-wider text-muted">
                                            {row.size}
                                        </span>
                                        <span className="font-mono-label text-[10px] tracking-wider text-muted ml-auto whitespace-nowrap">
                                            {row.addedLabel}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </aside>
    );
}
