"""Table-aware markdown chunking for the RAG pipeline.

Two-pass split: MarkdownHeaderTextSplitter by #/##/### headers, then
RecursiveCharacterTextSplitter (tiktoken cl100k_base) for oversized prose.
Pipe-delimited tables are kept atomic with their captions and footnotes.
"""

import re

import tiktoken
from langchain_text_splitters import (
    MarkdownHeaderTextSplitter,
    RecursiveCharacterTextSplitter,
)


class Chunk:
    def __init__(self, text: str, metadata: dict, index: int, source: str):
        self.content: str = text
        self.metadata = {"chunk_index": index, "source": source, **metadata}
        self.tokens = self.token_count()

    def breadcrumb(self):
        parts = []
        for k in ["title", "source", "section_title", "subsection_title"]:
            v = self.metadata.get(k)
            if v:
                if isinstance(v, list):
                    parts.extend(v)
                else:
                    parts.append(v)
        parts.append(f"tokens: {self.tokens}")
        return " > ".join(parts)

    def token_count(self):
        tokenizer = tiktoken.get_encoding("cl100k_base")
        return len(tokenizer.encode(self.content))

    def append(self, text, metadata: dict):
        if self.content:
            self.content += "\n\n" + text
        else:
            self.content = text
        for key, value in metadata.items():
            existing = self.metadata.get(key)
            if existing is None:
                self.metadata[key] = value
            elif existing != value:
                if isinstance(existing, list):
                    if value not in existing:
                        existing.append(value)
                else:
                    self.metadata[key] = [existing, value]
        self.tokens = self.token_count()


_TABLE_ROWS_RE = re.compile(
    r'(?P<rows>(?:^\|[^\n]+\n?)+)'
    r'(?:\n*(?P<notes>(?:^>[^\n]*\n?)*))?',
    re.MULTILINE,
)


def _split_around_tables(text: str) -> list[tuple[str, bool]]:
    """Split text into (content, is_table_block) pairs.

    Each table block includes the caption paragraph immediately before the
    pipe-delimited rows, any trailing blockquote footnotes, and a short
    below-table caption line if present.
    """
    parts: list[tuple[str, bool]] = []
    matches = list(_TABLE_ROWS_RE.finditer(text))
    last = 0
    for idx, m in enumerate(matches):
        before = text[last:m.start()]
        if '\n\n' in before:
            halves = before.rsplit('\n\n', 1)
        else:
            # No blank lines: MarkdownHeaderTextSplitter strips them from its output,
            # so paragraphs can't be found. Caption = the last line, plus a heading
            # line ('#' or a bold '**' title) if one sits in the two lines above it,
            # so a table keeps its title without swallowing all the prose since the
            # previous table.
            lines = before.rstrip('\n').split('\n')
            start = len(lines) - 1
            for j in range(max(len(lines) - 3, 0), len(lines) - 1):
                if lines[j].lstrip().startswith(('#', '**')):
                    start = j
                    break
            halves = ['\n'.join(lines[:start]), '\n'.join(lines[start:])] if start > 0 else ['\n'.join(lines)]
        prose =halves[0].strip() if len(halves) == 2 else ''
        caption = (halves[-1] if len(halves) == 2 else halves[0]).strip()
        if prose:
            parts.append((prose, False))

        below_caption = ''
        end = m.end()
        next_boundary = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        gap = text[end:next_boundary]
        stripped_gap = gap.lstrip('\n')
        leading = len(gap) - len(stripped_gap)
        if stripped_gap:
            first_para = stripped_gap.split('\n\n', 1)[0]
            first_stripped = first_para.strip()
            # A lone line sitting between two tables is the next table's caption,
            # not this one's; headings and ':' lead-ins also introduce what follows.
            is_next_caption = (
                idx + 1 < len(matches) and not stripped_gap[len(first_para):].strip()
            ) or first_stripped.startswith('#') or first_stripped.endswith(':')
            if first_stripped and '\n' not in first_stripped and not first_stripped.startswith('|') and not first_stripped.startswith('>') and not is_next_caption:
                below_caption = first_stripped
                end += leading + len(first_para)

        block = '\n\n'.join(
            s for s in [caption, m.group('rows').strip(), (m.group('notes') or '').strip(), below_caption] if s
        )
        parts.append((block, True))
        last = end
    tail = text[last:].strip()
    if tail:
        parts.append((tail, False))
    return parts if parts else [(text, False)]


def chunk_markdown(
        markdown_text: str,
        max_tokens: int = 1024,
        min_tokens: int = 64,
        chunk_overlap: int = 64,
        source: str = ""
) -> list[Chunk]:
    tokenizer = tiktoken.get_encoding("cl100k_base")
    text = markdown_text.replace("<!-- page_break -->", "\n\n")
    text = text.replace('ï¿½', "'")
    text = text.replace('�', "'")

    if not text.strip():
        return []

    header_splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=[("#", "title"), ("##", "section_title"), ("###", "subsection_title")],
        strip_headers=False,
    )

    text_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        chunk_size=max_tokens,
        chunk_overlap=chunk_overlap,
        encoding_name="cl100k_base",
    )

    chunks = []
    i = 0
    for s in header_splitter.split_text(text):
        content = s.page_content.strip()
        if not content:
            continue
        token_count = len(tokenizer.encode(content))
        has_table = bool(re.search(r'^\|(?:\s*:?-+:?\s*\|)+\s*$', content, re.MULTILINE))
        if has_table:
            for segment, is_table in _split_around_tables(content):
                seg_tokens = len(tokenizer.encode(segment))
                if is_table or seg_tokens <= max_tokens:
                    chunks.append(Chunk(segment, s.metadata, i, source))
                else:
                    for sub in text_splitter.create_documents(
                        [segment], metadatas=[s.metadata]):
                        chunks.append(Chunk(sub.page_content, s.metadata, i, source))
        elif token_count > max_tokens:
            for sub in text_splitter.create_documents(
                [content], metadatas=[s.metadata]):
                chunks.append(Chunk(sub.page_content, s.metadata, i, source))
        else:
            chunks.append(Chunk(content, s.metadata, i, source))
        i += 1

    chunks = merged_chunks(chunks, max_tokens, min_tokens)
    return chunks


def merged_chunks(chunks: list[Chunk], max_tokens: int, min_tokens: int) -> list[Chunk]:
    if not chunks:
        return chunks
    merged = [chunks[0]]
    for i in range(1, len(chunks)):
        prev = merged[-1]
        chunk = chunks[i]
        if (prev.tokens < min_tokens or chunk.tokens < min_tokens) and prev.tokens + chunk.tokens <= max_tokens:
            prev.append(chunk.content, chunk.metadata)
        else:
            merged.append(chunk)
    for i, chunk in enumerate(merged):
        chunk.metadata["chunk_index"] = i
    return merged
