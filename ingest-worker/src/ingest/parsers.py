"""Parser dispatch + the actual extraction functions (guide Phase 6).

Since issue #11 the parsers normalize to Markdown before chunking (headings and
tables survive), rather than emitting flat text.

The extraction functions run ONLY inside the sandboxed child (parse_entry.py) —
the parent never imports pymupdf/python-docx into its own process for untrusted
bytes. parser_for() is safe anywhere (pure lookup).
"""

import io
import re

from ingest import config
from ingest.precheck import CODE_FAMILY, DOCX_TYPE, TEXT_FAMILY
from abc import ABC, abstractmethod


_CODE_LANG = {
    "application/json": "json",
    "application/javascript": "javascript",
    "application/typescript": "typescript",
    "text/css": "css",
    "application/xml": "xml",
    "application/x-python": "python"
}
assert set(_CODE_LANG.keys()) == CODE_FAMILY


_PARSER_BY_TYPE = {
    "application/pdf": "pdf",
    DOCX_TYPE: "docx",
    "text/html": "html",       # #17: special-cased out of TEXT_FAMILY -> Docling
    "application/xml": "xml",  # #17: special-cased out of the code-fence langs -> Docling
    **{ct: "text" for ct in TEXT_FAMILY if ct != "text/html"},
    **{ct: lang for ct, lang in _CODE_LANG.items() if ct != "application/xml"},
} ## => PARSERS: type -> parser function

class Parser(ABC):
    docling = False  # default; Docling-backed subclasses override to True
    ocr = False      # #18: only the pdf_ocr fallback overrides — carries the OCR budget
    @abstractmethod
    def parse(self, data: bytes) -> str:
        pass


# Canonical contentType -> coding fence language. Keys MUST equal CODE_FAMILY
# (asserted below) so this table can't drift from the precheck allowlist.


def parser_for(content_type: str) -> str:
    """Map a canonical contentType to a parser name. KeyError on unknown —
    an unknown type here means the allowlist and this table drifted."""
    return _PARSER_BY_TYPE[content_type]

class PDFParser(Parser):
    def __init__(self):
        self.docling = False
    def parse(self, data: bytes) -> str:
        # NOTE: PyMuPDF (pymupdf / pymupdf4llm) is AGPL-licensed. Issue #11: this MUST
        # be flagged (and relicensed/replaced) if my project ever ships commercially.
        # Imports stay inside the function — the sandboxed-child pattern (see module
        # docstring): heavy/untrusted-byte libraries never load in the parent.
        # use instead of docling due to better handling of complex PDF layouts.
        import pymupdf
        import pymupdf4llm

        doc = pymupdf.open(stream=data, filetype="pdf")
        # use_ocr=False (#18): pymupdf4llm 1.28 silently runs its OWN RapidOCR on
        # pages its bundled classifier flags — but only when the legacy
        # rapidocr_onnxruntime package is importable, so it fires on the dev venv
        # yet silently no-ops in the container (requirements pin rapidocr 3.x).
        # An environment-dependent, unbudgeted second OCR path inside the 20s
        # fast pass; OCR belongs exclusively to pdf_ocr below (job.py decides).
        return pymupdf4llm.to_markdown(doc, use_ocr=False)


class PDFOCRParser(Parser):
    """#18: OCR fallback for text-less PDFs (Print-to-PDF vector glyphs, scanned
    pages). Never routed by contentType — job.py triggers it as a SECOND sandbox
    pass only when the fast pdf pass came back near-empty (needs_ocr_fallback)."""
    def __init__(self):
        self.docling = True
        self.ocr = True  # parse_timeout_for -> ocr_timeout_s() (~180s), not the 60s docling budget
    def parse(self, data: bytes) -> str:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import (
            PdfPipelineOptions,
            RapidOcrOptions,
        )
        from ingest.docling_convert import convert_to_markdown

        pipeline_options = PdfPipelineOptions(
            artifacts_path=config.docling_artifacts_path(),
            enable_remote_services=False,
            do_ocr=True,
            # force_full_page_ocr: the trigger pages have no text layer, and
            # vector-glyph pages have no bitmap images either — Docling's
            # area-based OCR-rect detection would find nothing to OCR. lang
            # english: docling's chinese default recognition model drops
            # inter-word spaces on Latin-script text (docling #2887).
            # Render scale is fixed by Docling's RapidOCR stage (3x = 216 dpi,
            # at the ~200 dpi target) — deliberately not a config knob.
            ocr_options=RapidOcrOptions(
                lang=["english"],
                force_full_page_ocr=True,
            ),
        )
        return convert_to_markdown(
            data,
            filename="doc.pdf",
            input_format=InputFormat.PDF,
            pipeline_options=pipeline_options,
            # page_range CONVERTS only the first N pages (bounds worst-case OCR
            # runtime, prefetch=1 head-of-line); max_num_pages would instead
            # REJECT longer docs outright.
            convert_kwargs={"page_range": (1, config.ocr_max_pages())},
        )


