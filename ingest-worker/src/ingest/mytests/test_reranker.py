"""Reranker evaluation: Voyage rerank-3-lite on top of embedding retrieval.

Compares two retrieval strategies across the 6 problem questions:
    1. Embedding-only (baseline)              — top-k from Chroma
    2. Embedding + reranker                   — retrieve top-N, rerank to top-k

Each strategy feeds its chunks into GPT-4o for a RAG answer, printed next to
the ground truth for manual inspection. Recall@k and NDCG@k are computed
against the google_questions.json ground truth.

Usage:
    cd ingest-worker
    .venv/Scripts/python -m ingest.mytests.test_reranker [--step STEP]

Steps (run all by default):
    eval      Recall@k / NDCG metrics: embedding vs reranked
    rag       Side-by-side RAG answers on the 6 problem questions
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import chromadb
import voyageai
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from ingest.config import embedding_model
from ingest.mytests.test_hybrid_retrieval import (
    OPENAI_API_KEY,
    VOYAGE_API_KEY,
    UID,
    DOC_ID,
    create_embed_fn,
    query_embedding_only,
    # hybrid_query,
    ranked_list_to_relevance,
    recall_k,
    ndcg_k,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
INGEST_WORKER_DIR = Path(__file__).resolve().parents[3]
SRC_DIR = INGEST_WORKER_DIR / "experimental_results" / "source_files"
QUESTIONS_PATH = SRC_DIR.parent / "sample_q&a" / "google_questions.json"
RESULTS_PATH = SRC_DIR.parent / "results" / "reranker_eval.xlsx"

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
voyage_client = voyageai.Client(api_key=VOYAGE_API_KEY)
chroma_client = chromadb.HttpClient(host="127.0.0.1", port=8000)
rag_llm = ChatOpenAI(model="gpt-4.1-mini", api_key=OPENAI_API_KEY, temperature=0)

RERANK_MODEL = "rerank-3-lite"
RETRIEVE_N = 10
FINAL_K = 5

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
# Retrieval strategies
# ---------------------------------------------------------------------------
def retrieve_embedding_only(embed_fn, question: str, top_k: int = FINAL_K):
    """Pure embedding retrieval (baseline)."""
    meta, dist, docs = query_embedding_only(
        chroma_client, embed_fn, question, uid=UID, doc_id=DOC_ID, top_k=top_k,
    )
    ids = [m["chunk_index"] for m in meta]
    return ids, docs, dist


def retrieve_embedding_reranked(embed_fn, question: str, retrieve_n: int = RETRIEVE_N, final_k: int = FINAL_K):
    """Retrieve top-N by embedding, rerank to top-k."""
    meta, dist, docs = query_embedding_only(
        chroma_client, embed_fn, question, uid=UID, doc_id=DOC_ID, top_k=retrieve_n,
    )
    reranked = rerank(question, docs, top_k=final_k)
    reranked_ids = [meta[r["index"]]["chunk_index"] for r in reranked]
    reranked_docs = [r["document"] for r in reranked]
    reranked_scores = [r["relevance_score"] for r in reranked]
    return reranked_ids, reranked_docs, reranked_scores


# def retrieve_hybrid_reranked(embed_fn, question: str, retrieve_n: int = RETRIEVE_N, final_k: int = FINAL_K):
#     """Hybrid (NER-filtered + fallback) retrieve top-N, then rerank to top-k."""
#     h_meta, h_dist, h_docs, h_strategy, h_ner = hybrid_query(
#         chroma_client, embed_fn, question, uid=UID, doc_id=DOC_ID, n_results=retrieve_n,
#     )
#     reranked = rerank(question, h_docs, top_k=final_k)
#     reranked_ids = [h_meta[r["index"]]["chunk_index"] for r in reranked]
#     reranked_docs = [r["document"] for r in reranked]
#     reranked_scores = [r["relevance_score"] for r in reranked]
#     return reranked_ids, reranked_docs, reranked_scores, h_strategy, h_ner


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
def step_eval():
    """Recall@k / NDCG evaluation across all questions in google_questions.json."""
    import openpyxl

    questions = _load_questions()
    embed_fn = create_embed_fn()
    K_VALUES = [1, 3, 5]
    results = []

    print(f"Evaluating {len(questions)} questions: embedding vs embedding+rerank")
    print(f"Reranker: {RERANK_MODEL} | Retrieve N={RETRIEVE_N} → Final K={FINAL_K}\n")

    for q in questions:
        relevance = ranked_list_to_relevance(q["relevant_chunks"])

        # 1. Embedding only
        e_ids, e_docs, e_dist = retrieve_embedding_only(embed_fn, q["question"], top_k=max(K_VALUES))

        # 2. Embedding + rerank
        er_ids, er_docs, er_scores = retrieve_embedding_reranked(
            embed_fn, q["question"], retrieve_n=RETRIEVE_N, final_k=max(K_VALUES),
        )

        row = {
            "id": q["id"],
            "question": q["question"],
            "ground_truth_answer": q.get("ground_truth_answer", ""),
            "difficulty": q["difficulty"],
            "type": q["type"],
            "relevant_chunks": str(q["relevant_chunks"]),
            "embed_retrieved": str(e_ids),
            "embed_rerank_retrieved": str(er_ids),
        }

        for k in K_VALUES:
            row[f"embed_recall@{k}"] = round(recall_k(e_ids, relevance, k), 4)
            row[f"embed_ndcg@{k}"] = round(ndcg_k(e_ids, relevance, k), 4)
            row[f"embed_rerank_recall@{k}"] = round(recall_k(er_ids, relevance, k), 4)
            row[f"embed_rerank_ndcg@{k}"] = round(ndcg_k(er_ids, relevance, k), 4)

        results.append(row)

        r3_e = row["embed_recall@3"]
        r3_er = row["embed_rerank_recall@3"]
        print(
            f"{q['id']:16s} "
            f"embed r@3={r3_e:.3f}  "
            f"embed+rerank r@3={r3_er:.3f} ({r3_er - r3_e:+.3f})"
        )

    # Aggregates
    print("\n" + "=" * 100)
    print("AGGREGATE COMPARISON")
    print("=" * 100)
    for k in K_VALUES:
        e_recall = np.mean([r[f"embed_recall@{k}"] for r in results])
        e_ndcg = np.mean([r[f"embed_ndcg@{k}"] for r in results])
        er_recall = np.mean([r[f"embed_rerank_recall@{k}"] for r in results])
        er_ndcg = np.mean([r[f"embed_rerank_ndcg@{k}"] for r in results])
        print(
            f"  @{k}:  embed recall={e_recall:.4f} ndcg={e_ndcg:.4f}  |  "
            f"embed+rerank recall={er_recall:.4f} ndcg={er_ndcg:.4f}"
        )
        print(
            f"       delta vs embed:  "
            f"rerank recall={er_recall - e_recall:+.4f} ndcg={er_ndcg - e_ndcg:+.4f}"
        )

    # Difficulty breakdown
    for diff in ["easy", "medium", "hard"]:
        subset = [r for r in results if r["difficulty"] == diff]
        if not subset:
            continue
        e_r3 = np.mean([r["embed_recall@3"] for r in subset])
        er_r3 = np.mean([r["embed_rerank_recall@3"] for r in subset])
        print(
            f"  {diff:8s} ({len(subset):2d}q): "
            f"embed r@3={e_r3:.4f}  "
            f"embed+rerank r@3={er_r3:.4f} ({er_r3 - e_r3:+.4f})"
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
    """RAG answer comparison on the 6 problem questions: no-rerank vs reranked."""
    embed_fn = create_embed_fn()
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

        # 1. Embedding only (baseline)
        e_ids, e_docs, _ = retrieve_embedding_only(embed_fn, question, top_k=FINAL_K)
        print(f"  Embedding chunks:         {e_ids}")

        # 2. Embedding + rerank
        er_ids, er_docs, er_scores = retrieve_embedding_reranked(embed_fn, question)
        print(f"  Embed+Rerank chunks:      {er_ids}  scores={[round(s, 3) for s in er_scores]}")

        print(f"\n  --- EMBEDDING-ONLY ANSWER ---")
        print(f"  {rag_answer(e_docs, question)}")

        print(f"\n  --- EMBEDDING + RERANK ANSWER ---")
        print(f"  {rag_answer(er_docs, question)}")
        print()


# ===================================================================
# CLI
# ===================================================================
STEPS = {
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
