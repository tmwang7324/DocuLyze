"""UDA benchmark cases: evidence import, the production-chunked corpus and evidence mappings.

UDA (qinchuanhui/UDA-QA) ships questions and answers in its per-subset parquet files and
the evidence behind each answer separately, in `extended_qa_info/<subset>_qa.json`. The
17 selected benchmark questions in `uda_questions.json` are joined to that evidence by
their verified identifiers (source document name + q_uid); the eight hand-authored
placeholders (`status: pending_authoring`) are excluded until they are written.

Reference Passages:
- PaperText / PaperTab: the first annotator's highlighted evidence (the annotator whose
  answer is `answer_1`, the reference answer). A "FLOAT SELECTED: " prefix marks a table
  or figure caption and is dropped.
- TatHybrid: the answer's `facts`, the table values the answer is derived from. UDA
  identifies their page, not their text, so each fact is its own passage.
A question whose annotator gave no evidence (some yes/no answers) has no Reference
Passages: it is not a retrieval case, but answer evaluation still runs on it.

Mappings tie each Reference Passage to the corpus chunks containing it. Proposals come
from `propose_labels` (deterministic text matching) and are unreviewed until a person
fills in `reviewed_by`; each mapped chunk records `matched_text`, a verbatim excerpt of
the chunk, so a mapping can be audited and is invalidated when the chunker changes.
"""

import hashlib
import json
import logging
import math
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

from evaluation.benchmark import validated_mapping
from evaluation.corpus import corpus_version

ROOT = Path(__file__).resolve().parents[1]
QUESTIONS = ROOT / "ingest-worker" / "experimental_results" / "sample_q&a" / "uda_questions.json"
MARKDOWN = ROOT / "ingest-worker" / "experimental_results" / "source_files" / "converted_md"
CHUNKER = ROOT / "ingest-worker" / "src" / "ingest" / "chunker.py"
EVIDENCE = ROOT / "evaluation" / "uda_evidence.json"
LABELS = ROOT / "evaluation" / "uda_labels.json"
RESULTS = ROOT / "evaluation" / "results"

COLLECTION = "uda_eval_chunks"
COLLECTION_CONTEXT = "uda_eval_chunks_ctx"  # embedded with contextual headers (--headers)
UID = "uda-eval"
HF_EVIDENCE = "https://huggingface.co/datasets/qinchuanhui/UDA-QA/resolve/main/extended_qa_info/"
SUBSET_FILES = {"tathybrid": "tat_qa.json", "papertext": "paper_text_qa.json", "papertab": "paper_tab_qa.json"}
CAPTION_PREFIX = "FLOAT SELECTED: "
LOG = logging.getLogger("evaluation.uda")


# ---------------------------------------------------------------------------
# Evidence import
# ---------------------------------------------------------------------------
def benchmark_questions(source):
    """The questions that can be evaluated, and the ids of excluded authoring placeholders."""
    ready, excluded = [], []
    for question in source["questions"]:
        (excluded if question.get("status") == "pending_authoring" else ready).append(question)
    return ready, [question["id"] for question in excluded]


def _reference_answer(question, record):
    answer = question.get("ground_truth_answer", "")
    scale = (record.get("answers") or {}).get("scale", "") if question["domain"] == "tathybrid" else ""
    if scale == "percent":
        return f"{answer}%"
    return f"{answer} {scale}".strip() if scale else answer


def _paper_passages(record):
    evidence = record.get("evidence") or []
    first = evidence[0] if evidence else {}
    passages, seen = [], set()
    for text in first.get("highlighted_evidence") or []:
        kind = "text"
        if text.startswith(CAPTION_PREFIX):
            text, kind = text[len(CAPTION_PREFIX):], "caption"
        text = text.strip()
        if text and text not in seen:
            seen.add(text)
            passages.append({"id": f"e{len(passages) + 1}", "text": text, "kind": kind})
    return passages


def _tat_passages(record):
    passages, seen = [], set()
    for fact in record.get("facts") or []:
        fact = str(fact).strip()
        if fact and fact not in seen:
            seen.add(fact)
            passages.append({"id": f"fact{len(passages) + 1}", "text": fact, "kind": "table_value"})
    return passages


