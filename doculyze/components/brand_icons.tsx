// Icon set ported verbatim from the Figma Make export "Dynamic Document
// Retrieval Pages". These are authored inline in the design source (not exported
// raster/vector assets), so the vector data here is the design's own — nothing
// was redrawn by hand.
//
// Colours are baked per file-type on purpose: the type icons double as the
// legend for the archive table's type badges, which use the same hexes via
// documentTypeColor() in components/document_type.ts.

export function IconPDF() {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="4" fill="#F45D22" fillOpacity="0.12" />
            <path d="M8 6h8l6 6v14H8V6z" stroke="#F45D22" strokeWidth="1.5" fill="none" />
            <path d="M16 6v6h6" stroke="#F45D22" strokeWidth="1.5" fill="none" />
            <text x="10" y="21" fontFamily="JetBrains Mono" fontSize="5.5" fontWeight="700" fill="#F45D22">PDF</text>
        </svg>
    );
}

export function IconMD() {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="4" fill="#2563EB" fillOpacity="0.1" />
            <path d="M8 6h8l6 6v14H8V6z" stroke="#2563EB" strokeWidth="1.5" fill="none" />
            <path d="M16 6v6h6" stroke="#2563EB" strokeWidth="1.5" fill="none" />
            <text x="10" y="21" fontFamily="JetBrains Mono" fontSize="5" fontWeight="700" fill="#2563EB">.md</text>
        </svg>
    );
}

export function IconDOCX() {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="4" fill="#16A34A" fillOpacity="0.1" />
            <path d="M8 6h8l6 6v14H8V6z" stroke="#16A34A" strokeWidth="1.5" fill="none" />
            <path d="M16 6v6h6" stroke="#16A34A" strokeWidth="1.5" fill="none" />
            <text x="9" y="21" fontFamily="JetBrains Mono" fontSize="4.5" fontWeight="700" fill="#16A34A">docx</text>
        </svg>
    );
}

export function IconPPTX() {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="4" fill="#DC2626" fillOpacity="0.1" />
            <path d="M8 6h8l6 6v14H8V6z" stroke="#DC2626" strokeWidth="1.5" fill="none" />
            <path d="M16 6v6h6" stroke="#DC2626" strokeWidth="1.5" fill="none" />
            <text x="9" y="21" fontFamily="JetBrains Mono" fontSize="4.5" fontWeight="700" fill="#DC2626">pptx</text>
        </svg>
    );
}

export function IconCode() {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="4" fill="#7C3AED" fillOpacity="0.1" />
            <path d="M10 10l-4 4 4 4M18 10l4 4-4 4" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M15.5 9l-3 10" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

export function IconTXT() {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="4" fill="#0891B2" fillOpacity="0.1" />
            <path d="M8 6h8l6 6v14H8V6z" stroke="#0891B2" strokeWidth="1.5" fill="none" />
            <path d="M16 6v6h6" stroke="#0891B2" strokeWidth="1.5" fill="none" />
            <text x="9" y="21" fontFamily="JetBrains Mono" fontSize="5" fontWeight="700" fill="#0891B2">.txt</text>
        </svg>
    );
}

// The one icon the design doesn't contain. Its accepted-formats grid had six
// cells, one of them a presentation format this system has no parser for; markup
// (html / xml) takes that cell because it genuinely is supported. Rather than
// draw a new glyph, this instantiates the same file-icon template as PDF / MD /
// DOCX / TXT above — identical rounded-rect, page outline and folded corner —
// with a new colour and label. See issue #21.
export function IconMarkup() {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="4" fill="#DB2777" fillOpacity="0.1" />
            <path d="M8 6h8l6 6v14H8V6z" stroke="#DB2777" strokeWidth="1.5" fill="none" />
            <path d="M16 6v6h6" stroke="#DB2777" strokeWidth="1.5" fill="none" />
            <text x="9" y="21" fontFamily="JetBrains Mono" fontSize="4.5" fontWeight="700" fill="#DB2777">html</text>
        </svg>
    );
}

export function IconSearch() {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M14 14l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

export function IconUpload() {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 12V4M10 4L7 7M10 4l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 14v1a2 2 0 002 2h8a2 2 0 002-2v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

export function IconArrow() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3 9h12M11 5l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function IconCheck() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function IconClose() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}
