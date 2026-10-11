"""Reranker evaluation: Voyage rerank-3-lite on top of embedding and hybrid retrieval.

Compares four retrieval strategies over the Alphabet Q1 2026 earnings release,
stored in Qdrant with a dense (Voyage) and a sparse (BM25) vector per chunk:
    1. Embedding-only (baseline)              — dense top-k
    2. Embedding + reranker                   — dense top-N, rerank to top-k
    3. Hybrid                                 — dense + BM25 fused with RRF, top-k
    4. Hybrid + reranker                      — hybrid top-N, rerank to top-k

Each strategy feeds its chunks into GPT-4o for a RAG answer, printed next to
the ground truth for manual inspection. Recall@k and NDCG@k are computed
against the google_questions.json ground truth.

Usage:
    cd ingest-worker
    .venv/Scripts/python -m ingest.mytests.test_reranker [--step STEP]

Steps (run all by default):
    write     Chunk the document and write dense + sparse vectors to Qdrant
    eval      Recall@k / NDCG metrics for all four strategies
    rag       Side-by-side RAG answers on the 6 problem questions
"""

import argparse
import json
import os
from pathlib import Path

import numpy as np
import voyageai
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from ingest.chunker import chunk_markdown
from ingest.mytests.eval_support import (
    connect,
    create_dense_embedder,
    create_sparse_embedder,
    ndcg_k,
    query_dense,
    query_hybrid,
    ranked_list_to_relevance,
    recall_k,
    recreate_collection,
    upsert_chunks,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
INGEST_WORKER_DIR = Path(__file__).resolve().parents[3]
SRC_DIR = INGEST_WORKER_DIR / "experimental_results" / "source_files"
DOC_PATH = SRC_DIR / "converted_md" / "2026q1-alphabet-earnings-release.md"
QUESTIONS_PATH = SRC_DIR.parent / "sample_q&a" / "google_questions.json"
RESULTS_PATH = SRC_DIR.parent / "results" / "reranker_eval.xlsx"

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
load_dotenv()
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]  # from DocuLyze/.env (repo root)
VOYAGE_API_KEY = os.environ["VOYAGE_API_KEY"]  # from DocuLyze/.env (repo root)

voyage_client = voyageai.Client(api_key=VOYAGE_API_KEY)
rag_llm = ChatOpenAI(model="gpt-4.1-mini", api_key=OPENAI_API_KEY, temperature=0)

COLLECTION = "eval_reranker"
UID = "tmwang"
DOC_ID = "goog_hybrid"

RERANK_MODEL = "rerank-3-lite"
RETRIEVE_N = 10
FINAL_K = 5

# Column prefix -> label. "embed" keeps the pre-Qdrant column names in the xlsx.
STRATEGIES = {
    "embed": "embed",
    "embed_rerank": "embed+rerank",
    "hybrid": "hybrid",
    "hybrid_rerank": "hybrid+rerank",
}

PROBLEM_QUESTIONS = [
    "What was Alphabet's free cash flow in Q1 2026 and for the trailing twelve months ending Q1 2026?",
    "What was Alphabet's total revenue from the United States in Q1 2026, and how did it compare year-over-year?",
    "How did YouTube ads revenue perform in Q1 2026 compared to Q1 2025?",
    "Where would one contact the investors and media of Alphabet?",
    "What evidence from the Q1 2026 earnings release supports the claim that Alphabet is heavily investing in AI, and what returns are those investments generating?",
    "Summarize Alphabet's overall financial performance in Q1 2026, covering revenue, profitability, and cash generation.",
]


# ---------------------------------------------------------------------------
# Reranker
# ---------------------------------------------------------------------------
def rerank(query: str, documents: list[str], top_k: int = FINAL_K) -> list[dict]:
    """Rerank documents with Voyage rerank-3-lite.

    Returns a list of dicts with keys: index (original position), document, relevance_score.
    """
    if not documents:
        return []
    result = voyage_client.rerank(
        query=query,
        documents=documents,
        model=RERANK_MODEL,
        top_k=top_k,
    )
    return [
        {"index": r.index, "document": r.document, "relevance_score": r.relevance_score}
        for r in result.results
    ]