def import_evidence(source, extended):
    """Join each benchmark question to its UDA evidence record by document + q_uid."""
    questions, excluded = benchmark_questions(source)
    cases = {}
    for question in questions:
        domain, document = question["domain"], question["source_doc_name"]
        q_uid = question["id"].rsplit("-", 1)[1]
        records = [r for r in extended[domain].get(document, []) if r.get("q_uid") == q_uid]
        if len(records) != 1:
            raise ValueError(f"Expected one UDA evidence record for {question['id']}, found {len(records)}")
        record = records[0]
        if record.get("question", "").strip() != question["question"].strip():
            raise ValueError(f"UDA evidence question text does not match {question['id']}")
        passages = _tat_passages(record) if domain == "tathybrid" else _paper_passages(record)
        case = {"group": domain, "document": document, "q_uid": q_uid, "question": question["question"],
                "type": question.get("type"), "reference_answer": _reference_answer(question, record),
                "original_reference_answer": question.get("ground_truth_answer"),
                "reference_passages": passages}
        if domain == "tathybrid":
            case["derivation"] = record.get("derivation", "")
            case["doc_page_uid"] = record.get("doc_page_uid")
        cases[question["id"]] = case
    return {"source": "qinchuanhui/UDA-QA extended_qa_info (" + ", ".join(sorted(SUBSET_FILES.values())) + ")",
            "excluded_placeholders": excluded, "cases": cases}


def fetch_extended(cache_dir):
    """Download the three subsets' evidence files (network; about 16 MB) into cache_dir."""
    import urllib.request

    cache_dir.mkdir(parents=True, exist_ok=True)
    extended = {}
    for domain, name in SUBSET_FILES.items():
        path = cache_dir / name
        if not path.exists():
            LOG.info("Downloading %s", name)
            urllib.request.urlretrieve(HF_EVIDENCE + name, path)
        extended[domain] = json.loads(path.read_text(encoding="utf-8"))
    return extended


# ---------------------------------------------------------------------------
# Corpus
# ---------------------------------------------------------------------------
def chunker_version():
    digest = hashlib.sha256(CHUNKER.read_bytes()).hexdigest()[:16]
    return f"chunk_markdown@sha256:{digest}"


def load_corpus_with_headers(source, markdown_dir=MARKDOWN):
    """Chunk every UDA source document with the production chunker.

    Returns (chunks, breadcrumbs, headers): chunks carry document, chunk_index and content
    (the fields the corpus fingerprint covers); breadcrumbs map (document, chunk_index) to
    the chunker's breadcrumb, which production prepends to each excerpt; headers map the
    same keys to the heading path production embeds with the chunk (retrieval.context)."""
    sys.path.insert(0, str(ROOT / "ingest-worker" / "src"))
    from ingest.chunker import chunk_markdown
    from retrieval.context import context_header

    chunks, breadcrumbs, headers = [], {}, {}
    for document in sorted(item["doc_name"] for item in source["metadata"]["source_documents"]):
        text = (markdown_dir / f"{document}.md").read_text(encoding="utf-8")
        for chunk in chunk_markdown(text, source=document):
            index = chunk.metadata["chunk_index"]
            chunks.append({"document": document, "chunk_index": index, "content": chunk.content})
            breadcrumbs[(document, index)] = chunk.breadcrumb()
            headers[(document, index)] = context_header(chunk.metadata, chunk.content)
    return chunks, breadcrumbs, headers


def load_corpus(source, markdown_dir=MARKDOWN):
    """(chunks, breadcrumbs) for every UDA source document; see load_corpus_with_headers."""
    chunks, breadcrumbs, _ = load_corpus_with_headers(source, markdown_dir)
    return chunks, breadcrumbs


