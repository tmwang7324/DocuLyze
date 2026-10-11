"""Hybrid retrieval test: GPT-4.1 NER + embedding similarity with fallback.

Implements the pipeline from issue #42 as a standalone script (moved out of
test.ipynb to avoid kernel crashes on long API calls).

Usage:
    cd ingest-worker
    .venv/Scripts/python -m ingest.mytests.test_hybrid_retrieval [--step STEP]

Steps (run all by default):
    ner       Extract entities from the full document via GPT-4.1
    write     Chunk + assign entities + write to ChromaDB with ner_* metadata
    eval      Run recall@k / NDCG evaluation: hybrid vs pure embedding
    rag       RAG answer comparison on problem questions
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
import chromadb
import voyageai
from openai import OpenAI
from langchain_openai import ChatOpenAI

from ingest.chunker import chunk_markdown
from ingest.config import embedding_model
from pydantic import BaseModel
from dotenv import load_dotenv
# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
INGEST_WORKER_DIR = Path(__file__).resolve().parents[3]
SRC_DIR = INGEST_WORKER_DIR / "experimental_results" / "source_files"
DOC_PATH = SRC_DIR / "converted_md" / "2026q1-alphabet-earnings-release.md"
QUESTIONS_PATH = SRC_DIR.parent / "sample_q&a" / "google_questions.json"
RESULTS_PATH = SRC_DIR.parent / "sample_q&a" / "hybrid_vs_embedding_eval.xlsx"

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
load_dotenv()
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]  # from DocuLyze/.env (repo root)
VOYAGE_API_KEY = os.environ["VOYAGE_API_KEY"]  # from DocuLyze/.env (repo root)
class Entities(BaseModel):
    persons: list[str]
    orgs: list[str]
    locations: list[str]
    dates: list[str]
    products: list[str]
    concepts: list[str]


ner_client = ChatOpenAI(
    model="gpt-4.1-mini",
    api_key=OPENAI_API_KEY,
    response_format = Entities,
    temperature=0
)

voyage_client = voyageai.Client(api_key=VOYAGE_API_KEY)
chroma_client = chromadb.HttpClient(host="127.0.0.1", port=8000)





UID = "tmwang"
DOC_ID = "goog_hybrid"

# ---------------------------------------------------------------------------
# NER
# ---------------------------------------------------------------------------
NER_SYSTEM_PROMPT = """You are a named entity extractor. Extract entities from the provided text.
Return ONLY a JSON object with these keys:
- persons: list of person names
- orgs: list of organization names
- locations: list of geographic locations
- dates: list of date/time expressions
- products: list of product names that belong to an organization. For example: iPhone, Windows, Tesla Model S, Gemini
- concepts: list of technical terms, domain-specific terminology, key topics. For example, machine learning, blockchain, quantum computing, insulin, acetone

