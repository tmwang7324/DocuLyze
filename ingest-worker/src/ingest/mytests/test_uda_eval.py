"""UDA benchmark download scaffold for the retrieval evaluation pipeline.

Run from ``ingest-worker`` with ``python -m ingest.mytests.test_uda_eval
--step download``. The download step caches only the small Q&A parquet shards;
source PDFs are represented by archive/member identifiers for later ingestion.
The 25-query set is stratified by question type: 17 benchmark questions sampled
per fixed (subdataset, type) quota cell, plus 8 hand-authoring placeholders.
"""

import argparse
import json
import math
import random
import re
import zipfile
from collections import Counter
from datetime import date
from pathlib import Path


INGEST_WORKER_DIR = Path(__file__).resolve().parents[3]
SRC_DIR = INGEST_WORKER_DIR / "experimental_results" / "source_files"
CACHE_DIR = SRC_DIR / "uda_qa_cache"
QUESTIONS_PATH = SRC_DIR.parent / "sample_q&a" / "uda_questions.json"
RANDOM_SEED = 20260926

# Where source PDFs and their parsed markdown are cached (ticket #02, phases 1-2).
UDA_PDF_DIR = SRC_DIR / "uda_pdfs"
UDA_MD_DIR = SRC_DIR / "converted_md"
COLLECTION_NAME = "uda_eval_chunks"
NOISE_DOCS_PER_SIGNAL_DOC = 0.5  # noise docs = ceil(signal docs * this), per subdataset
EMBED_BATCH_SIZE = 50  # chunks per Voyage API call
# A fixed tenant id for the eval corpus — not a real DocuLyze user, just the
# userId partition the tenant-gateway payload convention expects.
UDA_UID = "uda-eval"

# Naming convention inside each HF UDA-QA zip archive (source_id: dataset:doc_name).
ARCHIVE_PDF_PATH = {
    "tat_docs.zip": "tat_docs",
    "fin_docs.zip": "fin_docs",
    "paper_docs.zip": "paper_docs",
    "wiki_feta_docs.zip": "wiki_feta_docs/pdfs",
    "wiki_nq_docs.zip": "wiki_nq_docs/pdfs",
}

# QA directory, public dataset label, and source archive containing its PDFs.
DATASETS = {
    "tat": ("tathybrid", "tat_docs.zip"),
    "paper_text": ("papertext", "paper_docs.zip"),
    "paper_tab": ("papertab", "paper_docs.zip"),
}

# Fixed benchmark quota cells: (dataset_key, type, subkind, n). Subkind splits
# the tat numerical slots into 3 arithmetic + 1 count; None elsewhere.
QUOTA_CELLS = [
    ("tat", "factual_lookup", None, 2),
    ("tat", "numerical", "arithmetic", 3),
    ("tat", "numerical", "count", 1),
    ("tat", "comparison", None, 2),
    ("tat", "broad_synthesis", None, 1),
    ("paper_text", "factual_lookup", None, 1),
    ("paper_text", "reasoning", None, 2),
    ("paper_text", "broad_synthesis", None, 2),
    ("paper_tab", "factual_lookup", None, 1),
    ("paper_tab", "comparison", None, 1),
    ("paper_tab", "reasoning", None, 1),
]

# Hand-authored slots written as placeholders: (dataset_key, type, count).
AUTHORED_SLOTS = [
    ("tat", "multi_hop", 3),
    ("paper_text", "multi_hop", 1),
    ("paper_tab", "multi_hop", 1),
    ("tat", "operational", 2),
    ("paper_text", "operational", 1),
]

TAT_COMPARISON_RE = re.compile(
    r"\b(change|difference|increase|decrease|compare|compared|growth|higher|lower)\b", re.I)
PAPER_COMPARISON_RE = re.compile(
    r"\b(compare|compared|better|best|outperform|than|improve|worse)\b", re.I)

# Estimates, printed so corpus scope can be reviewed before any PDF download or
# embedding begins. Measured: TatHybrid ~260 chunks / ~130K tokens per doc;
# papers assumed ~12 chunks/doc at ~800 tokens/chunk.
ESTIMATED_CHUNKS_PER_DOCUMENT = {"tat": 260, "paper_text": 12, "paper_tab": 12}
ESTIMATED_TOKENS_PER_DOCUMENT = {"tat": 130_000, "paper_text": 12 * 800, "paper_tab": 12 * 800}
VOYAGE_COST_PER_MILLION_TOKENS_USD = 0.02


