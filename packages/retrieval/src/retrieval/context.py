"""What text the embedders see for a chunk (contextual headers).

Real documents split a section into several chunks and only the first keeps its `#`
lines, so most chunks do not say which company or section they came from. The heading
path is prepended to the text that is embedded (dense and BM25); the stored `content`
stays the raw chunk, so Sources and citations show what the document says.

This lives here, not in the chunker: the chunker decides chunk boundaries (the
evaluation labels pin it), this decides what is embedded. Ingest and the evaluation
harness both call it, so a measured configuration is the one that ships.
"""

import re

# Stored on every point. Rows written before contextual headers have no
# `embedding_format`, which marks them for a re-embed.
EMBEDDING_FORMAT = "contextual-v1"

_HEADING_KEYS = ("title", "section_title", "subsection_title")


def context_header(metadata: dict, content: str) -> str:
    """The heading path ("Title > Section > Subsection") for a chunk's metadata.

    Not the breadcrumb: no opaque doc id and no token count. A name is dropped when it
    repeats the one before it, or when the chunk text already has it as a `#` heading
    line. Merged chunks carry lists of names; all of them are kept."""
    parts: list[str] = []
    for key in _HEADING_KEYS:
        value = metadata.get(key)
        if not value:
            continue
        for name in value if isinstance(value, list) else [value]:
            if (not parts or name != parts[-1]) and not _has_heading_line(name, content):
                parts.append(name)
    return " > ".join(parts)


def _has_heading_line(name: str, content: str) -> bool:
    pattern = rf"^#{{1,6}}[ \t]+{re.escape(name)}[ \t]*$"
    return bool(re.search(pattern, content, re.MULTILINE | re.IGNORECASE))


def embedding_text(header: str, content: str) -> str:
    """The header, a blank line, then the chunk text; just the text when there is no header."""
    return f"{header}\n\n{content}" if header else content
