"""Tracer-bullet consistency check for the UDA ingest pipeline.

Run after `python -m ingest.mytests.test_uda_eval --step ingest` to verify
that all pulled questions have corresponding downloaded PDFs, parsed markdown,
and well-formed chunks.

Usage:
    cd ingest-worker
    .venv/Scripts/python -m ingest.mytests.test_uda_consistency
"""

import json
import random
import sys
from pathlib import Path

from ingest.chunker import chunk_markdown

INGEST_WORKER_DIR = Path(__file__).resolve().parents[3]
SOURCE_FILES_DIR = INGEST_WORKER_DIR / "experimental_results" / "source_files"
QUESTIONS_PATH = SOURCE_FILES_DIR.parent / "sample_q&a" / "uda_questions.json"
PDF_ROOT = SOURCE_FILES_DIR / "uda_pdfs"
MD_DIR = SOURCE_FILES_DIR / "converted_md"

MIN_TOKENS = 8
MAX_TOKENS = 2048
WARN_MIN_TOKENS = 64
SPOT_CHECK_SAMPLE = 5
RANDOM_SEED = 20260926

ARCHIVE_STEMS = {
    "tat_docs.zip": "tat_docs",
    "fin_docs.zip": "fin_docs",
    "paper_docs.zip": "paper_docs",
    "wiki_feta_docs.zip": "wiki_feta_docs",
    "wiki_nq_docs.zip": "wiki_nq_docs",
}


def load_unique_documents(questions_path: Path) -> dict[str, dict]:
    """Return {source_document: {"archive": ..., "doc_name": ...}} from the Q&A file."""
    data = json.loads(questions_path.read_text(encoding="utf-8"))
    docs: dict[str, dict] = {}
    for q in data["questions"]:
        source_id = q["source_document"]
        if source_id in docs:
            continue
        archive, _, doc_name = source_id.partition(":")
        docs[source_id] = {"archive": archive, "doc_name": doc_name}
    return docs


def check_document(source_id: str, archive: str, doc_name: str) -> dict:
    """Run the PDF/markdown/chunk checks for one document; return a result row."""
    row = {
        "source_id": source_id,
        "doc_name": doc_name,
        "pdf_exists": False,
        "md_exists": False,
        "chunk_count": 0,
        "min_tokens": None,
        "max_tokens": None,
        "failures": [],
    }

    archive_stem = ARCHIVE_STEMS.get(archive)
    if archive_stem is None:
        row["failures"].append(f"unknown archive '{archive}' (not in ARCHIVE_STEMS)")
        return row

    pdf_path = PDF_ROOT / archive_stem / f"{doc_name}.pdf"
    row["pdf_exists"] = pdf_path.exists()
    if not row["pdf_exists"]:
        row["failures"].append(f"missing PDF: {pdf_path}")

    md_path = MD_DIR / f"{doc_name}.md"
    row["md_exists"] = md_path.exists()
    if not row["md_exists"]:
        row["failures"].append(f"missing markdown: {md_path}")
        return row

    markdown = md_path.read_text(encoding="utf-8")
    if not markdown.strip():
        row["failures"].append("markdown file is empty")
        return row

    chunks = chunk_markdown(markdown)
    row["chunk_count"] = len(chunks)
    if not chunks:
        row["failures"].append("chunker produced zero chunks")
        return row

    token_counts = [c.tokens for c in chunks]
    row["min_tokens"] = min(token_counts)
    row["max_tokens"] = max(token_counts)
    warnings = []
    for c in chunks:
        if c.tokens > MAX_TOKENS:
            row["failures"].append(
                f"chunk {c.metadata.get('chunk_index')} has {c.tokens} tokens (max {MAX_TOKENS})"
            )
        elif c.tokens < MIN_TOKENS:
            row["failures"].append(
                f"chunk {c.metadata.get('chunk_index')} has {c.tokens} tokens (min {MIN_TOKENS})"
            )
        elif c.tokens < WARN_MIN_TOKENS:
            warnings.append(c.metadata.get("chunk_index"))
        if not c.content.strip():
            row["failures"].append(f"chunk {c.metadata.get('chunk_index')} is empty/whitespace")
    if warnings:
        row.setdefault("warnings", []).append(f"{len(warnings)} chunk(s) below {WARN_MIN_TOKENS} tokens")

    return row


def spot_check(rows: list[dict], rng: random.Random) -> list[str]:
    """Sample a few passing docs and sanity-print a snippet of one of their chunks."""
    candidates = [r for r in rows if r["chunk_count"] > 0]
    sample = rng.sample(candidates, min(SPOT_CHECK_SAMPLE, len(candidates)))
    notes = []
    for row in sample:
        md_path = MD_DIR / f"{row['doc_name']}.md"
        markdown = md_path.read_text(encoding="utf-8")
        chunks = chunk_markdown(markdown)
        pick = rng.choice(chunks)
        snippet = pick.content.strip().replace("\n", " ")[:80]
        ok = bool(pick.content.strip())
        notes.append(f"{'OK  ' if ok else 'FAIL'} {row['doc_name']} chunk {pick.metadata.get('chunk_index')}: {snippet!r}")
    return notes


def main() -> int:
    if not QUESTIONS_PATH.exists():
        print(f"FATAL: questions file not found: {QUESTIONS_PATH}")
        print("Run `python -m ingest.mytests.test_uda_eval --step download` first.")
        return 1

    docs = load_unique_documents(QUESTIONS_PATH)
    rng = random.Random(RANDOM_SEED)

    rows = [
        check_document(source_id, info["archive"], info["doc_name"])
        for source_id, info in sorted(docs.items())
    ]

    print(f"\n{'doc_name':<50} {'PDF':<5} {'MD':<5} {'chunks':<7} {'min_tok':<8} {'max_tok':<8}")
    print("-" * 90)
    for row in rows:
        print(
            f"{row['doc_name'][:49]:<50} "
            f"{'yes' if row['pdf_exists'] else 'NO':<5} "
            f"{'yes' if row['md_exists'] else 'NO':<5} "
            f"{row['chunk_count']:<7} "
            f"{str(row['min_tokens']):<8} "
            f"{str(row['max_tokens']):<8}"
        )

    print("\nSpot-check (random chunks from random docs):")
    for note in spot_check(rows, rng):
        print(f"  {note}")

    total = len(rows)
    passed = sum(1 for r in rows if not r["failures"])
    all_chunks = sum(r["chunk_count"] for r in rows)
    all_mins = [r["min_tokens"] for r in rows if r["min_tokens"] is not None]
    all_maxs = [r["max_tokens"] for r in rows if r["max_tokens"] is not None]

    print(f"\n{'=' * 60}\nSUMMARY\n{'=' * 60}")
    print(f"Documents checked: {total}")
    print(f"Passed:            {passed}/{total} ({100 * passed / total:.1f}%)" if total else "Passed: 0/0")
    print(f"Total chunks:      {all_chunks}")
    if all_mins and all_maxs:
        print(f"Token range seen:  {min(all_mins)}-{max(all_maxs)} (expected {MIN_TOKENS}-{MAX_TOKENS})")

    failed_rows = [r for r in rows if r["failures"]]
    if failed_rows:
        print(f"\n{'!' * 60}\nFAILURES ({len(failed_rows)} document(s))\n{'!' * 60}")
        for row in failed_rows:
            print(f"\n  {row['source_id']}:")
            for failure in row["failures"]:
                print(f"    - {failure}")
        return 1

    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
