# multihop: strategy comparison (corpus scope)

> **Provisional.** Some cases are scored against unreviewed evidence mappings.

Retrieval means over scored cases (deterministic). `cases` = scored / total; failed and not-scored cases are listed, never averaged in. Latency is the median per case.

| Strategy | group | cases | recall@3 | recall@5 | recall@8 | ndcg@5 | ndcg@8 | f1@5 | all-evidence@8 | median latency |
|---|---|---|---|---|---|---|---|---|---|---|
| dense | **overall** | 8/10 | 0.687 | 0.771 | 0.854 | 0.715 | 0.756 | 0.522 | 0.625 | 0.14s |
| dense | multihop | 8/10 | 0.687 | 0.771 | 0.854 | 0.715 | 0.756 | 0.522 | 0.625 |  |
| ner_dense | **overall** | 8/10 | 0.562 | 0.646 | 0.729 | 0.645 | 0.671 | 0.446 | 0.500 | 1.25s |
| ner_dense | multihop | 8/10 | 0.562 | 0.646 | 0.729 | 0.645 | 0.671 | 0.446 | 0.500 |  |
| hybrid | **overall** | 8/10 | 0.688 | 0.917 | 0.917 | 0.778 | 0.778 | 0.598 | 0.750 | 0.16s |
| hybrid | multihop | 8/10 | 0.688 | 0.917 | 0.917 | 0.778 | 0.778 | 0.598 | 0.750 |  |
| hybrid_rerank | **overall** | 8/10 | 0.792 | 0.917 | 0.917 | 0.858 | 0.875 | 0.598 | 0.750 | 0.34s |
| hybrid_rerank | multihop | 8/10 | 0.792 | 0.917 | 0.917 | 0.858 | 0.875 | 0.598 | 0.750 |  |
| production | **overall** | 8/10 | 0.792 | 0.875 | 0.958 | 0.840 | 0.892 | 0.567 | 0.875 | 3.30s |
| production | multihop | 8/10 | 0.792 | 0.875 | 0.958 | 0.840 | 0.892 | 0.567 | 0.875 |  |

## Answers (RAGAS, overall)

| Strategy | context_precision | faithfulness | response_relevancy |
|---|---|---|---|
| dense | 0.516 (n=10, err=0) | 0.850 (n=10, err=0) | 0.471 (n=10, err=0) |
| ner_dense | 0.562 (n=10, err=0) | 0.870 (n=10, err=0) | 0.280 (n=10, err=0) |
| hybrid | 0.413 (n=10, err=0) | 0.986 (n=10, err=0) | 0.322 (n=10, err=0) |
| hybrid_rerank | 0.477 (n=10, err=0) | 0.932 (n=10, err=0) | 0.382 (n=10, err=0) |
| production | 0.536 (n=10, err=0) | 0.933 (n=10, err=0) | 0.327 (n=10, err=0) |

Production: the needs-search gate skipped search on 0 retrieval case(s); 0 plan(s) degraded.