# ---------------------------------------------------------------------------
# Mapping proposals
# ---------------------------------------------------------------------------
_MARKUP = re.compile(r"\b(?:BIBREF|TABREF|FIGREF|SECREF|INLINEFORM|DISPLAYFORM)\d+\b")
_WORD = re.compile(r"[a-z0-9]+")
_STOP = set("a an and are as at be by did do does for from how in is it its of on or that the their them "
            "they this to was were what when which who why with years year".split())
MIN_COVERAGE = 0.5
MIN_ANCHOR_WORDS = 8


def text_match(passage, content):
    """How much of `passage` occurs in `content`, word by word, ignoring case, punctuation
    and UDA's LaTeX placeholders. Returns (coverage, verbatim longest matching excerpt)."""
    wanted = _WORD.findall(_MARKUP.sub(" ", passage.lower()))
    found = list(_WORD.finditer(content.lower()))
    if not wanted or not found:
        return 0.0, ""
    matcher = SequenceMatcher(None, wanted, [m.group() for m in found], autojunk=False)
    blocks = [block for block in matcher.get_matching_blocks() if block.size]
    if not blocks:
        return 0.0, ""
    longest = max(blocks, key=lambda block: block.size)
    excerpt = content[found[longest.b].start():found[longest.b + longest.size - 1].end()]
    return sum(block.size for block in blocks) / len(wanted), excerpt


def _fact_pattern(fact):
    # A thousands separator before a number with separators of its own ("1,2,306.8") means
    # a different number; before a bare integer it is usually punctuation ("July28,2018").
    before = r"(?<![\d.,])" if re.search(r"[.,]", fact) else r"(?<![\d.])"
    return re.compile(before + re.escape(fact) + r"(?![\d])")


_TABLE_RULE = re.compile(r"^\|(?:\s*:?-+:?\s*\|)+\s*$", re.MULTILINE)


def _keywords(question):
    return {word for word in _WORD.findall(question.lower()) if word not in _STOP and not word.isdigit()}


def _propose_paper(case, chunks):
    mappings, unmapped = {}, []
    for passage in case["reference_passages"]:
        matches = []
        for chunk in chunks:
            coverage, excerpt = text_match(passage["text"], chunk["content"])
            if coverage >= MIN_COVERAGE and len(_WORD.findall(excerpt.lower())) >= min(
                    MIN_ANCHOR_WORDS, len(_WORD.findall(passage["text"].lower()))):
                matches.append((coverage, chunk, excerpt))
        if not matches:
            unmapped.append(passage["id"])
        for coverage, chunk, excerpt in matches:
            entry = mappings.setdefault(chunk["chunk_index"], {"document": chunk["document"],
                                                                "chunk_index": chunk["chunk_index"],
                                                                "passage_ids": [], "matched_text": [],
                                                                "coverage": []})
            entry["passage_ids"].append(passage["id"])
            entry["matched_text"].append(excerpt)
            entry["coverage"].append(round(coverage, 3))
    return mappings, unmapped


def _propose_tat(case, chunks):
    """Facts are table values, so a chunk qualifies by containing them. Chunks holding every
    remaining fact come first, then chunks with a table; among those, the best match for the
    question's keywords wins, each keyword weighted by its rarity in the document, so
    "warranty" outweighs "total". The ordering matters for ubiquitous facts such as years."""
    facts = case["reference_passages"]
    keywords = _keywords(case["question"])
    words = {chunk["chunk_index"]: set(_WORD.findall(chunk["content"].lower())) for chunk in chunks}
    weight = {word: math.log((1 + len(chunks)) / (1 + sum(word in found for found in words.values())))
              for word in keywords}
    tokens = _WORD.findall(case["question"].lower())
    phrases = [(a, b) for a, b in zip(tokens, tokens[1:]) if a in keywords and b in keywords]
    mappings, remaining = {}, list(facts)
    while remaining:
        best = None
        for chunk in chunks:
            contained = [fact for fact in remaining if _fact_pattern(fact["text"]).search(chunk["content"])]
            if not contained:
                continue
            overlap = sum(weight[word] for word in keywords & words[chunk["chunk_index"]])
            # Adjacent keyword pairs ("total additions") found as a phrase count again.
            normalized = " ".join(_WORD.findall(chunk["content"].lower()))
            overlap += sum(weight[a] + weight[b] for a, b in phrases if f"{a} {b}" in normalized)
            has_table = bool(_TABLE_RULE.search(chunk["content"]))
            rank = (len(contained) == len(remaining), has_table, overlap, len(contained), -chunk["chunk_index"])
            if best is None or rank > best[0]:
                best = (rank, chunk, contained)
        if best is None:
            break
        _, chunk, contained = best
        mappings[chunk["chunk_index"]] = {"document": chunk["document"], "chunk_index": chunk["chunk_index"],
                                          "passage_ids": [fact["id"] for fact in contained],
                                          "matched_text": [fact["text"] for fact in contained]}
        remaining = [fact for fact in remaining if fact not in contained]
    return mappings, [fact["id"] for fact in remaining]