def _read_qa_rows(dataset_key: str) -> list[dict]:
    """Load a cached HF parquet shard, fetching it once if absent."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached = CACHE_DIR / f"{dataset_key}_test_00000_of_00001.parquet"
    if not cached.exists():
        try:
            from huggingface_hub import hf_hub_download
        except ImportError as exc:
            raise RuntimeError("Install huggingface_hub to download UDA-QA shards") from exc
        downloaded = hf_hub_download(
            repo_id="qinchuanhui/UDA-QA",
            repo_type="dataset",
            filename=f"{dataset_key}/test_00000_of_00001.parquet",
            cache_dir=str(CACHE_DIR / "hf"),
        )
        # Keep a stable, obvious cache path so later runs avoid another fetch.
        import shutil

        shutil.copy2(downloaded, cached)
    try:
        import pandas as pd
    except ImportError as exc:
        raise RuntimeError("Install pandas and pyarrow to read UDA-QA parquet shards") from exc
    return pd.read_parquet(cached).to_dict(orient="records")


def _first(row: dict, *keys: str, default=""):
    for key in keys:
        value = row.get(key)
        if value is not None and not (isinstance(value, float) and math.isnan(value)):
            if str(value).strip():
                return value
    return default

def _json_value(value):
    if hasattr(value, "tolist"):
        return value.tolist()
    if hasattr(value, "item"):
        try:
            return value.item()
        except (ValueError, TypeError):
            pass
    return value


def _text(value) -> str:
    """Normalize answer values, including the list-valued Tat answer field."""
    value = _json_value(value)
    if isinstance(value, (list, tuple)):
        return "\n".join(str(_json_value(item)) for item in value if item is not None)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value).strip() if value is not None else ""


def _classify(dataset_key: str, row: dict) -> tuple[str, str | None] | None:
    """Deterministic (type, subkind) from UDA's annotations; None = excluded."""
    question = str(_first(row, "question", "query", "input")).strip()
    if dataset_key == "tat":
        answer_type = str(row.get("answer_type", "")).strip().lower()
        if answer_type == "span":
            return "factual_lookup", None
        if answer_type == "multi-span":
            return "broad_synthesis", None
        if answer_type == "arithmetic":
            if TAT_COMPARISON_RE.search(question):
                return "comparison", None
            return "numerical", "arithmetic"
        if answer_type == "count":
            return "numerical", "count"
        return None
    answer = _text(row.get("answer_1")).strip()
    if not answer or "unanswerable" in answer.lower():
        return None
    if answer.lower() in {"yes", "no"}:
        return "reasoning", None
    if PAPER_COMPARISON_RE.search(question):
        return "comparison", None
    if len(answer) > 100:
        return "broad_synthesis", None
    return "factual_lookup", None


def _authored_placeholders() -> list[dict]:
    """Hand-authoring slots; already-authored entries from a prior run are kept."""
    existing = {}
    if QUESTIONS_PATH.exists():
        with open(QUESTIONS_PATH, encoding="utf-8") as f:
            existing = {q["id"]: q for q in json.load(f).get("questions", [])}
    placeholders = []
    for dataset_key, qtype, count in AUTHORED_SLOTS:
        label = DATASETS[dataset_key][0]
        for ordinal in range(1, count + 1):
            qid = f"uda-{label}-{qtype}-{ordinal:02d}"
            prior = existing.get(qid)
            if prior and prior.get("origin") == "authored" and prior.get("status") != "pending_authoring":
                placeholders.append(prior)
                continue
            placeholders.append({
                "id": qid,
                "question": "",
                "ground_truth_answer": "",
                "relevant_chunks": [],
                "relevant_context": [],
                "type": qtype,
                "difficulty": "",
                "domain": label,
                "source": "uda",
                "origin": "authored",
                "status": "pending_authoring",
                "source_document": "",
                "source_doc_name": "",
                "source_page": "",
                "retrieved_contexts": [],
                "retrieved_chunk_indices": [],
            })
    return placeholders


