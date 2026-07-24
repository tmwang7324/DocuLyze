"""Offline Docling converter factory (ticket #15 — Docling groundwork).

This module is the single seam through which every Docling-backed parser (docx,
html, xml — tickets #16/#17 — and the PDF-OCR fallback — ticket #18) builds a
DocumentConverter and runs a conversion. It exists so those callers share one
offline, restricted-format, no-remote-services configuration instead of each
hand-rolling a converter.

Import-safety (the sandboxed-child pattern, see parsers.py): ALL docling imports
live INSIDE the functions below. Importing this module must stay light — the
parent process resolves parser NAMES and timeouts without dragging docling's
heavy backend/model machinery in; docling only loads inside the sandbox child
that actually converts untrusted bytes.

Offline guarantees:
  - `allowed_formats` is pinned to the single requested InputFormat, so a
    mis-typed stream can't silently route through an unexpected backend.
  - `artifacts_path` comes from `config.docling_artifacts_path()` (the container
    bakes models into /opt/docling-models); None falls back to Docling's cache.
  - `enable_remote_services=False` is set explicitly, so any config that would
    reach out to a remote service raises loudly instead of phoning home.
"""

import io

from ingest import config


def _default_pipeline_options(input_format):
    """Pipeline options wired for offline use. PDF gets PdfPipelineOptions
    (the StandardPdfPipeline expects it and the OCR fallback extends it in #18);
    the SimplePipeline formats (docx/html/xml) need no models, so the plain
    ConvertPipelineOptions — the type SimplePipeline expects, carrying
    artifacts_path + the remote-services lock — is enough."""
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        ConvertPipelineOptions,
        PdfPipelineOptions,
    )

    cls = PdfPipelineOptions if input_format == InputFormat.PDF else ConvertPipelineOptions
    return cls(
        artifacts_path=config.docling_artifacts_path(),
        enable_remote_services=False,
    )


def _format_option(input_format, pipeline_options):
    """Select the format-specific FormatOption (carrying the right backend +
    pipeline_cls defaults) and inject the pipeline options."""
    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import (
        HTMLFormatOption,
        PdfFormatOption,
        WordFormatOption,
    )

    by_format = {
        InputFormat.PDF: PdfFormatOption,
        InputFormat.DOCX: WordFormatOption,
        InputFormat.HTML: HTMLFormatOption,
    }
    return by_format[input_format](pipeline_options=pipeline_options)


def make_converter(input_format, *, pipeline_options=None):
    """Build a single-format, offline DocumentConverter for `input_format`.

    Callers that need custom pipeline options (e.g. the PDF-OCR fallback in #18,
    which supplies a PdfPipelineOptions with do_ocr + RapidOcrOptions) pass them
    via `pipeline_options`; otherwise the offline default is used. `allowed_formats`
    is restricted to exactly the requested format."""
    from docling.document_converter import DocumentConverter

    if pipeline_options is None:
        pipeline_options = _default_pipeline_options(input_format)
    fmt_option = _format_option(input_format, pipeline_options)
    return DocumentConverter(
        allowed_formats=[input_format],
        format_options={input_format: fmt_option},
    )


def convert_to_markdown(
    data: bytes,
    *,
    filename: str,
    input_format,
    pipeline_options=None,
    convert_kwargs=None,
) -> str:
    """Convert in-memory `data` to Markdown via Docling, offline.

    The bytes are wrapped in a DocumentStream named `filename` (Docling never
    touches the filesystem for the input). `convert_kwargs` is forwarded to
    `DocumentConverter.convert` for callers that need e.g. `max_num_pages` /
    `page_range` (the PDF-OCR fallback, #18). Returns normalized Markdown."""
    from docling_core.types.io import DocumentStream

    converter = make_converter(input_format, pipeline_options=pipeline_options)
    source = DocumentStream(name=filename, stream=io.BytesIO(data))
    result = converter.convert(source, **(convert_kwargs or {}))
    return result.document.export_to_markdown()
