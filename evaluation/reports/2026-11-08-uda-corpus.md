# uda: strategy comparison (corpus scope)

> **Provisional.** Some cases are scored against unreviewed evidence mappings.

Retrieval means over scored cases (deterministic). `cases` = scored / total; failed and not-scored cases are listed, never averaged in. Latency is the median per case.

| Strategy | group | cases | recall@3 | recall@5 | recall@8 | ndcg@5 | ndcg@8 | f1@5 | all-evidence@8 | median latency |
|---|---|---|---|---|---|---|---|---|---|---|
| dense | **overall** | 15/17 | 0.644 | 0.667 | 0.800 | 0.436 | 0.503 | 0.250 | 0.800 | 0.16s |
| dense | papertab | 3/3 | 0.222 | 0.333 | 0.333 | 0.213 | 0.226 | 0.250 | 0.333 |  |
| dense | papertext | 3/5 | 0.333 | 0.333 | 0.667 | 0.333 | 0.406 | 0.111 | 0.667 |  |
| dense | tathybrid | 9/9 | 0.889 | 0.889 | 1.000 | 0.545 | 0.628 | 0.296 | 1.000 |  |
| ner_dense | **overall** | 15/17 | 0.644 | 0.733 | 0.800 | 0.462 | 0.506 | 0.272 | 0.800 | 0.38s |
| ner_dense | papertab | 3/3 | 0.222 | 0.333 | 0.333 | 0.213 | 0.226 | 0.250 | 0.333 |  |
| ner_dense | papertext | 3/5 | 0.333 | 0.333 | 0.667 | 0.333 | 0.406 | 0.111 | 0.667 |  |
| ner_dense | tathybrid | 9/9 | 0.889 | 1.000 | 1.000 | 0.588 | 0.632 | 0.333 | 1.000 |  |
| hybrid | **overall** | 15/17 | 0.433 | 0.578 | 0.800 | 0.342 | 0.407 | 0.211 | 0.800 | 0.27s |
| hybrid | papertab | 3/3 | 0.167 | 0.222 | 0.333 | 0.157 | 0.174 | 0.167 | 0.333 |  |
| hybrid | papertext | 3/5 | 0.333 | 0.333 | 0.667 | 0.210 | 0.283 | 0.111 | 0.667 |  |
| hybrid | tathybrid | 9/9 | 0.556 | 0.778 | 1.000 | 0.448 | 0.527 | 0.259 | 1.000 |  |
| hybrid_rerank | **overall** | 15/17 | 0.644 | 0.778 | 0.778 | 0.553 | 0.569 | 0.278 | 0.733 | 0.42s |
| hybrid_rerank | papertab | 3/3 | 0.222 | 0.222 | 0.222 | 0.184 | 0.196 | 0.167 | 0.000 |  |
| hybrid_rerank | papertext | 3/5 | 0.667 | 0.667 | 0.667 | 0.339 | 0.339 | 0.222 | 0.667 |  |
| hybrid_rerank | tathybrid | 9/9 | 0.778 | 1.000 | 1.000 | 0.748 | 0.769 | 0.333 | 1.000 |  |
| production | **overall** | 15/17 | 0.644 | 0.711 | 0.800 | 0.537 | 0.553 | 0.296 | 0.800 | 2.17s |
| production | papertab | 3/3 | 0.222 | 0.222 | 0.333 | 0.218 | 0.227 | 0.211 | 0.333 |  |
| production | papertext | 3/5 | 0.667 | 0.667 | 0.667 | 0.392 | 0.392 | 0.302 | 0.667 |  |
| production | tathybrid | 9/9 | 0.778 | 0.889 | 1.000 | 0.692 | 0.716 | 0.323 | 1.000 |  |

Production: the needs-search gate skipped search on 0 retrieval case(s); 0 plan(s) degraded.