def propose_labels(evidence, chunks):
    """Unreviewed evidence-to-chunk mappings for every imported case."""
    by_document = {}
    for chunk in chunks:
        by_document.setdefault(chunk["document"], []).append(chunk)
    labels = {"corpus_version": corpus_version(chunks), "chunker_version": chunker_version(),
              "proposal_method": "evaluation.uda.propose_labels (deterministic text matching; review before use)",
              "cases": {}}
    for case_id, case in sorted(evidence["cases"].items()):
        label = {"reviewed_by": "", "reference_passages": case["reference_passages"], "chunks": []}
        if case["reference_passages"]:
            propose = _propose_tat if case["group"] == "tathybrid" else _propose_paper
            mappings, unmapped = propose(case, by_document.get(case["document"], []))
            label["chunks"] = [mappings[index] for index in sorted(mappings)]
            if unmapped:
                label["unmapped_passage_ids"] = unmapped
        labels["cases"][case_id] = label
    return labels


def merge_proposals(evidence, chunks, proposals, method):
    """Labels from externally proposed mappings (e.g. LLM-assisted), still unreviewed.

    `proposals` maps case id -> {"chunks": [{chunk_index, passage_ids, matched_text,
    rationale}], "unmapped_passage_ids", "confidence", "notes"}. Each excerpt must occur
    verbatim in the chunk it names, so a hallucinated match fails here, not at scoring."""
    lookup = {(chunk["document"], chunk["chunk_index"]): chunk["content"] for chunk in chunks}
    labels = {"corpus_version": corpus_version(chunks), "chunker_version": chunker_version(),
              "proposal_method": method, "cases": {}}
    for case_id, case in sorted(evidence["cases"].items()):
        label = {"reviewed_by": "", "reference_passages": case["reference_passages"], "chunks": []}
        proposal = proposals.get(case_id)
        if case["reference_passages"] and proposal is None:
            raise ValueError(f"No proposal for {case_id}")
        ids = {passage["id"] for passage in case["reference_passages"]}
        for item in sorted((proposal or {}).get("chunks", []), key=lambda item: item["chunk_index"]):
            key = (case["document"], item["chunk_index"])
            texts = item["matched_text"]
            if key not in lookup or len(texts) != len(item["passage_ids"]) or not set(item["passage_ids"]) <= ids:
                raise ValueError(f"Malformed proposal for {case_id} chunk {item['chunk_index']}")
            missing = [text for text in texts if text not in lookup[key]]
            if missing:
                raise ValueError(f"Proposed excerpt is not verbatim in {case_id} chunk {item['chunk_index']}: {missing[0][:60]!r}")
            label["chunks"].append({"document": case["document"], "chunk_index": item["chunk_index"],
                                    "passage_ids": item["passage_ids"], "matched_text": texts,
                                    "rationale": item.get("rationale", "")})
        for field in ("unmapped_passage_ids", "confidence", "notes"):
            if (proposal or {}).get(field):
                label[field] = proposal[field]
        labels["cases"][case_id] = label
    return labels


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------
def _anchors(chunk, passage_texts):
    return chunk.get("matched_text") or []