class DOCXParser(Parser):
    def __init__(self):
        self.docling = True
    # def parse(self, data: bytes) -> str:
    #     # Hand-walk the body in DOCUMENT ORDER so tables survive as Markdown. python-docx's
    #     # `.paragraphs` silently drops tables (the issue #11 bug), and mammoth's markdown
    #     # writer drops them too — so we walk the body element's children directly, wrapping
    #     # each CT_P as a Paragraph and each CT_Tbl as a Table.
    #     from docx import Document
    #     from docx.oxml.table import CT_Tbl
    #     from docx.oxml.text.paragraph import CT_P
    #     from docx.table import Table
    #     from docx.text.paragraph import Paragraph

    #     def _cell_md(cell) -> str:
    #         # Collapse newlines to spaces and escape pipes so a cell can't break the row.
    #         return " ".join(cell.text.split()).replace("|", "\\|")

    #     def _heading_level(style_name: str) -> int:
    #         # "Title" and "Heading 1".."Heading 6" -> `#`-prefix depth; 0 = plain line.
    #         if style_name == "Title":
    #             return 1
    #         if style_name.startswith("Heading "):
    #             try:
    #                 level = int(style_name.split(" ", 1)[1])
    #             except ValueError:
    #                 return 0
    #             return level if 1 <= level <= 6 else 0
    #         return 0

    #     doc = Document(io.BytesIO(data))
    #     lines: list[str] = []
    #     for child in doc.element.body.iterchildren():
    #         if isinstance(child, CT_P):
    #             para = Paragraph(child, doc)
    #             style_name = para.style.name if para.style is not None else ""
    #             level = _heading_level(style_name or "")
    #             lines.append(("#" * level + " " + para.text) if level else para.text)
    #         elif isinstance(child, CT_Tbl):
    #             table = Table(child, doc)
    #             rows = table.rows
    #             if not rows:
    #                 continue
    #             header = rows[0].cells
    #             lines.append("| " + " | ".join(_cell_md(c) for c in header) + " |")
    #             lines.append("| " + " | ".join("---" for _ in header) + " |")
    #             for row in rows[1:]:
    #                 lines.append("| " + " | ".join(_cell_md(c) for c in row.cells) + " |")
    #     return "\n".join(lines)
    
    def parse(self,data: bytes) -> str:
        
        # #16: Docling replaces the hand-walked python-docx extraction. Docling's DOCX
        # backend emits document-order Markdown with tables preserved, which retires
        # the #11 table-drop bug class (python-docx's `.paragraphs` silently dropped
        # tables). Imports stay inside the function — the sandboxed-child pattern.
        from docling.datamodel.base_models import InputFormat
        from ingest.docling_convert import convert_to_markdown
        return convert_to_markdown(data, filename="doc.docx", input_format=InputFormat.DOCX)


class HTMLParser(Parser):
    def __init__(self):
        self.docling = True
    def parse(self, data: bytes) -> str:
        # #17: HTML leaves the bare-text passthrough for Docling's HTML backend so
        # headings/tables become Markdown. Imports inside — sandboxed-child pattern.
        from docling.datamodel.base_models import InputFormat
        from ingest.docling_convert import convert_to_markdown
        return convert_to_markdown(data, filename="doc.html", input_format=InputFormat.HTML)
        