def _print_matrix(title: str, counts: Counter):
    labels = [value[0] for value in DATASETS.values()]
    types = ["factual_lookup", "numerical", "comparison", "reasoning",
             "broad_synthesis", "multi_hop", "operational"]
    print(f"{title}:")
    print(f"  {'type':<16}" + "".join(f"{label:>11}" for label in labels) + f"{'total':>8}")
    for qtype in types:
        row = [counts[(qtype, label)] for label in labels]
        print(f"  {qtype:<16}" + "".join(f"{n:>11}" for n in row) + f"{sum(row):>8}")
    print(f"  {'total':<16}" + "".join(f"{sum(counts[(t, l)] for t in types):>11}" for l in labels)
          + f"{sum(counts.values()):>8}")


def step_download():
    """Fetch/cache Q&A shards, stratified-sample 17 benchmark queries by (subdataset, type)
    quota cell, add 8 hand-authoring placeholders, and list PDF IDs."""
    rng = random.Random(RANDOM_SEED)
    pools = {key: _read_qa_rows(key) for key in DATASETS}
    strata: dict[tuple, list[dict]] = {}
    for dataset_key, rows in pools.items():
        for row in rows:
            kind = _classify(dataset_key, row)
            if kind is not None:
                strata.setdefault((dataset_key, *kind), []).append(row)
    questions = []
    sources = {}

    for dataset_key, qtype, subkind, quota in QUOTA_CELLS:
        label, archive = DATASETS[dataset_key]
        pool = strata.get((dataset_key, qtype, subkind), [])
        if len(pool) < quota:
            raise RuntimeError(
                f"Quota cell {label}/{qtype}/{subkind or '-'} needs {quota} but only {len(pool)} candidates exist"
            )
        selected = rng.sample(pool, quota)
        for ordinal, row in enumerate(selected, start=1):
            doc_name = str(_first(row, "doc_name", "document", "doc_id", "document_id")).strip()
            if not doc_name:
                raise ValueError(f"Missing doc_name in {dataset_key} Q&A row: {row.keys()}")
            source_id = f"{archive}:{doc_name}"
            sources[source_id] = {
                "dataset": label,
                "archive": archive,
                "doc_name": doc_name,
                "source_id": source_id,
                "archive_member": None,
            }
            question = str(_first(row, "question", "query", "input")).strip()
            answer_value = _first(
                row, "answer", "answer_1", "long_answer", "short_answer",
                "ground_truth_answer", "response", "output",
            )
            alternate_answer = _first(row, "answer_2", default="")
            answer = _text(answer_value)
            if alternate_answer and _text(alternate_answer) not in answer:
                answer = f"{answer}\n{_text(alternate_answer)}".strip()
            context = _first(row, "well_structured_contexts", "contexts", "context", "evidence", default=[])
            if isinstance(context, str):
                context = [context] if context else []
            elif not isinstance(context, list):
                context = [str(context)] if context else []
            q_uid = str(_first(row, "q_uid", "id", default=ordinal))
            questions.append({
                "id": f"uda-{label}-{q_uid}",
                "question": question,
                "ground_truth_answer": answer,
                "relevant_chunks": [],
                "relevant_context": [_text(item) for item in context],
                "type": qtype,
                "difficulty": "medium",
                "domain": label,
                "source": "uda",
                "origin": "benchmark",
                "source_document": source_id,
                "source_doc_name": doc_name,
                "source_page": _json_value(_first(row, "page", "page_number", "page_id", default="")),
                "retrieved_contexts": [],
                "retrieved_chunk_indices": [],
            })

    benchmark_count = len(questions)
    questions.extend(_authored_placeholders())

    unique_docs = len(sources)
    docs_by_dataset = Counter(source["dataset"] for source in sources.values())
    chunks = tokens = 0
    for source in sources.values():
        key = next(k for k, v in DATASETS.items() if v[0] == source["dataset"])
        chunks += ESTIMATED_CHUNKS_PER_DOCUMENT[key]
        tokens += ESTIMATED_TOKENS_PER_DOCUMENT[key]
    cost = tokens / 1_000_000 * VOYAGE_COST_PER_MILLION_TOKENS_USD
    sampling = [
        {"dataset": DATASETS[key][0], "type": qtype, "subkind": subkind, "n": n}
        for key, qtype, subkind, n in QUOTA_CELLS
    ]
    output = {
        "metadata": {
            "benchmark": "UDA",
            "uda_subdatasets": [value[0] for value in DATASETS.values()],
            "uda_queries": len(questions),
            "benchmark_queries": benchmark_count,
            "authored_queries": len(questions) - benchmark_count,
            "created": date.today().isoformat(),
            "source_documents": list(sources.values()),
            "source_pdf_files_downloaded": 0,
            "sampling": sampling,
            "estimate_assumptions": {
                "chunks_per_document": ESTIMATED_CHUNKS_PER_DOCUMENT,
                "tokens_per_document": ESTIMATED_TOKENS_PER_DOCUMENT,
                "embedding_model": "voyage-3.5-lite",
                "embedding_cost_per_million_tokens_usd": VOYAGE_COST_PER_MILLION_TOKENS_USD,
            },
        },
        "questions": questions,
    }
    QUESTIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    QUESTIONS_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(questions)} UDA questions ({benchmark_count} benchmark, "
          f"{len(questions) - benchmark_count} authored placeholders) to {QUESTIONS_PATH}")
    target = Counter()
    for key, qtype, _, n in QUOTA_CELLS:
        target[(qtype, DATASETS[key][0])] += n
    for key, qtype, n in AUTHORED_SLOTS:
        target[(qtype, DATASETS[key][0])] += n
    _print_matrix("Target type x subdataset", target)
    _print_matrix("Realized type x subdataset", Counter((q["type"], q["domain"]) for q in questions))
    print(f"Unique source documents: {unique_docs} ("
          + ", ".join(f"{k}={v}" for k, v in docs_by_dataset.items()) + ")")
    print(f"Estimated chunks: {chunks:,} (tat ~260/doc, papers ~12/doc)")
    print(f"Estimated Voyage embedding cost: ${cost:.4f} ({tokens:,} tokens)")
    print("Source PDFs downloaded: 0")