Rules:
- Only extract entities explicitly present in the text
- Do not infer or generate entities not in the text
- Include entities found in tables, headers, and structured content
- Return empty lists if no entities of that type are found"""

NER_FIELD_MAP = {
    "persons": "ner_persons",
    "orgs": "ner_orgs",
    "locations": "ner_locations",
    "dates": "ner_dates",
    "products": "ner_products",
    "concepts": "ner_concepts",
}

email_re = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
phone_re = re.compile(r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}")

def gpt_ner(text: str) -> dict:
    """Run NER via GPT-4 (LangChain OpenAI wrapper)."""
    prompt = f"{NER_SYSTEM_PROMPT}\n\nUser text:\n{text}\n\nExtract named entities from the text above. Return ONLY a JSON object."
    response = ner_client.invoke([{"role": "user", "content": prompt}])
    content = response.content
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        print("Failed to decode JSON response:")
        print(content)
        return {}

def normalize_entities(raw: dict) -> dict:
    result = {}
    for label in NER_FIELD_MAP:
        seen = set()
        normed = []
        for item in raw.get(label, []):
            clean = item.strip().lower()
            if label == "dates" and len(clean) < 6:
                continue
            if clean not in seen:
                seen.add(clean)
                normed.append(clean)
        result[label] = normed
    return result


def extract_contacts(text: str) -> list[str]:
    emails = email_re.findall(text)
    phones = phone_re.findall(text)
    return list(set(e.lower().strip() for e in emails + phones))


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------
def create_embed_fn():
    model = embedding_model()
    print(f"Voyage embedding model: {model}")

    def embed(texts: list[str], token_size: list[int] | None = None, input_type: str = "document") -> list[list[float]]:
        if token_size and sum(token_size) > 1_000_000:
            print(f"WARNING: total token size {sum(token_size)} exceeds 1M limit")
            return []
        return voyage_client.embed(texts, model=model, input_type=input_type).embeddings

    return embed


# ---------------------------------------------------------------------------
# Entity-to-chunk assignment
# ---------------------------------------------------------------------------
def assign_entities_to_chunks(entities: dict, contacts: list[str], chunks: list) -> list[dict]:
    chunk_entity_list = []
    for chunk in chunks:
        chunk_lower = chunk.content.lower()
        assigned = {}
        for label, field in NER_FIELD_MAP.items():
            matches = [e for e in entities.get(label, []) if e in chunk_lower]
            if matches:
                assigned[field] = ",".join(matches)
        contact_matches = [c for c in contacts if c.lower() in chunk_lower]
        if contact_matches:
            assigned["ner_contacts"] = ",".join(contact_matches)
        chunk_entity_list.append(assigned)
    return chunk_entity_list


# ---------------------------------------------------------------------------
# ChromaDB write with NER metadata
# ---------------------------------------------------------------------------
def write_chunks_with_ner(client, embed_fn, uid: str, doc_id: str, chunks, chunk_ner: list[dict]):
    coll = client.get_or_create_collection("chunks")
    coll.delete(where={"$and": [{"userId": uid}, {"docId": doc_id}]})

    contents = [c.content for c in chunks]
    token_sizes = [c.tokens for c in chunks]
    embeddings = embed_fn(contents, token_size=token_sizes, input_type="document")

    model = embedding_model()
    metadatas = []
    for idx, c in enumerate(chunks):
        meta = {
            "userId": uid,
            "docId": doc_id,
            "chunk_index": idx,
            "token_count": c.tokens,
            "embedding_model": model,
            "breadcrumb": c.breadcrumb(),
            "ner_persons": "",
            "ner_orgs": "",
            "ner_locations": "",
            "ner_dates": "",
            "ner_concepts": "",
            "ner_contacts": "",
        }
        meta.update(chunk_ner[idx])
        metadatas.append(meta)

    coll.add(
        ids=[f"{uid}/{doc_id}/{idx}" for idx in range(len(chunks))],
        embeddings=embeddings,
        documents=contents,
        metadatas=metadatas,
    )
    return metadatas


# ---------------------------------------------------------------------------
# Query functions
# ---------------------------------------------------------------------------
def query_embedding_only(client, embed_fn, user_query: str, uid: str, top_k: int = 5, doc_id: str | None = None):
    """Pure embedding similarity query (baseline), scoped to one user/doc like hybrid_query."""
    coll = client.get_collection("chunks")
    embeddings = embed_fn([user_query], token_size=[len(user_query.split())], input_type="query")
    base_filters = [{"userId": uid}]
    if doc_id:
        base_filters.append({"docId": doc_id})
    where = {"$and": base_filters} if len(base_filters) > 1 else base_filters[0]
    res = coll.query(
        query_embeddings=embeddings,
        n_results=top_k,
        where=where,
        include=["metadatas", "distances", "documents"],
    )
    return res["metadatas"][0], res["distances"][0], res["documents"][0]


def hybrid_query(
    client,
    embed_fn,
    user_query: str,
    uid: str,
    n_results: int = 5,
    doc_id: str | None = None,
    verbose: bool = False,
):
    """Hybrid retrieval: entity-filtered first, embedding-only fallback.

    1. Extract entities from the query via GPT-4.1 NER + regex contacts.
    2. Build a Chroma where clause: userId AND ($or across entity $contains filters).
    3. If the filtered query returns >= n_results, return those.
    4. Otherwise fall back to pure embedding similarity (one extra Chroma call).
    """
    coll = client.get_collection("chunks")

    query_entities = normalize_entities(gpt_ner(user_query))
    query_contacts = extract_contacts(user_query)

    entity_filters = []
    for label, field in NER_FIELD_MAP.items():
        for entity in query_entities.get(label, []):
            entity_filters.append({field: {"$contains": entity}})
    for contact in query_contacts:
        entity_filters.append({"ner_contacts": {"$contains": contact}})

    extracted_summary = {k: v for k, v in query_entities.items() if v}
    if query_contacts:
        extracted_summary["contacts"] = query_contacts

    embeddings = embed_fn([user_query], token_size=[len(user_query.split())], input_type="query")

    base_filters = [{"userId": uid}]
    if doc_id:
        base_filters.append({"docId": doc_id})

    filtered_results = None
    if entity_filters:
        or_clause = entity_filters[0] if len(entity_filters) == 1 else {"$or": entity_filters}
        where = {"$and": base_filters + [or_clause]}
        try:
            filtered_results = coll.query(
                query_embeddings=embeddings,
                n_results=n_results,
                where=where,
                include=["metadatas", "distances", "documents"],
            )
        except Exception as e:
            if verbose:
                print(f"  Entity-filtered query failed: {e}")

    if filtered_results and len(filtered_results["documents"][0]) >= n_results:
        if verbose:
            print(f"  FILTERED: {len(filtered_results['documents'][0])} results | entities={extracted_summary}")
        return (
            filtered_results["metadatas"][0],
            filtered_results["distances"][0],
            filtered_results["documents"][0],
            "filtered",
            extracted_summary,
        )

    where_fallback = {"$and": base_filters} if len(base_filters) > 1 else base_filters[0]
    fallback_results = coll.query(
        query_embeddings=embeddings,
        n_results=n_results,
        where=where_fallback,
        include=["metadatas", "distances", "documents"],
    )

    n_filtered = len(filtered_results["documents"][0]) if filtered_results else 0
    if entity_filters and verbose:
        print(f"  FALLBACK: entity-filtered returned {n_filtered}/{n_results} | entities={extracted_summary}")
    elif verbose:
        print(f"  EMBEDDING-ONLY: no entities extracted from query")

    strategy = "fallback" if entity_filters else "embedding_only"
    return (
        fallback_results["metadatas"][0],
        fallback_results["distances"][0],
        fallback_results["documents"][0],
        strategy,
        extracted_summary,
    )


# ---------------------------------------------------------------------------
# Metrics (same as test.ipynb)
# ---------------------------------------------------------------------------
def ranked_list_to_relevance(ordered_chunks: list[int]) -> dict[int, int]:
    n = len(ordered_chunks)
    return {chunk_id: n - i for i, chunk_id in enumerate(ordered_chunks)}


def recall_k(retrieved_ids: list[int], relevant_ids: dict[int, int], k: int) -> float:
    retrieved_at_k = retrieved_ids[:k]
    relevant_retrieved = [i for i in retrieved_at_k if i in relevant_ids]
    return len(relevant_retrieved) / len(relevant_ids) if relevant_ids else 0.0


def ndcg_k(retrieved_ids: list[int], relevant_ids: dict[int, int], k: int) -> float:
    retrieved_at_k = retrieved_ids[:k]
    dcg = 0.0
    for i, rid in enumerate(retrieved_at_k):
        if rid in relevant_ids:
            dcg += relevant_ids[rid] / np.log2(i + 2)
    sorted_relevances = sorted(relevant_ids.values(), reverse=True)
    ideal_dcg = 0.0
    for i in range(min(len(sorted_relevances), k)):
        ideal_dcg += sorted_relevances[i] / np.log2(i + 2)
    return dcg / ideal_dcg if ideal_dcg > 0 else 0.0


# ===================================================================
# Steps
# ===================================================================
def step_ner():
    """Step 1: Extract entities from the full document via GPT-4.1-mini."""
    full_text = DOC_PATH.read_text(encoding="utf-8")
    print(f"Document: {DOC_PATH.name} ({len(full_text)} chars)")
    print("Extracting entities with GPT-4.1...")

    raw_entities = gpt_ner(full_text)
    entities = normalize_entities(raw_entities)
    contacts = extract_contacts(full_text)

    print("\nExtracted entities:")
    for label, items in entities.items():
        print(f"  {label} ({len(items)}): {items[:8]}{'...' if len(items) > 8 else ''}")
    print(f"  contacts ({len(contacts)}): {contacts}")

    # Cache to disk so later steps don't re-call the API
    cache_path = SRC_DIR.parent / "sample_q&a" / "gpt41_ner_cache.json"
    with open(cache_path, "w") as f:
        json.dump({"entities": entities, "contacts": contacts}, f, indent=2)
    print(f"\nCached NER results to {cache_path}")
    return entities, contacts


def _load_ner_cache():
    cache_path = SRC_DIR.parent / "sample_q&a" / "gpt41_ner_cache.json"
    if not cache_path.exists():
        print(f"NER cache not found at {cache_path} — run the 'ner' step first.")
        sys.exit(1)
    with open(cache_path) as f:
        data = json.load(f)
    return data["entities"], data["contacts"]


def step_write():
    """Step 2: Chunk + assign entities + write to ChromaDB with ner_* metadata."""
    entities, contacts = _load_ner_cache()
    full_text = DOC_PATH.read_text(encoding="utf-8")

    chunks = chunk_markdown(full_text)
    
    chunk_ner = assign_entities_to_chunks(entities, contacts, chunks)

    print(f"Chunk entity assignment ({len(chunks)} chunks):")
    for idx, (chunk, ner) in enumerate(zip(chunks, chunk_ner)):
        ner_summary = {k.replace("ner_", ""): v for k, v in ner.items() if v}
        if ner_summary:
            print(f"  Chunk {idx} ({chunk.tokens}t): {ner_summary}")
        else:
            print(f"  Chunk {idx} ({chunk.tokens}t): (no entities)")

    embed_fn = create_embed_fn()
    stored = write_chunks_with_ner(chroma_client, embed_fn, UID, DOC_ID, chunks, chunk_ner)
    print(f"\nWrote {len(stored)} chunks with NER metadata to ChromaDB (docId={DOC_ID})")


def _load_questions() -> list[dict]:
    with open(QUESTIONS_PATH, encoding="utf-8") as f:
        return json.load(f)["questions"]


def step_eval():
    """Step 3: Recall@k / NDCG evaluation — hybrid vs pure embedding."""
    import openpyxl

    with open(QUESTIONS_PATH) as f:
        google_data = json.load(f)

    embed_fn = create_embed_fn()
    K_VALUES = [1, 3, 5]
    results = []

    print(f"Running {len(google_data['questions'])} questions through hybrid + pure-embedding...\n")

    for q in google_data["questions"]:
        relevance = ranked_list_to_relevance(q["relevant_chunks"])

        h_meta, h_dist, h_docs, h_strategy, h_ner = hybrid_query(
            chroma_client, embed_fn, q["question"], uid=UID, doc_id=DOC_ID, n_results=max(K_VALUES),
        )
        h_ids = [m["chunk_index"] for m in h_meta]

        e_meta, e_dist, e_docs = query_embedding_only(
            chroma_client, embed_fn, q["question"], uid=UID, doc_id=DOC_ID, top_k=max(K_VALUES)
        )
        e_ids = [m["chunk_index"] for m in e_meta]

        row = {
            "id": q["id"],
            "question": q["question"],
            "ground_truth_answer": q.get("ground_truth_answer", ""),
            "difficulty": q["difficulty"],
            "type": q["type"],
            "relevant_chunks": str(q["relevant_chunks"]),
            "hybrid_retrieved": str(h_ids),
            "hybrid_strategy": h_strategy,
            "hybrid_entities": str(h_ner),
            "embedding_retrieved": str(e_ids),
        }
        for k in K_VALUES:
            row[f"hybrid_recall@{k}"] = round(recall_k(h_ids, relevance, k), 4)
            row[f"hybrid_ndcg@{k}"] = round(ndcg_k(h_ids, relevance, k), 4)
            row[f"embed_recall@{k}"] = round(recall_k(e_ids, relevance, k), 4)
            row[f"embed_ndcg@{k}"] = round(ndcg_k(e_ids, relevance, k), 4)

        results.append(row)

        r3_delta = row["hybrid_recall@3"] - row["embed_recall@3"]
        marker = "+" if r3_delta > 0 else ("-" if r3_delta < 0 else "=")
        print(
            f"{q['id']:16s} [{h_strategy:14s}] "
            f"hybrid r@3={row['hybrid_recall@3']:.3f}  embed r@3={row['embed_recall@3']:.3f}  "
            f"delta={r3_delta:+.3f} {marker}"
        )

    print("\n" + "=" * 80)
    print("AGGREGATE COMPARISON")
    print("=" * 80)
    for k in K_VALUES:
        h_recall = np.mean([r[f"hybrid_recall@{k}"] for r in results])
        h_ndcg = np.mean([r[f"hybrid_ndcg@{k}"] for r in results])
        e_recall = np.mean([r[f"embed_recall@{k}"] for r in results])
        e_ndcg = np.mean([r[f"embed_ndcg@{k}"] for r in results])
        print(
            f"  @{k}:  hybrid recall={h_recall:.4f} ndcg={h_ndcg:.4f}  |  "
            f"embed recall={e_recall:.4f} ndcg={e_ndcg:.4f}  |  "
            f"delta recall={h_recall - e_recall:+.4f} ndcg={h_ndcg - e_ndcg:+.4f}"
        )

    strategies = {}
    for r in results:
        s = r["hybrid_strategy"]
        strategies[s] = strategies.get(s, 0) + 1
    print(f"\nStrategy distribution: {strategies}")

    for diff in ["easy", "medium", "hard"]:
        subset = [r for r in results if r["difficulty"] == diff]
        if not subset:
            continue
        h_r3 = np.mean([r["hybrid_recall@3"] for r in subset])
        e_r3 = np.mean([r["embed_recall@3"] for r in subset])
        print(f"  {diff:8s} ({len(subset):2d}q): hybrid r@3={h_r3:.4f}  embed r@3={e_r3:.4f}  delta={h_r3 - e_r3:+.4f}")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Hybrid vs Embedding"
    fieldnames = list(results[0].keys())
    ws.append(fieldnames)
    for row in results:
        ws.append([row[f] for f in fieldnames])
    wb.save(str(RESULTS_PATH))
    print(f"\nResults written to {RESULTS_PATH}")


def step_rag():
    """Step 4: RAG answer comparison on problem questions."""
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, SystemMessage

    rag_llm = ChatOpenAI(model="gpt-4o", api_key=OPENAI_API_KEY, temperature=0)
    embed_fn = create_embed_fn()

    problem_question_texts = [
        "What was Alphabet's free cash flow in Q1 2026 and for the trailing twelve months ending Q1 2026?",
        "What was Alphabet's total revenue from the United States in Q1 2026, and how did it compare year-over-year?",
        "How did YouTube ads revenue perform in Q1 2026 compared to Q1 2025?",
        "Where would one contact the investors and media of Alphabet?",
        "What evidence from the Q1 2026 earnings release supports the claim that Alphabet is heavily investing in AI, and what returns are those investments generating?",
        "Summarize Alphabet's overall financial performance in Q1 2026, covering revenue, profitability, and cash generation."

    ]

    questions_by_text = {q["question"]: q for q in _load_questions()}

    def rag_answer(contexts: list[str], question: str) -> str:
        context_block = "\n\n---\n\n".join(contexts)
        response = rag_llm.invoke([
            SystemMessage(content="Answer the following question based only on the provided context."),
            HumanMessage(content=f"Context:\n{context_block}\n\nQuestion:\n{question}"),
        ])
        return response.content

    for question in problem_question_texts:
        q = questions_by_text.get(question)
        ground_truth = q.get("ground_truth_answer") if q else None

        print("=" * 90)
        print(f"Q: {question}\n")
        if ground_truth:
            print(f"  GROUND TRUTH: {ground_truth}\n")
        else:
            print("  GROUND TRUTH: (not found in google_questions.json — question text mismatch?)\n")

        h_meta, h_dist, h_docs, h_strategy, h_ner = hybrid_query(
            chroma_client, embed_fn, question, uid=UID, doc_id=DOC_ID, verbose=True,
        )
        h_ids = [m["chunk_index"] for m in h_meta]

        e_meta, e_dist, e_docs = query_embedding_only(
            chroma_client, embed_fn, question, uid=UID, doc_id=DOC_ID, top_k=5
        )
        e_ids = [m["chunk_index"] for m in e_meta]

        print(f"\n  Hybrid chunks:    {h_ids} (strategy={h_strategy})")
        print(f"  Embedding chunks: {e_ids}")

        print(f"\n  --- HYBRID ANSWER ---")
        print(f"  {rag_answer(h_docs, question)}")

        print(f"\n  --- EMBEDDING-ONLY ANSWER ---")
        print(f"  {rag_answer(e_docs, question)}")
        print()


# ===================================================================
# CLI
# ===================================================================
STEPS = {
    "ner": step_ner,
    "write": step_write,
    "eval": step_eval,
    "rag": step_rag,
}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Hybrid retrieval test pipeline")
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
