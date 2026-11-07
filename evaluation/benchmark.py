"""Run retrieval cases against reviewed Reference Passage mappings."""

import math
import time


def google_cases(source, labels, corpus=None):
    if not labels.get("corpus_version") or not labels.get("chunker_version"):
        raise ValueError("Corpus and chunker versions are required")
    corpus_lookup = {(chunk["document"], chunk["chunk_index"]): chunk["content"] for chunk in corpus} if corpus is not None else None
    cases = []
    for question in source["questions"]:
        label = labels.get("cases", {}).get(question["id"])
        if not label or not isinstance(label.get("reviewed_by"), str) or not label["reviewed_by"].strip():
            raise ValueError(f"Missing human review for {question['id']}")
        passages = label.get("reference_passages", [])
        if not passages or any(not item.get("id") or not item.get("text") for item in passages):
            raise ValueError(f"Missing Reference Passages for {question['id']}")
        ids = [item["id"] for item in passages]
        if len(set(ids)) != len(ids):
            raise ValueError(f"Duplicate Reference Passage ids for {question['id']}")
        mapping = {}
        passage_texts = {item["id"]: item["text"] for item in passages}
        for chunk in label.get("chunks", []):
            key = (chunk["document"], chunk["chunk_index"])
            if key in mapping or not chunk["passage_ids"] or not set(chunk["passage_ids"]) <= set(ids):
                raise ValueError(f"Invalid mapping for {question['id']}")
            if corpus_lookup is not None and (key not in corpus_lookup or any(
                passage_texts[passage_id] not in corpus_lookup[key] for passage_id in chunk["passage_ids"]
            )):
                raise ValueError(f"Reference Passage is not present in mapped corpus chunk for {question['id']}")
            mapping[key] = chunk["passage_ids"]
        if not mapping or set().union(*map(set, mapping.values())) != set(ids):
            raise ValueError(f"Incomplete mapping for {question['id']}")
        cases.append({"id": question["id"], "question": question["question"],
                      "reference_passages": ids, "reference_data": passages,
                      "reference_answer": question.get("ground_truth_answer"),
                      "reviewed_by": label["reviewed_by"], "mapping": mapping})
    return cases


def run_case(case, retrieve, config):
    references = set(case["reference_passages"])
    if not references:
        raise ValueError("A retrieval case needs at least one Reference Passage")
    mapping = case["mapping"]
    start = time.monotonic()
    try:
        chunks = list(retrieve(case["question"], 8))
    except Exception as exc:
        return {"id": case["id"], "config": config, "error": f"Retrieval failed ({type(exc).__name__})",
                "latency_seconds": time.monotonic() - start}

    metrics = {}
    relevant_count = sum(bool(set(passages) & references) for passages in mapping.values())
    for k in (3, 5, 8):
        seen_passages = set()
        seen_chunks = set()
        relevant_chunks = 0
        dcg = 0.0
        for rank, chunk in enumerate(chunks[:k]):
            key = (chunk["document"], chunk["chunk_index"])
            passages = set(mapping.get(key, ())) & references
            if key in seen_chunks:
                passages = set()
            seen_chunks.add(key)
            if passages:
                relevant_chunks += 1
                seen_passages.update(passages)
                dcg += 1 / math.log2(rank + 2)
        recall = len(seen_passages) / len(references)
        # Short result sets use their actual length, not k, as the denominator.
        precision = relevant_chunks / min(k, len(chunks)) if chunks else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        ideal = sum(1 / math.log2(rank + 2) for rank in range(min(k, relevant_count)))
        metrics[k] = {"recall": recall, "precision": precision, "f1": f1,
                      "all_evidence": recall == 1.0, "ndcg": dcg / ideal if ideal else 0.0}
    return {"id": case["id"], "config": config, "ranked_chunks": chunks,
            "reference_data": case.get("reference_data"), "reference_answer": case.get("reference_answer"),
            "reviewed_by": case.get("reviewed_by"),
            "returned_chunks": len(chunks), "latency_seconds": time.monotonic() - start,
            "metrics": metrics, "error": None}


def run_suite(cases, retrieve, config):
    results = []
    for case in cases:
        try:
            results.append(run_case(case, retrieve, config))
        except (ValueError, KeyError, TypeError) as exc:
            results.append({"id": case.get("id"), "config": config, "error": str(exc)})
    successful = [result for result in results if result["error"] is None]
    metrics = {}
    for k in (3, 5, 8):
        metrics[k] = {
            name: sum(float(result["metrics"][k][name]) for result in successful) / len(successful)
            if successful else None
            for name in ("recall", "precision", "f1", "all_evidence", "ndcg")
        }
    return {"count": len(results), "failed": len(results) - len(successful),
            "metrics": metrics, "cases": results, "config": config}