# ===================================================================
# Ingest (ticket #02): download source PDFs, parse, chunk (phases 1-3),
# then embed + write to Qdrant + noise padding (phases 4-5).
# ===================================================================
def _load_source_documents() -> list[dict]:
    if not QUESTIONS_PATH.exists():
        raise RuntimeError(f"{QUESTIONS_PATH} not found — run --step download first")
    with open(QUESTIONS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return data["metadata"]["source_documents"]


def _zip_member_path(archive: str, doc_name: str) -> str:
    return f"{ARCHIVE_PDF_PATH[archive]}/{doc_name}.pdf"


def _download_archive(archive: str) -> Path:
    """Download (or reuse the local HF cache for) a source-PDF zip archive."""
    try:
        from huggingface_hub import hf_hub_download
    except ImportError as exc:
        raise RuntimeError("Install huggingface_hub to download UDA source PDF archives") from exc
    local_path = hf_hub_download(
        repo_id="qinchuanhui/UDA-QA",
        repo_type="dataset",
        filename=f"src_doc_files/{archive}",
        cache_dir=str(CACHE_DIR / "hf"),
    )
    return Path(local_path)


def _extract_pdf(zf: zipfile.ZipFile, archive: str, doc_name: str, dest_dir: Path) -> Path | None:
    """Extract one PDF member from an open zip, skipping if already cached."""
    dest = dest_dir / f"{doc_name}.pdf"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    member = _zip_member_path(archive, doc_name)
    try:
        data = zf.read(member)
    except KeyError:
        print(f"  WARNING: {member} not found in {archive}, skipping")
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return dest


def _download_source_pdfs(sources: list[dict]) -> dict[str, Path]:
    """Phase 1: download only the zips that are needed, extract only the
    referenced PDFs. Returns source_id -> local PDF path."""
    by_archive: dict[str, list[dict]] = {}
    for src in sources:
        by_archive.setdefault(src["archive"], []).append(src)

    pdf_paths: dict[str, Path] = {}
    for archive, srcs in by_archive.items():
        archive_stem = archive.removesuffix(".zip")
        dest_dir = UDA_PDF_DIR / archive_stem
        already_cached = all((dest_dir / f"{s['doc_name']}.pdf").exists() for s in srcs)
        if already_cached:
            for s in srcs:
                pdf_paths[s["source_id"]] = dest_dir / f"{s['doc_name']}.pdf"
            continue
        print(f"Downloading {archive} from HuggingFace (qinchuanhui/UDA-QA)...")
        try:
            zip_path = _download_archive(archive)
        except Exception as exc:
            print(f"  WARNING: failed to download {archive}: {exc}")
            continue
        with zipfile.ZipFile(zip_path) as zf:
            for s in srcs:
                extracted = _extract_pdf(zf, archive, s["doc_name"], dest_dir)
                if extracted is not None:
                    pdf_paths[s["source_id"]] = extracted
    return pdf_paths


def _parse_source_pdfs(pdf_paths: dict[str, Path]) -> dict[str, str]:
    """Phase 2: parse each PDF to markdown via the production PDFParser
    (pymupdf4llm), caching the result to disk. Returns source_id -> markdown."""
    from ingest.parsers import PDFParser

    parser = PDFParser()
    UDA_MD_DIR.mkdir(parents=True, exist_ok=True)
    markdowns: dict[str, str] = {}
    for source_id, pdf_path in pdf_paths.items():
        doc_name = pdf_path.stem
        md_path = UDA_MD_DIR / f"{doc_name}.md"
        if md_path.exists() and md_path.stat().st_size > 0:
            markdowns[source_id] = md_path.read_text(encoding="utf-8")
            continue
        try:
            pdf_bytes = pdf_path.read_bytes()
            markdown = parser.parse(pdf_bytes)
        except Exception as exc:
            print(f"  WARNING: failed to parse {pdf_path.name}: {exc}")
            continue
        if not markdown or not markdown.strip():
            print(f"  WARNING: {pdf_path.name} parsed to empty markdown, skipping")
            continue
        md_path.write_text(markdown, encoding="utf-8")
        markdowns[source_id] = markdown
    return markdowns


def _chunk_documents(markdowns: dict[str, str]) -> dict[str, list]:
    """Phase 3: chunk each parsed document with the production chunker.
    Returns source_id -> list[Chunk]."""
    from ingest.chunker import chunk_markdown

    chunk_map: dict[str, list] = {}
    for source_id, markdown in markdowns.items():
        try:
            chunks = chunk_markdown(markdown, max_tokens=1024, min_tokens=64, chunk_overlap=128)
        except Exception as exc:
            print(f"  WARNING: failed to chunk {source_id}: {exc}")
            continue
        if not chunks:
            print(f"  WARNING: {source_id} produced zero chunks, skipping")
            continue
        chunk_map[source_id] = chunks
    return chunk_map


def step_ingest():
    """Phases 1-3: download source PDFs, parse with pymupdf4llm, chunk.

    This is a deliberate PAUSE POINT before any paid Voyage API calls — it
    only downloads/parses/chunks and prints what step_embed would send to
    Qdrant, so the corpus scope can be reviewed first.
    """
    sources = _load_source_documents()
    print(f"Source documents referenced by sampled questions: {len(sources)}")

    pdf_paths = _download_source_pdfs(sources)
    print(f"PDFs available: {len(pdf_paths)} / {len(sources)}")

    markdowns = _parse_source_pdfs(pdf_paths)
    print(f"PDFs parsed to markdown: {len(markdowns)} / {len(pdf_paths)}")

    chunk_map = _chunk_documents(markdowns)
    total_chunks = sum(len(c) for c in chunk_map.values())
    total_tokens = sum(chunk.tokens for chunks in chunk_map.values() for chunk in chunks)
    cost = total_tokens / 1_000_000 * VOYAGE_COST_PER_MILLION_TOKENS_USD

    source_by_id = {s["source_id"]: s for s in sources}
    by_dataset: Counter = Counter()
    for source_id, chunks in chunk_map.items():
        dataset = source_by_id.get(source_id, {}).get("dataset", "unknown")
        by_dataset[dataset] += len(chunks)

    print("\n" + "=" * 72)
    print("INGEST SUMMARY (signal documents only — noise padding runs in 'embed')")
    print("=" * 72)
    print(f"Documents parsed + chunked: {len(chunk_map)}")
    print(f"Total signal chunks: {total_chunks}")
    print(f"Total signal tokens: {total_tokens:,}")
    print(f"Estimated Voyage embedding cost (signal only): ${cost:.4f}")
    print("Chunks per subdataset:")
    for dataset, count in sorted(by_dataset.items()):
        print(f"  {dataset}: {count}")
    print(f"\nNext: run --step embed to embed signal chunks, write to Qdrant "
          f"collection '{COLLECTION_NAME}', and pad with noise documents "
          f"(noise docs = ceil(signal docs * {NOISE_DOCS_PER_SIGNAL_DOC}) per subdataset).")


# ===================================================================
# Embed (ticket #02, phases 4-5): embed + Qdrant write + noise padding.
# ===================================================================
def _list_zip_pdf_docnames(zip_path: Path, archive: str) -> list[str]:
    """All PDF doc_names present in a zip archive, under its known PDF prefix."""
    prefix = ARCHIVE_PDF_PATH[archive] + "/"
    names = []
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if name.startswith(prefix) and name.lower().endswith(".pdf"):
                doc_name = name[len(prefix):-len(".pdf")]
                if doc_name and "/" not in doc_name:
                    names.append(doc_name)
    return names


def _embed_and_write_chunks(client, dense_fn, sparse_fn, dataset: str, source_id: str, chunks: list) -> int:
    """Embed a document's chunks (dense + sparse) in batches of EMBED_BATCH_SIZE
    and upsert them to the Qdrant collection. Returns the number of chunks actually written."""
    from ingest.mytests.eval_support import upsert_chunks

    written = 0
    for batch_start in range(0, len(chunks), EMBED_BATCH_SIZE):
        batch = chunks[batch_start:batch_start + EMBED_BATCH_SIZE]
        contents = [c.content for c in batch]
        token_sizes = [c.tokens for c in batch]
        try:
            dense = dense_fn(contents, token_size=token_sizes, input_type="document")
            sparse = sparse_fn(contents, input_type="document")
        except Exception as exc:
            print(f"  WARNING: embedding call failed for {source_id} batch @ {batch_start}: {exc}")
            continue
        if not dense:
            print(f"  WARNING: embedding batch skipped (empty result) for {source_id} @ {batch_start}")
            continue

        written += upsert_chunks(
            client, COLLECTION_NAME, UDA_UID, source_id, batch, dense, sparse,
            start_index=batch_start, extra_payload={"dataset": dataset},
        )
    return written


def step_embed():
    """Phases 4-5: embed signal chunks + noise-padding documents, write to Qdrant."""
    from ingest.mytests.eval_support import (
        connect,
        create_dense_embedder,
        create_sparse_embedder,
        recreate_collection,
    )

    sources = _load_source_documents()
    source_by_id = {s["source_id"]: s for s in sources}

    pdf_paths = _download_source_pdfs(sources)
    markdowns = _parse_source_pdfs(pdf_paths)
    chunk_map = _chunk_documents(markdowns)
    if not chunk_map:
        print("No signal documents available to embed (see warnings above) — nothing to do.")
        return

    client = connect()
    dense_fn = create_dense_embedder()
    sparse_fn = create_sparse_embedder()
    recreate_collection(client, COLLECTION_NAME, keyword_fields=("userId", "docId", "dataset"))

    signal_chunks_by_dataset: Counter = Counter()
    signal_docs_by_dataset: Counter = Counter()
    total_signal_chunks = 0

    print(f"Embedding {len(chunk_map)} signal documents into '{COLLECTION_NAME}'...")
    for source_id, chunks in chunk_map.items():
        dataset = source_by_id.get(source_id, {}).get("dataset", "unknown")
        written = _embed_and_write_chunks(client, dense_fn, sparse_fn, dataset, source_id, chunks)
        signal_chunks_by_dataset[dataset] += written
        if written > 0:
            signal_docs_by_dataset[dataset] += 1
        total_signal_chunks += written
        print(f"  {source_id}: {written} chunks")

    # Phase 5: noise document padding, per subdataset.
    rng = random.Random(RANDOM_SEED)
    sources_by_dataset: dict[str, list[dict]] = {}
    referenced_by_archive: dict[str, set[str]] = {}
    for s in sources:
        sources_by_dataset.setdefault(s["dataset"], []).append(s)
        referenced_by_archive.setdefault(s["archive"], set()).add(s["doc_name"])

    used_noise_names: dict[str, set[str]] = {archive: set() for archive in referenced_by_archive}
    zip_path_cache: dict[str, Path] = {}
    candidate_cache: dict[str, list[str]] = {}
    noise_chunks_by_dataset: Counter = Counter()
    noise_docs_by_dataset: Counter = Counter()
    noise_docs_target_by_dataset: Counter = Counter()

    print(f"\nPadding with noise documents (noise docs = ceil(signal docs * {NOISE_DOCS_PER_SIGNAL_DOC}) per subdataset)...")
    for dataset, sources_for_dataset in sources_by_dataset.items():
        signal_docs = signal_docs_by_dataset.get(dataset, 0)
        if signal_docs <= 0:
            print(f"  {dataset}: no signal chunks embedded, skipping noise padding")
            continue
        archive = sources_for_dataset[0]["archive"]
        target_noise_docs = math.ceil(signal_docs * NOISE_DOCS_PER_SIGNAL_DOC)
        noise_docs_target_by_dataset[dataset] = target_noise_docs

        if archive not in zip_path_cache:
            try:
                zip_path_cache[archive] = _download_archive(archive)
            except Exception as exc:
                print(f"  WARNING: could not download {archive} for noise docs: {exc}")
                continue
        zip_path = zip_path_cache[archive]

        if archive not in candidate_cache:
            all_names = _list_zip_pdf_docnames(zip_path, archive)
            candidates = [n for n in all_names if n not in referenced_by_archive[archive]]
            rng.shuffle(candidates)
            candidate_cache[archive] = candidates

        archive_stem = archive.removesuffix(".zip")
        dest_dir = UDA_PDF_DIR / archive_stem
        noise_count = 0
        noise_docs = 0
        with zipfile.ZipFile(zip_path) as zf:
            for doc_name in candidate_cache[archive]:
                if noise_docs >= target_noise_docs:
                    break
                if doc_name in used_noise_names[archive]:
                    continue
                pdf_path = _extract_pdf(zf, archive, doc_name, dest_dir)
                if pdf_path is None:
                    continue
                used_noise_names[archive].add(doc_name)

                noise_source_id = f"noise:{archive}:{doc_name}"
                noise_markdowns = _parse_source_pdfs({noise_source_id: pdf_path})
                if noise_source_id not in noise_markdowns:
                    continue
                noise_chunk_map = _chunk_documents({noise_source_id: noise_markdowns[noise_source_id]})
                if noise_source_id not in noise_chunk_map:
                    continue

                written = _embed_and_write_chunks(
                    client, dense_fn, sparse_fn, dataset, noise_source_id, noise_chunk_map[noise_source_id]
                )
                if written <= 0:
                    continue  # a noise doc that embedded nothing doesn't count
                noise_count += written
                noise_docs += 1

        noise_chunks_by_dataset[dataset] = noise_count
        noise_docs_by_dataset[dataset] = noise_docs
        print(f"  {dataset}: {signal_docs} signal docs ({signal_chunks_by_dataset[dataset]} chunks), "
              f"{noise_docs}/{target_noise_docs} noise docs ({noise_count} chunks)")

    total_chunks = total_signal_chunks + sum(noise_chunks_by_dataset.values())

    print("\n" + "=" * 72)
    print("EMBED SUMMARY")
    print("=" * 72)
    print(f"Total chunks embedded (signal + noise): {total_chunks}")
    print("Per subdataset (docs achieved/target for noise; chunk ratio is info only):")
    for dataset in sorted(set(signal_chunks_by_dataset) | set(noise_chunks_by_dataset)):
        sig_chunks = signal_chunks_by_dataset.get(dataset, 0)
        noise_chunks = noise_chunks_by_dataset.get(dataset, 0)
        ratio = f"{noise_chunks / sig_chunks:.1f}:1" if sig_chunks else "n/a"
        print(f"  {dataset}: signal docs={signal_docs_by_dataset.get(dataset, 0)} "
              f"noise docs={noise_docs_by_dataset.get(dataset, 0)}/{noise_docs_target_by_dataset.get(dataset, 0)} "
              f"signal chunks={sig_chunks} noise chunks={noise_chunks} (chunk ratio {ratio})")
    total_signal_docs = sum(signal_docs_by_dataset.values())
    total_noise_docs = sum(noise_docs_by_dataset.values())
    print(f"Total documents: {total_signal_docs} signal + {total_noise_docs} noise")
    print(f"Total chunks: {total_signal_chunks} signal + {sum(noise_chunks_by_dataset.values())} noise")


def _not_implemented(step: str):
    print(f"Step '{step}' is scaffolded and will be implemented in a later ticket.")


STEPS = {
    "download": step_download,
    "ingest": step_ingest,    # phases 1-3: download PDFs, parse, chunk
    "embed": step_embed,      # phases 4-5: embed + Qdrant + noise padding
    "label": lambda: _not_implemented("label"),
    "eval": lambda: _not_implemented("eval"),
    "report": lambda: _not_implemented("report"),
}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="UDA benchmark evaluation pipeline")
    parser.add_argument("--step", choices=list(STEPS), nargs="+", default=list(STEPS))
    args = parser.parse_args()
    for step_name in args.step:
        print(f"\n{'#' * 72}\n# STEP: {step_name}\n{'#' * 72}")
        STEPS[step_name]()
