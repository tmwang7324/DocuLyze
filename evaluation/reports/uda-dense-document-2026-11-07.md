# UDA evaluation: dense, document scope

> **Provisional.** Scored against unreviewed (LLM-assisted) evidence mappings; the numbers change if review changes a mapping.

| Setting | Value |
|---|---|
| benchmark | `uda` |
| strategy | `dense` |
| scope | `document` |
| collection | `uda_eval_chunks (local)` |
| embedding_model | `voyage-3.5-lite` |
| sparse_model | `None` |
| corpus_version | `sha256:7ea98fc877ec0ac06866cd627b920302fc21a771dd856b5785dda24286758577` |
| chunker_version | `chunk_markdown@sha256:9afd9b2f2fee34c1` |
| mapping_method | `LLM-assisted proposals (Claude Sonnet subagents, one per UDA subset) checked for verbatim anchors; unreviewed` |
| provisional | `True` |
| excluded_placeholders | `8` |

## Retrieval (deterministic)

Means over scored cases. `n` = scored / total (failed, not scored).

| Group | n | recall@3 | f1@3 | ndcg@3 | recall@5 | f1@5 | ndcg@5 | recall@8 | f1@8 | ndcg@8 | all-evidence@8 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| papertab | 3/3 (0, 0) | 0.167 | 0.133 | 0.156 | 0.167 | 0.095 | 0.130 | 0.833 | 0.259 | 0.360 | 0.667 |
| papertext | 3/5 (0, 2) | 0.333 | 0.167 | 0.333 | 0.333 | 0.111 | 0.333 | 0.333 | 0.074 | 0.333 | 0.333 |
| tathybrid | 9/9 (0, 0) | 1.000 | 0.600 | 0.857 | 1.000 | 0.413 | 0.857 | 1.000 | 0.301 | 0.880 | 1.000 |
| **overall** | 15/17 (0, 2) | 0.700 | 0.420 | 0.612 | 0.700 | 0.289 | 0.607 | 0.833 | 0.247 | 0.667 | 0.800 |