def uda_cases(evidence, labels, corpus, allow_unreviewed=False):
    """Benchmark cases for the runner. Only reviewed mappings are scored unless
    `allow_unreviewed`, which marks every case built from a proposal as provisional."""
    if labels.get("corpus_version") != corpus_version(corpus) or labels.get("chunker_version") != chunker_version():
        raise ValueError("UDA mappings were made for a different corpus or chunker version; re-propose and review")
    lookup = {(chunk["document"], chunk["chunk_index"]): chunk["content"] for chunk in corpus}
    cases = []
    for case_id, item in sorted(evidence["cases"].items()):
        label = labels["cases"].get(case_id, {})
        reviewed = isinstance(label.get("reviewed_by"), str) and bool(label["reviewed_by"].strip())
        case = {"id": case_id, "question": item["question"], "group": item["group"], "type": item.get("type"),
                "reference_answer": item["reference_answer"],
                "original_reference_answer": item["original_reference_answer"],
                "reference_data": item["reference_passages"], "reviewed_by": label.get("reviewed_by") or None,
                "provisional": not reviewed}
        if not item["reference_passages"]:
            cases.append({**case, "reference_passages": [], "mapping": {},
                          "not_scored_reason": "UDA gives no evidence for this answer"})
            continue
        try:
            _, mapping = validated_mapping(case_id, label, lookup, require_review=not allow_unreviewed,
                                           anchors=_anchors)
        except ValueError as exc:
            cases.append({**case, "reference_passages": [p["id"] for p in item["reference_passages"]],
                          "mapping": {}, "invalid_mapping": str(exc)})
            continue
        cases.append({**case, "reference_passages": [p["id"] for p in item["reference_passages"]],
                      "mapping": mapping})
    return cases


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
def _local_qdrant(path):
    """An on-disk local Qdrant (no server): the UDA corpus never touches Qdrant Cloud."""
    from qdrant_client import QdrantClient

    path.mkdir(parents=True, exist_ok=True)
    return QdrantClient(path=str(path))


def prepare_index(client, chunks, labels, strategy, headers=None):
    """Index the corpus into the local evaluation collection unless an identical one exists.

    With `headers`, chunks are embedded with their heading path (production's format) into
    their own collection, so a contextual run never reads a plain index or the reverse."""
    collection = COLLECTION if headers is None else COLLECTION_CONTEXT
    sys.path.insert(0, str(ROOT / "ingest-worker" / "src"))
    from ingest.mytests.eval_support import create_dense_embedder, create_sparse_embedder
    from retrieval.config import embedding_dim, embedding_model

    from evaluation.corpus import index_corpus
    from evaluation.google import validate_collection

    dense = create_dense_embedder()
    sparse = create_sparse_embedder()
    expected = {"corpus_version": labels["corpus_version"], "chunker_version": labels["chunker_version"]}
    try:
        validate_collection(client, expected, embedding_model(), chunks, collection=collection, uid=UID)
        LOG.info("Reusing the local evaluation index %s (%d chunks)", collection, len(chunks))
    except Exception:
        LOG.info("Indexing %d chunks into the local evaluation collection %s", len(chunks), collection)
        index_corpus(client, chunks, dense, embedding_model(), embedding_dim(), collection=collection, uid=UID,
                     chunker_version=labels["chunker_version"], sparse_embed=sparse, sparse_model="Qdrant/bm25",
                     headers=headers)
        validate_collection(client, expected, embedding_model(), chunks, collection=collection, uid=UID)
    return dense, sparse, embedding_model()


