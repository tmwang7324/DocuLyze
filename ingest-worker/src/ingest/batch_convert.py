"""Walk an input directory, parse each supported file to markdown, and split into chunks."""

import sys
from pathlib import Path

from ingest.parsers import PARSERS, parser_for
from ingest.chunker import chunk_markdown

EXT_TO_TYPE = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".html": "text/html",
    ".css": "text/css",
    ".json": "application/json",
    ".js": "application/javascript",
    ".ts": "application/typescript",
    ".xml": "application/xml",
    ".py": "application/x-python",
}


def ext_to_content_type(name: str) -> str | None:
    suffix = Path(name).suffix.lower()
    return EXT_TO_TYPE.get(suffix)


def parse_and_split(src: Path, dest: Path) -> list:
    mime = ext_to_content_type(src.name)
    if not mime:
        print(f"  ignored (unrecognized extension): {src.name}")
        return []

    try:
        key = parser_for(mime)
    except KeyError:
        print(f"  ignored (no parser registered for {mime}): {src.name}")
        return []

    raw = src.read_bytes()
    md_text = PARSERS[key].parse(raw)

    if not md_text.strip():
        print(f"  ignored (parser returned nothing): {src.name}")
        return []

    md_file = dest / (src.stem + ".md")
    md_file.write_text(md_text, encoding="utf-8")

    pieces = chunk_markdown(md_text)

    piece_dir = dest / src.stem
    piece_dir.mkdir(exist_ok=True)
    for piece in pieces:
        breadcrumb = f"<!-- {piece.breadcrumb()} -->\n\n" if piece.breadcrumb() else ""
        (piece_dir / f"chunk_{piece.metadata['chunk_index']:03d}.md").write_text(
            breadcrumb + piece.content, encoding="utf-8"
        )

    return pieces


def main():
    if len(sys.argv) < 2:
        print(f"Usage: python -m ingest.batch_convert <input_dir> [output_dir]")
        sys.exit(1)

    src_dir = Path(sys.argv[1])
    dest_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else src_dir / "output"
    dest_dir.mkdir(parents=True, exist_ok=True)

    entries = sorted(f for f in src_dir.iterdir() if f.is_file())
    if not entries:
        print(f"No files in {src_dir}")
        sys.exit(1)

    chunk_count = 0
    for entry in entries:
        print(f"Processing: {entry.name}")
        pieces = parse_and_split(entry, dest_dir)
        if pieces:
            token_sum = sum(p.tokens for p in pieces)
            print(f"  {len(pieces)} chunks, {token_sum} tokens")
            chunk_count += len(pieces)

    print(f"\nFinished: {len(entries)} files, {chunk_count} chunks")


if __name__ == "__main__":
    main()
