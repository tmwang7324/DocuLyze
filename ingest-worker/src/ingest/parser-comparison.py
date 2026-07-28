
from markitdown import MarkItDown
from ingest.parsers import PARSERS
from pathlib import Path
import os

from huggingface_hub import snapshot_download

from docling.backend.docling_parse_backend import DoclingParseDocumentBackend
from docling.datamodel.base_models import InputFormat
from docling.pipeline.vlm_pipeline import VlmPipeline
from docling.datamodel.pipeline_options import PdfPipelineOptions, PipelineOptions, RapidOcrOptions, VlmConvertOptions, VlmPipelineOptions
from docling.document_converter import (
    ConversionResult,
    DocumentConverter,
    FormatOption,
    InputFormat,
    PdfFormatOption,
)

# from marker.converters.pdf import PdfConverter
# from marker.models import create_model_dict
# from marker.output import text_from_rendered

# md = MarkItDown(enable_plugins=False)
# result = md.convert("C:\\Users\\jw300\\DocuLyze\\ingest-worker\\src\\ingest\\2026q1-alphabet-earnings-release.pdf")
# Path("C:\\Users\\jw300\\DocuLyze\\ingest-worker\\src\\ingest\\experimental_results\\markitdown-output.md").write_text(result.text_content)
# Makes tables nicer in files
# print(result.text_content)
def html_parse(source_html: str, html_output: Path):
# local html parse
    local_html_text = open(source_html, "r", encoding="utf-8").read()
    local_html_parsed_text = PARSERS["html"].parse(local_html_text)
    with open(html_output / "local-parser-output.md", "w", encoding="utf-8") as f:
        f.write(local_html_parsed_text)
    print("Local HTML parser conversion finished.")

def docx_parse(source_docx: str, docx_output: Path):
    # local docx parse
    local_parser_text = PARSERS["docx"].parse(open(source_docx, "rb").read())
    with open(docx_output / "local-parser-output.md", "w", encoding="utf-8") as f:
        f.write(local_parser_text)
    print("Local parser conversion finished.")

def pdf_parse(source_pdf: str, pdf_output: Path):
    ### Pymupdf parse
    pdf_data = open(source_pdf, "rb").read()
    # print(pdf_data)
    pdf_text = PARSERS["pdf"].parse(pdf_data)
    Path(pdf_output / "pdf-text-output.md").write_text(pdf_text)

# print(pdf_text)

def pdf_parse_smol_docling(source_pdf: str, pdf_output: Path):
    pipeline_options = VlmPipelineOptions(
        vlm_options=VlmConvertOptions.from_preset("smoldocling"),
        generate_page_images=True,
    )

    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: FormatOption(
                pipeline_cls=VlmPipeline,
                backend=DoclingParseDocumentBackend,
                pipeline_options=pipeline_options,
            ),
        },
    )

    result = converter.convert(source=source_pdf)
    markdown = result.document.export_to_markdown()
    Path(os.path.join(pdf_output, "docling-output.md")).write_text(markdown, encoding="utf-8")

# def marker_parse(converter: PdfConverter, source: str, output: Path):
    # marker's PdfConverter routes by file extension: PDFs run the layout/OCR
    # pipeline directly, while DOCX (and PPTX/XLSX/EPUB) are first converted to
    # PDF and then parsed. The DOCX path needs weasyprint's native GTK libs
    # (libgobject-2.0-0); install the GTK3 runtime for it to work on Windows.
    # rendered = converter(source)
    # text, _, _ = text_from_rendered(rendered)
    # Path(output / "marker-output.md").write_text(text, encoding="utf-8")
    # print(f"Marker conversion finished: {source}")

def main():
    
    # Source document to convert
    source_docx = "C:\\Users\\jw300\\DocuLyze\\ingest-worker\\src\\ingest\\experimental_results\\2025_AnnualReport.docx"
    source_pdf = "C:\\Users\\jw300\\DocuLyze\\ingest-worker\\src\\ingest\\experimental_results\\Google_Financial_Report.pdf"
    source_html = "C:\\Users\\jw300\\DocuLyze\\ingest-worker\\src\\ingest\\experimental_results\\index.html"
    pdf_output = Path("C:\\Users\\jw300\\DocuLyze\\ingest-worker\\src\\ingest\\experimental_results\\pdf\\")
    docx_output = Path("C:\\Users\\jw300\\DocuLyze\\ingest-worker\\src\\ingest\\experimental_results\\docx\\")
    html_output = Path("C:\\Users\\jw300\\DocuLyze\\ingest-worker\\src\\ingest\\experimental_results\\html\\")
    # pure docling
    # converter = DocumentConverter()
    # doc = converter.convert(source=source).document
    # with open(docx_output / "docling-output.md", "w", encoding="utf-8") as f:
    #     f.write(doc.export_to_markdown())
    # print("Docling conversion finished.")


    
    pdf_parse(source_pdf, pdf_output)
    # pdf_parse_smol_docling(source_pdf, pdf_output)

    # marker (datalab-to/marker) — build the model dict once and reuse across
    # inputs so the surya models aren't loaded into memory per file.
    # marker_converter = PdfConverter(artifact_dict=create_model_dict())
    # marker_parse(marker_converter, source_pdf, pdf_output)
    # marker_parse(marker_converter, source_docx, docx_output)
    ## Downloading RapidOCR models from HuggingFace

    # Download RapidOCR models from HuggingFace
    # print("Downloading RapidOCR models")
    # download_path = snapshot_download(repo_id="SWHL/RapidOCR")

    # # Setup RapidOcrOptions for english detection
    # det_model_path = os.path.join(
    #     download_path, "PP-OCRv4", "en_PP-OCRv3_det_infer.onnx"
    # )
    # rec_model_path = os.path.join(
    #     download_path, "PP-OCRv4", "ch_PP-OCRv4_rec_server_infer.onnx"
    # )
    # cls_model_path = os.path.join(
    #     download_path, "PP-OCRv3", "ch_ppocr_mobile_v2.0_cls_train.onnx"
    # )
    # ocr_options = RapidOcrOptions(
    #     det_model_path=det_model_path,
    #     rec_model_path=rec_model_path,
    #     cls_model_path=cls_model_path,
    # )

    # pipeline_options = PipelineOptions(
    #     ocr_options=ocr_options,
    # )
    # pipeline_options.vlm_options = VlmPipelineOptions(
    #     model_id="ds4sd/SmolDocling-256M-preview",
    #     prompt="Convert this page into Docling."
    # )

    # # Convert the document
    # converter = DocumentConverter(
    #     format_options={
    #         InputFormat.PDF: PdfFormatOption(
    #             pipeline_options=pipeline_options,
    #         ),
    #     },
    # )

    # conversion_result: ConversionResult = converter.convert(source=source_pdf)
    # doc = conversion_result.document
    # md = doc.export_to_markdown()

    # # Create the output filename based on the input filename
    # input_filename = os.path.basename(source_pdf)
    # input_filename_without_extension = os.path.splitext(input_filename)[0]

    # # Create the 'output' directory if it doesn't exist
    # output_directory = "experimental_results"
    # os.makedirs(output_directory, exist_ok=True)

    # output_path = os.path.join(str(pdf_output), "docling-output.md")

    # # Write the Markdown output to the file
    # with open(output_path, 'w', encoding='utf-8') as outfile:
    #     outfile.write(md)

    # print(f"Markdown output written to: {output_path}")

if __name__ == "__main__":
    main()


# print("----------------")