class XMLParser(Parser):
    def __init__(self):
        self.docling = True
    def parse(self, data: bytes) -> str:
        # #17: generic XML is deliberately presented to Docling's HTML backend (note
        # filename="doc.html" + InputFormat.HTML for XML bytes). This looks wrong but
        # is verified against docling 2.114: Docling has NO generic-XML InputFormat
        # (only JATS/USPTO/XBRL variants). A stream named "*.xml" resolves
        # application/xml -> ambiguous formats -> _guess_from_content -> None ->
        # SKIPPED (empty output). Routing through the HTML backend lets BeautifulSoup
        # parse the XML (it emits a harmless XMLParsedAsHTMLWarning to stderr — the
        # parse_entry fd-dance keeps stderr out of the payload) and element text
        # content survives as Markdown. Imports inside — sandboxed-child pattern.
        from docling.datamodel.base_models import InputFormat
        from ingest.docling_convert import convert_to_markdown
        return convert_to_markdown(data, filename="doc.html", input_format=InputFormat.HTML)

class TextParser(Parser):
    def parse(self, data: bytes) -> str:
        return data.decode("utf-8")


    

class CodeParser(Parser):
    def __init__(self, lang: str):
        self.docling = False
        self.lang = lang
    def _fence_code(self, source: str, lang: str) -> str:
        longest, l = 0, 0
        for ch in source:
            if ch == '`':
                l += 1 
            else:
                longest = max(longest, l)
                l = 0
        longest = max(longest, l)
            
        fenced = "`" *  max(3, (longest + 1))
        return f"{fenced}{lang}\n{source}\n{fenced}"

    def parse(self, data: bytes) -> str:
        return self._fence_code(data.decode("utf-8"), self.lang)
# make decorator
# def _fence_code_parser(lang: str) -> callable:
#     def parse(data: bytes) -> str:
#         return _fence_code(data.decode("utf-8"), lang)
#     return _parse
# longest repeating substring leetcode
# def _fence_code(source: str, lang: str) -> str:
#         longest, l = 0, 0
#         for ch in source:
#             if ch == '`':
#                 l += 1 
#             else:
#                 longest = max(longest, l)
#                 l = 0
#         longest = max(longest, l)
            
#         fenced = "`" *  max(3, (longest + 1))
#         return f"{fenced}{lang}\n{source}\n{fenced}"

# Markdown "skeleton" characters — whitespace plus the structural markers the
# fast pdf pass can emit for a page with no real text (page-separator dashes,
# heading/table/blockquote/emphasis punctuation). What's left after stripping
# is the actual embeddable content.
_MD_SKELETON_RE = re.compile(r"[\s|#*_>`\-]+")


def needs_ocr_fallback(text: str) -> bool:
    """#18: True when a fast-pass result is 'no text layer' — fewer than
    pdf_ocr_min_chars() real characters once whitespace and Markdown skeleton
    are stripped. Pure string logic, safe in the parent process; job.py uses it
    to decide the second (pdf_ocr) sandbox pass and to fail docs where even OCR
    recovered nothing embeddable."""
    return len(_MD_SKELETON_RE.sub("", text)) < config.pdf_ocr_min_chars()


def parse_timeout_for(parser_name: str) -> float:
    parser = PARSERS[parser_name]
    if parser.ocr:  # #18: OCR is ~10s/page on CPU — its own, widest budget
        return config.ocr_timeout_s()
    if parser.docling:
        return config.docling_timeout_s()
    return config.parse_timeout_s()

        

PARSERS = {
    "pdf": PDFParser(),
    # pdf_ocr is NOT in _PARSER_BY_TYPE — no contentType routes here; job.py
    # invokes it directly when the fast pdf pass trips needs_ocr_fallback (#18).
    "pdf_ocr": PDFOCRParser(),
    "docx": DOCXParser(),
    "text": TextParser(),
    "html": HTMLParser(),
    "xml": XMLParser(),
    # xml is a Docling parser, not a fence lang — #17: keep it out of the spread
    # so CodeParser("xml") can't overwrite the XMLParser() above.
    **{lang: CodeParser(lang) for lang in set(_CODE_LANG.values()) - {"xml"}},
}


if __name__ == "__main__":
    print(type(_CODE_LANG))