# ---------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------
def retrieve(client, dense_fn, sparse_fn, question: str, strategy: str, top_k: int = FINAL_K):
    """Run one strategy; returns (chunk ids, chunk texts, scores).

    Reranked strategies fetch RETRIEVE_N candidates first, then keep the top_k
    the reranker scores highest. Scores are cosine (embed), RRF (hybrid), or the
    reranker's relevance score (*_rerank).
    """
    reranked = strategy.endswith("_rerank")
    limit = RETRIEVE_N if reranked else top_k
    if strategy.startswith("hybrid"):
        hits = query_hybrid(client, COLLECTION, dense_fn, sparse_fn, question, UID, DOC_ID, limit=limit)
    else:
        hits = query_dense(client, COLLECTION, dense_fn, question, UID, DOC_ID, limit=limit)

    if reranked:
        order = rerank(question, [h["content"] for h in hits], top_k=top_k)
        hits = [{**hits[r["index"]], "score": r["relevance_score"]} for r in order]

    ids = [h["metadata"]["chunk_index"] for h in hits]
    docs = [h["content"] for h in hits]
    scores = [h["score"] for h in hits]
    return ids, docs, scores


# ---------------------------------------------------------------------------
# RAG answer
# ---------------------------------------------------------------------------
def rag_answer(contexts: list[str], question: str) -> str:
    context_block = "\n\n---\n\n".join(contexts)
    response = rag_llm.invoke([
        SystemMessage(content="Answer the following question based only on the provided context."),
        HumanMessage(content=f"Context:\n{context_block}\n\nQuestion:\n{question}"),
    ])
    return response.content


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _load_questions() -> list[dict]:
    with open(QUESTIONS_PATH, encoding="utf-8") as f:
        return json.load(f)["questions"]


# ===================================================================
# Steps
# ===================================================================
def step_write():
    """Chunk the earnings release and write dense + sparse vectors to Qdrant."""
    chunks = chunk_markdown(DOC_PATH.read_text(encoding="utf-8"))
    contents = [c.content for c in chunks]
    dense = create_dense_embedder()(contents, input_type="document", token_size=[c.tokens for c in chunks])
    sparse = create_sparse_embedder()(contents, input_type="document")

    client = connect()
    recreate_collection(client, COLLECTION)
    written = upsert_chunks(client, COLLECTION, UID, DOC_ID, chunks, dense, sparse)
    print(f"Wrote {written} chunks (dense + sparse) to Qdrant collection '{COLLECTION}' (docId={DOC_ID})")