def render_summary(report, ragas_summary=None):
    """A Markdown summary with no corpus text, safe to commit."""
    config = report["config"]
    lines = [f"# UDA evaluation: {config['strategy']}, {config.get('scope', 'corpus')} scope", ""]
    if config.get("provisional"):
        lines += ["> **Provisional.** Scored against unreviewed (LLM-assisted) evidence mappings; "
                  "the numbers change if review changes a mapping.", ""]
    lines += ["| Setting | Value |", "|---|---|"]
    lines += [f"| {key} | `{value}` |" for key, value in config.items() if key != "judge"]
    lines += ["", "## Retrieval (deterministic)", "",
              "Means over scored cases. `n` = scored / total (failed, not scored).", ""]
    header = "| Group | n | " + " | ".join(f"{m}@{k}" for k in (3, 5, 8) for m in ("recall", "f1", "ndcg")) + " | all-evidence@8 |"
    lines += [header, "|" + "---|" * (header.count("|") - 1)]

    def row(name, summary):
        cells = []
        for k in (3, 5, 8):
            for metric in ("recall", "f1", "ndcg"):
                value = summary["metrics"][k][metric]
                cells.append("-" if value is None else f"{value:.3f}")
        coverage = summary["metrics"][8]["all_evidence"]
        cells.append("-" if coverage is None else f"{coverage:.3f}")
        counts = f"{summary['scored']}/{summary['count']} ({summary['failed']}, {summary['not_scored']})"
        return f"| {name} | {counts} | " + " | ".join(cells) + " |"

    for name, summary in report["groups"].items():
        lines.append(row(name, summary))
    lines.append(row("**overall**", report))
    failures = [case for case in report["cases"] if case.get("status") == "failed"]
    if failures:
        lines += ["", "Failed cases:", ""] + [f"- `{case['id']}`: {case['error']}" for case in failures]
    if ragas_summary:
        judge = config.get("judge", {})
        lines += ["", "## Answers (RAGAS)", "",
                  "Judge: " + ", ".join(f"{key}=`{value}`" for key, value in judge.items()) + ".",
                  "Means over cases the judge scored; `n` scored, `err` scoring errors.", ""]
        metrics = ("context_precision", "faithfulness", "response_relevancy")
        lines += ["| Group | cases | " + " | ".join(metrics) + " |", "|---|---|" + "---|" * len(metrics)]
        for name, summary in [*ragas_summary["groups"].items(), ("**overall**", ragas_summary["overall"])]:
            cells = []
            for metric in metrics:
                item = summary[metric]
                mean = "-" if item["mean"] is None else f"{item['mean']:.3f}"
                cells.append(f"{mean} (n={item['n']}, err={item['errors']})")
            lines.append(f"| {name} | {summary['count']} | " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def main():
    import argparse
    import asyncio
    import datetime as dt

    from evaluation.benchmark import run_suite

    parser = argparse.ArgumentParser(description="UDA retrieval (recall/F1/NDCG) and RAGAS evaluation")
    parser.add_argument("--import-evidence", action="store_true",
                        help="Download UDA evidence (network) and write evaluation/uda_evidence.json")
    parser.add_argument("--propose", type=Path, help="Write deterministic, unreviewed mapping proposals (offline)")
    parser.add_argument("--live", action="store_true", help="Allow embedding-provider and OpenAI calls")
    parser.add_argument("--strategy", choices=("dense", "hybrid"), default="hybrid")
    parser.add_argument("--labels", type=Path, default=LABELS)
    parser.add_argument("--allow-unreviewed", action="store_true",
                        help="Score unreviewed mappings; results are marked provisional")
    parser.add_argument("--ragas", action="store_true", help="Also generate answers and score them with RAGAS")
    parser.add_argument("--headers", action="store_true",
                        help="Embed each chunk with its heading path, as production does (own collection)")
    parser.add_argument("--scope", choices=("corpus", "document"), default="corpus",
                        help="Search the whole UDA corpus (default) or only each case's source document, "
                             "as a Conversation pinned to that document would")
    parser.add_argument("--case", help="Run one case id")
    parser.add_argument("--index-path", type=Path, default=RESULTS / "uda-qdrant")
    parser.add_argument("--output", type=Path, help="Run directory (default: evaluation/results/uda-<strategy>-<time>)")
    args = parser.parse_args()

    source = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    if args.import_evidence:
        if EVIDENCE.exists():
            parser.error(f"{EVIDENCE} exists; delete it to re-import")
        evidence = import_evidence(source, fetch_extended(RESULTS / "uda-extended"))
        EVIDENCE.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        LOG.info("Imported evidence for %d cases", len(evidence["cases"]))
        return 0
    evidence = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    chunks, breadcrumbs, headers = load_corpus_with_headers(source)
    if args.propose:
        with args.propose.open("x", encoding="utf-8") as output:
            json.dump(propose_labels(evidence, chunks), output, ensure_ascii=False, indent=2)
        return 0
    if not args.live:
        parser.error("--live is required for network evaluation")

    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    cases = uda_cases(evidence, labels, chunks, allow_unreviewed=args.allow_unreviewed)
    if args.case:
        cases = [case for case in cases if case["id"] == args.case]
        if not cases:
            parser.error("unknown case ID")
    sys.path.insert(0, str(ROOT / "ingest-worker" / "src"))
    from ingest.mytests.eval_support import query_dense, query_hybrid

    client = _local_qdrant(args.index_path)
    collection = COLLECTION_CONTEXT if args.headers else COLLECTION
    dense, sparse, model = prepare_index(client, chunks, labels, args.strategy, headers if args.headers else None)
    documents = {case["id"]: evidence["cases"][case["id"]]["document"] for case in cases}
    config = {"benchmark": "uda", "strategy": args.strategy, "scope": args.scope,
              "collection": f"{collection} (local)", "contextual_headers": args.headers,
              "embedding_model": model, "sparse_model": "Qdrant/bm25" if args.strategy == "hybrid" else None,
              "corpus_version": labels["corpus_version"], "chunker_version": labels["chunker_version"],
              "mapping_method": labels.get("proposal_method"),
              "provisional": any(case["provisional"] for case in cases),
              "excluded_placeholders": len(evidence.get("excluded_placeholders", []))}

    scope_by_question = {case["question"]: documents[case["id"]] for case in cases}
    if args.scope == "document" and len(scope_by_question) != len(cases):
        parser.error("document scope needs distinct question texts")

    def retrieve(question, limit):
        doc_id = scope_by_question[question] if args.scope == "document" else None
        if args.strategy == "dense":
            hits = query_dense(client, collection, dense, question, UID, doc_id=doc_id, limit=limit)
        else:
            hits = query_hybrid(client, collection, dense, sparse, question, UID, doc_id=doc_id, limit=limit)
        return [{"document": hit["metadata"]["docId"], "chunk_index": hit["metadata"]["chunk_index"],
                 "content": hit["content"], "score": hit["score"],
                 "breadcrumb": breadcrumbs.get((hit["metadata"]["docId"], hit["metadata"]["chunk_index"]), "")}
                for hit in hits]

    LOG.info("Running %d UDA cases (%s)", len(cases), args.strategy)
    report = run_suite(cases, retrieve, config)
    ragas_summary, rows = None, None
    if args.ragas:
        from openai import AsyncOpenAI

        from evaluation import ragas_scoring as rs

        openai_client = AsyncOpenAI()
        generation = rs.production_generation_config()
        config["generation"] = generation
        config["judge"] = rs.JUDGE_CONFIG
        rows = asyncio.run(rs.evaluate_answers(
            report["cases"], rs.openai_generator(openai_client, generation["model"], generation["reasoning_effort"]),
            rs.ragas_scorers(openai_client), rs.production_prompt(), generation["top_k"]))
        ragas_summary = rs.aggregate_ragas(rows)

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = args.output or RESULTS / f"uda-{args.strategy}-{args.scope}{'-ctx' if args.headers else ''}-{stamp}"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "retrieval.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if rows is not None:
        from evaluation import ragas_scoring as rs

        (run_dir / "ragas.json").write_text(json.dumps({"summary": ragas_summary, "cases": rows},
                                                       ensure_ascii=False, indent=2), encoding="utf-8")
        (run_dir / "calibration.json").write_text(json.dumps(rs.calibration_sample(rows), ensure_ascii=False,
                                                             indent=2), encoding="utf-8")
    (run_dir / "summary.md").write_text(render_summary(report, ragas_summary), encoding="utf-8")
    LOG.info("Wrote %s: %d cases, %d failed, %d not scored", run_dir, report["count"], report["failed"],
             report["not_scored"])
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    raise SystemExit(main())
