# UDA evaluation: hybrid, corpus scope

> **Provisional.** Scored against unreviewed (LLM-assisted) evidence mappings; the numbers change if review changes a mapping.

| Setting | Value |
|---|---|
| benchmark | `uda` |
| strategy | `hybrid` |
| scope | `corpus` |
| collection | `uda_eval_chunks (local)` |
| embedding_model | `voyage-3.5-lite` |
| sparse_model | `Qdrant/bm25` |
| corpus_version | `sha256:7ea98fc877ec0ac06866cd627b920302fc21a771dd856b5785dda24286758577` |
| chunker_version | `chunk_markdown@sha256:9afd9b2f2fee34c1` |
| mapping_method | `LLM-assisted proposals (Claude Sonnet subagents, one per UDA subset) checked for verbatim anchors; unreviewed` |
| provisional | `True` |
| excluded_placeholders | `8` |
| generation | `{'model': 'gpt-5-mini', 'reasoning_effort': 'low', 'top_k': 8}` |

## Retrieval (deterministic)

Means over scored cases. `n` = scored / total (failed, not scored).

| Group | n | recall@3 | f1@3 | ndcg@3 | recall@5 | f1@5 | ndcg@5 | recall@8 | f1@8 | ndcg@8 | all-evidence@8 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| papertab | 3/3 (0, 0) | 0.167 | 0.133 | 0.156 | 0.167 | 0.095 | 0.130 | 0.167 | 0.067 | 0.130 | 0.000 |
| papertext | 3/5 (0, 2) | 0.333 | 0.167 | 0.210 | 0.333 | 0.111 | 0.210 | 0.333 | 0.074 | 0.210 | 0.333 |
| tathybrid | 9/9 (0, 0) | 0.556 | 0.278 | 0.389 | 0.778 | 0.259 | 0.448 | 1.000 | 0.222 | 0.527 | 1.000 |
| **overall** | 15/17 (0, 2) | 0.433 | 0.227 | 0.307 | 0.567 | 0.197 | 0.337 | 0.700 | 0.161 | 0.384 | 0.667 |

## Answers (RAGAS)

Judge: judge_model=`gpt-4.1-mini-2025-04-14`, judge_temperature=`0.0`, embedding_model=`text-embedding-3-small`, ragas_version=`0.4.3`.
Means over cases the judge scored; `n` scored, `err` scoring errors.

| Group | cases | context_precision | faithfulness | response_relevancy |
|---|---|---|---|---|
| papertab | 3 | 0.374 (n=3, err=0) | 0.944 (n=3, err=0) | 0.845 (n=3, err=0) |
| papertext | 5 | 0.556 (n=5, err=0) | 1.000 (n=5, err=0) | 0.542 (n=5, err=0) |
| tathybrid | 9 | 0.504 (n=9, err=0) | 0.833 (n=9, err=0) | 0.490 (n=9, err=0) |
| **overall** | 17 | 0.496 (n=17, err=0) | 0.902 (n=17, err=0) | 0.568 (n=17, err=0) |
