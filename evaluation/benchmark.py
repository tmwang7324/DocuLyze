"""Run retrieval cases against reviewed Reference Passage mappings.

Scoring policy (ticket 2), applied at each cutoff K in CUTOFFS:

- recall: unique Reference Passages covered by the top-K chunks / Reference Passages.
- precision: top-K chunks mapping to at least one Reference Passage / chunks returned
  up to K (the actual count when fewer than K come back). A repeated chunk identity
  counts as a miss.
- f1: harmonic mean of the two. Custom score: precision counts chunks, recall counts
  passages, so the two use different units.
- all_evidence: 1 when every Reference Passage is covered (recall == 1).
- ndcg: binary chunk relevance. A distinct chunk mapped to at least one Reference
  Passage has gain 1; a repeated identity has gain 0. The ideal ranking holds every
  distinct relevant mapped chunk, capped at K. Distinct chunks covering the same
  passage each earn gain, unlike recall.

Edge cases: an empty result scores 0 on every metric. A case with no Reference
Passages is not a retrieval case. If it carries a `not_scored_reason` it is still
retrieved (answer evaluation needs the contexts) and reported as `not_scored`,
otherwise it is rejected. Failed and not-scored cases are left out of every average,
and their counts stay visible next to it, overall and per group.
"""

import math
import time

CUTOFFS = (3, 5, 8)
METRICS = ("recall", "precision", "f1", "all_evidence", "ndcg")


def validated_mapping(case_id, label, corpus_lookup=None, *, require_review=True, anchors=None):
    """Check one case's label and return (passages, {(document, chunk_index): passage_ids}).

    `anchors(chunk_mapping, passage_texts)` names the strings that must occur verbatim in
    the mapped chunk; by default the passage texts themselves."""
    if require_review and (not isinstance(label.get("reviewed_by"), str) or not label["reviewed_by"].strip()):
        raise ValueError(f"Missing human review for {case_id}")
    passages = label.get("reference_passages", [])
    if not passages or any(not item.get("id") or not item.get("text") for item in passages):
        raise ValueError(f"Missing Reference Passages for {case_id}")
    ids = [item["id"] for item in passages]
    if len(set(ids)) != len(ids):
        raise ValueError(f"Duplicate Reference Passage ids for {case_id}")
    passage_texts = {item["id"]: item["text"] for item in passages}
    anchors = anchors or (lambda chunk, texts: [texts[passage_id] for passage_id in chunk["passage_ids"]])
    mapping = {}
    for chunk in label.get("chunks", []):
        key = (chunk["document"], chunk["chunk_index"])
        if key in mapping or not chunk["passage_ids"] or not set(chunk["passage_ids"]) <= set(ids):
            raise ValueError(f"Invalid mapping for {case_id}")
        if corpus_lookup is not None and (key not in corpus_lookup or any(
            anchor not in corpus_lookup[key] for anchor in anchors(chunk, passage_texts)
        )):
            raise ValueError(f"Reference Passage is not present in mapped corpus chunk for {case_id}")
        mapping[key] = chunk["passage_ids"]
    if not mapping or set().union(*map(set, mapping.values())) != set(ids):
        raise ValueError(f"Incomplete mapping for {case_id}")
    return passages, mapping


def google_cases(source, labels, corpus=None, corrections=None):
    if not labels.get("corpus_version") or not labels.get("chunker_version"):
        raise ValueError("Corpus and chunker versions are required")
    corpus_lookup = {(chunk["document"], chunk["chunk_index"]): chunk["content"] for chunk in corpus} if corpus is not None else None
    cases = []
    for question in source["questions"]:
        label = labels.get("cases", {}).get(question["id"])
        if not label:
            raise ValueError(f"Missing human review for {question['id']}")
        passages, mapping = validated_mapping(question["id"], label, corpus_lookup)
        correction = (corrections or {}).get(question["id"], {})
        original_answer = question.get("ground_truth_answer")
        cases.append({"id": question["id"], "question": question["question"], "group": "google",
                      "reference_passages": [item["id"] for item in passages], "reference_data": passages,
                      "reference_answer": None if correction else original_answer,
                      "original_reference_answer": original_answer,
                      "proposed_reference_answer": correction.get("reference_answer"),
                      "reference_correction_reason": correction.get("reason"),
                      "reviewed_by": label["reviewed_by"], "mapping": mapping})
    return cases


def score(chunks, references, mapping):
    """Deterministic retrieval metrics for one ranked list (see the module docstring)."""
    metrics = {}
    relevant_count = sum(bool(set(passages) & references) for passages in mapping.values())
    for k in CUTOFFS:
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
    return metrics


def run_case(case, retrieve, config):
    if case.get("invalid_mapping"):
        raise ValueError(case["invalid_mapping"])
    references = set(case["reference_passages"])
    not_scored_reason = case.get("not_scored_reason")
    if not references and not not_scored_reason:
        raise ValueError("A retrieval case needs at least one Reference Passage")
    base = {"id": case["id"], "group": case.get("group"), "config": config}
    start = time.monotonic()
    try:
        chunks = list(retrieve(case["question"], max(CUTOFFS)))
    except Exception as exc:
        return {**base, "status": "failed", "error": f"Retrieval failed ({type(exc).__name__})",
                "latency_seconds": time.monotonic() - start}
    latency = time.monotonic() - start

    result = {**base, "question": case["question"], "ranked_chunks": chunks,
              "reference_data": case.get("reference_data"), "reference_answer": case.get("reference_answer"),
              "original_reference_answer": case.get("original_reference_answer"),
              "proposed_reference_answer": case.get("proposed_reference_answer"),
              "reference_correction_reason": case.get("reference_correction_reason"),
              "reviewed_by": case.get("reviewed_by"), "provisional": bool(case.get("provisional")),
              "returned_chunks": len(chunks), "latency_seconds": latency, "error": None}
    if not references:
        return {**result, "status": "not_scored", "not_scored_reason": not_scored_reason, "metrics": None}
    return {**result, "status": "scored", "metrics": score(chunks, references, case["mapping"])}


def aggregate(results):
    """Mean of every metric over scored cases, with the counts that qualify it."""
    scored = [result for result in results if result.get("status") == "scored"]
    summary = {"count": len(results), "scored": len(scored),
               "failed": sum(result.get("status") == "failed" for result in results),
               "not_scored": sum(result.get("status") == "not_scored" for result in results)}
    summary["metrics"] = {
        k: {name: sum(float(result["metrics"][k][name]) for result in scored) / len(scored) if scored else None
            for name in METRICS}
        for k in CUTOFFS
    }
    return summary


def run_suite(cases, retrieve, config):
    results = []
    for case in cases:
        try:
            results.append(run_case(case, retrieve, config))
        except (ValueError, KeyError, TypeError) as exc:
            results.append({"id": case.get("id"), "group": case.get("group"), "config": config,
                            "status": "failed", "error": str(exc)})
    overall = aggregate(results)
    groups = {}
    for name in sorted({result["group"] for result in results if result.get("group")}):
        groups[name] = aggregate([result for result in results if result.get("group") == name])
    return {**overall, "groups": groups, "cases": results, "config": config}
