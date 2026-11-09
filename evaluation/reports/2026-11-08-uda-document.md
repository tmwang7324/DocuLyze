# uda: strategy comparison (document scope)

> **Provisional.** Some cases are scored against unreviewed evidence mappings.

Retrieval means over scored cases (deterministic). `cases` = scored / total; failed and not-scored cases are listed, never averaged in. Latency is the median per case.

| Strategy | group | cases | recall@3 | recall@5 | recall@8 | ndcg@5 | ndcg@8 | f1@5 | all-evidence@8 | median latency |
|---|---|---|---|---|---|---|---|---|---|---|
| dense | **overall** | 15/17 | 0.711 | 0.733 | 0.933 | 0.624 | 0.692 | 0.320 | 0.933 | 0.17s |
| dense | papertab | 3/3 | 0.222 | 0.333 | 1.000 | 0.213 | 0.413 | 0.250 | 1.000 |  |
| dense | papertext | 3/5 | 0.333 | 0.333 | 0.667 | 0.333 | 0.406 | 0.111 | 0.667 |  |
| dense | tathybrid | 9/9 | 1.000 | 1.000 | 1.000 | 0.857 | 0.880 | 0.413 | 1.000 |  |
| ner_dense | **overall** | 15/17 | 0.711 | 0.733 | 0.933 | 0.624 | 0.692 | 0.320 | 0.933 | 1.05s |
| ner_dense | papertab | 3/3 | 0.222 | 0.333 | 1.000 | 0.213 | 0.413 | 0.250 | 1.000 |  |
| ner_dense | papertext | 3/5 | 0.333 | 0.333 | 0.667 | 0.333 | 0.406 | 0.111 | 0.667 |  |
| ner_dense | tathybrid | 9/9 | 1.000 | 1.000 | 1.000 | 0.857 | 0.880 | 0.413 | 1.000 |  |
| hybrid | **overall** | 15/17 | 0.633 | 0.711 | 0.933 | 0.527 | 0.579 | 0.303 | 0.933 | 0.28s |
| hybrid | papertab | 3/3 | 0.167 | 0.222 | 1.000 | 0.157 | 0.350 | 0.167 | 1.000 |  |
| hybrid | papertext | 3/5 | 0.333 | 0.333 | 0.667 | 0.210 | 0.278 | 0.111 | 0.667 |  |
| hybrid | tathybrid | 9/9 | 0.889 | 1.000 | 1.000 | 0.756 | 0.756 | 0.413 | 1.000 |  |
| hybrid_rerank | **overall** | 15/17 | 0.711 | 0.911 | 0.978 | 0.718 | 0.742 | 0.386 | 0.933 | 0.42s |
| hybrid_rerank | papertab | 3/3 | 0.222 | 0.556 | 0.889 | 0.351 | 0.475 | 0.357 | 0.667 |  |
| hybrid_rerank | papertext | 3/5 | 0.667 | 1.000 | 1.000 | 0.483 | 0.483 | 0.333 | 1.000 |  |
| hybrid_rerank | tathybrid | 9/9 | 0.889 | 1.000 | 1.000 | 0.918 | 0.918 | 0.413 | 1.000 |  |
| production | **overall** | 15/17 | 0.644 | 0.844 | 0.911 | 0.563 | 0.599 | 0.325 | 0.867 | 2.33s |
| production | papertab | 3/3 | 0.222 | 0.889 | 0.889 | 0.450 | 0.426 | 0.433 | 0.667 |  |
| production | papertext | 3/5 | 0.667 | 1.000 | 1.000 | 0.558 | 0.623 | 0.333 | 1.000 |  |
| production | tathybrid | 9/9 | 0.778 | 0.778 | 0.889 | 0.602 | 0.648 | 0.286 | 0.889 |  |

## Answers (RAGAS, overall)

| Strategy | context_precision | faithfulness | response_relevancy |
|---|---|---|---|
| dense | 0.709 (n=17, err=0) | 0.912 (n=17, err=0) | 0.596 (n=17, err=0) |
| ner_dense | 0.713 (n=17, err=0) | 0.927 (n=17, err=0) | 0.681 (n=17, err=0) |
| hybrid | 0.598 (n=17, err=0) | 0.971 (n=17, err=0) | 0.731 (n=17, err=0) |
| hybrid_rerank | 0.795 (n=17, err=0) | 0.940 (n=17, err=0) | 0.712 (n=17, err=0) |
| production | 0.661 (n=17, err=0) | 0.972 (n=17, err=0) | 0.592 (n=17, err=0) |

Production: the needs-search gate skipped search on 0 retrieval case(s); 0 plan(s) degraded.
