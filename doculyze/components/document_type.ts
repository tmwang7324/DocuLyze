// File-type labelling for the archive table. Neutral module (no "use client" /
// "server-only"): page.tsx derives the label server-side while the archive view
// renders the colour client-side, and both must agree.
//
// The extension map is the design's, not the ingest worker's — it exists to put
// a badge on a row, never to decide what may be uploaded. The real gate is
// `fileSchema` / `uploadClaimSchema` in _lib/fileupload_schema.ts.

const EXTENSION_TO_TYPE: Record<string, string> = {
    pdf: "PDF",
    md: "MD",
    docx: "DOCX",
    pptx: "PPTX",
    txt: "TXT",
    html: "CODE",
    xml: "CODE",
    py: "CODE",
    js: "CODE",
    ts: "CODE",
    tsx: "CODE",
    jsx: "CODE",
    go: "CODE",
    rs: "CODE",
    rb: "CODE",
    java: "CODE",
    cpp: "CODE",
    c: "CODE",
    cs: "CODE",
    json: "CODE",
    yaml: "CODE",
    yml: "CODE",
};

const TYPE_TO_COLOR: Record<string, string> = {
    PDF: "#F45D22",
    MD: "#2563EB",
    DOCX: "#16A34A",
    PPTX: "#DC2626",
    TXT: "#0891B2",
    CODE: "#7C3AED",
};

export function documentType(fileName: string): string {
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    return EXTENSION_TO_TYPE[extension] ?? "TXT";
}

export function documentTypeColor(type: string): string {
    return TYPE_TO_COLOR[type.toUpperCase()] ?? "#6B6B6B";
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