def step_eval():
    """Recall@k / NDCG evaluation across all questions in google_questions.json."""
    import openpyxl

    questions = _load_questions()
    client = connect()
    dense_fn = create_dense_embedder()
    sparse_fn = create_sparse_embedder()
    K_VALUES = [1, 3, 5]
    results = []

    print(f"Evaluating {len(questions)} questions: {' vs '.join(STRATEGIES.values())}")
    print(f"Reranker: {RERANK_MODEL} | Retrieve N={RETRIEVE_N} -> Final K={FINAL_K}\n")

    for q in questions:
        relevance = ranked_list_to_relevance(q["relevant_chunks"])

        row = {
            "id": q["id"],
            "question": q["question"],
            "ground_truth_answer": q.get("ground_truth_answer", ""),
            "difficulty": q["difficulty"],
            "type": q["type"],
            "relevant_chunks": str(q["relevant_chunks"]),
        }
        retrieved = {}
        for s in STRATEGIES:
            ids, _, _ = retrieve(client, dense_fn, sparse_fn, q["question"], s, top_k=max(K_VALUES))
            retrieved[s] = ids
            row[f"{s}_retrieved"] = str(ids)

        for k in K_VALUES:
            for s, ids in retrieved.items():
                row[f"{s}_recall@{k}"] = round(recall_k(ids, relevance, k), 4)
                row[f"{s}_ndcg@{k}"] = round(ndcg_k(ids, relevance, k), 4)

        results.append(row)

        base = row["embed_recall@3"]
        cells = [f"embed r@3={base:.3f}"] + [
            f"{label} r@3={row[f'{s}_recall@3']:.3f} ({row[f'{s}_recall@3'] - base:+.3f})"
            for s, label in STRATEGIES.items()
            if s != "embed"
        ]
        print(f"{q['id']:16s} " + "  ".join(cells))

    # Aggregates
    print("\n" + "=" * 100)
    print("AGGREGATE COMPARISON")
    print("=" * 100)
    for k in K_VALUES:
        means = {
            s: (np.mean([r[f"{s}_recall@{k}"] for r in results]), np.mean([r[f"{s}_ndcg@{k}"] for r in results]))
            for s in STRATEGIES
        }
        print(f"  @{k}:  " + "  |  ".join(
            f"{label} recall={means[s][0]:.4f} ndcg={means[s][1]:.4f}" for s, label in STRATEGIES.items()
        ))
        base_recall, base_ndcg = means["embed"]
        print("       delta vs embed:  " + "  ".join(
            f"{label} recall={means[s][0] - base_recall:+.4f} ndcg={means[s][1] - base_ndcg:+.4f}"
            for s, label in STRATEGIES.items()
            if s != "embed"
        ))

    # Difficulty breakdown
    for diff in ["easy", "medium", "hard"]:
        subset = [r for r in results if r["difficulty"] == diff]
        if not subset:
            continue
        r3 = {s: np.mean([r[f"{s}_recall@3"] for r in subset]) for s in STRATEGIES}
        print(
            f"  {diff:8s} ({len(subset):2d}q): "
            + "  ".join(f"{label} r@3={r3[s]:.4f}" for s, label in STRATEGIES.items())
        )

    # Write to Excel
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Reranker Eval"
    fieldnames = list(results[0].keys())
    ws.append(fieldnames)
    for row in results:
        ws.append([row[f] for f in fieldnames])
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(RESULTS_PATH))
    print(f"\nResults written to {RESULTS_PATH}")


def step_rag():
    """RAG answer comparison on the 6 problem questions, one answer per strategy."""
    client = connect()
    dense_fn = create_dense_embedder()
    sparse_fn = create_sparse_embedder()
    questions_by_text = {q["question"]: q for q in _load_questions()}

    for question in PROBLEM_QUESTIONS:
        q = questions_by_text.get(question)
        ground_truth = q.get("ground_truth_answer") if q else None

        print("=" * 100)
        print(f"Q: {question}\n")
        if ground_truth:
            print(f"  GROUND TRUTH: {ground_truth}\n")
        else:
            print("  GROUND TRUTH: (not in google_questions.json — question text mismatch?)\n")

        contexts = {}
        for s, label in STRATEGIES.items():
            ids, docs, scores = retrieve(client, dense_fn, sparse_fn, question, s, top_k=FINAL_K)
            contexts[s] = docs
            print(f"  {label + ' chunks:':22s} {ids}  scores={[round(x, 3) for x in scores]}")

        for s, label in STRATEGIES.items():
            print(f"\n  --- {label.upper()} ANSWER ---")
            print(f"  {rag_answer(contexts[s], question)}")
        print()


# ===================================================================
# CLI
# ===================================================================
STEPS = {
    "write": step_write,
    "eval": step_eval,
    "rag": step_rag,
}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reranker evaluation pipeline (rerank-3-lite)")
    parser.add_argument(
        "--step",
        choices=list(STEPS.keys()),
        nargs="+",
        default=list(STEPS.keys()),
        help="Steps to run (default: all)",
    )
    args = parser.parse_args()

    for step_name in args.step:
        print(f"\n{'#' * 80}")
        print(f"# STEP: {step_name}")
        print(f"{'#' * 80}\n")
        STEPS[step_name]()
