# google: strategy comparison (corpus scope)

> **Incomplete RAGAS for `production`.** OpenAI returned 429 "no credits remaining" part-way through the production answer pass (25 of 36 cases errored; context_precision n=11, faithfulness n=11, response_relevancy n=10). The production row of the RAGAS table is NOT comparable with the other strategies. Retrieval metrics are unaffected (36/36 scored). Re-run `--strategies production --ragas` after topping up credits.


> **Provisional.** Some cases are scored against unreviewed evidence mappings.

Retrieval means over scored cases (deterministic). `cases` = scored / total; failed and not-scored cases are listed, never averaged in. Latency is the median per case.

| Strategy | group | cases | recall@3 | recall@5 | recall@8 | ndcg@5 | ndcg@8 | f1@5 | all-evidence@8 | median latency |
|---|---|---|---|---|---|---|---|---|---|---|
| dense | **overall** | 36/36 | 0.627 | 0.823 | 0.875 | 0.721 | 0.739 | 0.439 | 0.694 | 0.12s |
| dense | google | 36/36 | 0.627 | 0.823 | 0.875 | 0.721 | 0.739 | 0.439 | 0.694 |  |
| ner_dense | **overall** | 36/36 | 0.556 | 0.652 | 0.739 | 0.597 | 0.630 | 0.340 | 0.583 | 1.01s |
| ner_dense | google | 36/36 | 0.556 | 0.652 | 0.739 | 0.597 | 0.630 | 0.340 | 0.583 |  |
| hybrid | **overall** | 36/36 | 0.716 | 0.882 | 0.918 | 0.777 | 0.787 | 0.480 | 0.778 | 0.14s |
| hybrid | google | 36/36 | 0.716 | 0.882 | 0.918 | 0.777 | 0.787 | 0.480 | 0.778 |  |
| hybrid_rerank | **overall** | 36/36 | 0.880 | 0.933 | 0.959 | 0.934 | 0.940 | 0.515 | 0.889 | 0.28s |
| hybrid_rerank | google | 36/36 | 0.880 | 0.933 | 0.959 | 0.934 | 0.940 | 0.515 | 0.889 |  |
| production | **overall** | 36/36 | 0.820 | 0.913 | 0.952 | 0.862 | 0.875 | 0.500 | 0.861 | 2.48s |
| production | google | 36/36 | 0.820 | 0.913 | 0.952 | 0.862 | 0.875 | 0.500 | 0.861 |  |

## Answers (RAGAS, overall)

| Strategy | context_precision | faithfulness | response_relevancy |
|---|---|---|---|
| dense | 0.645 (n=33, err=3) | 0.963 (n=33, err=3) | 0.807 (n=36, err=0) |
| ner_dense | 0.536 (n=33, err=3) | 0.971 (n=34, err=2) | 0.683 (n=36, err=0) |
| hybrid | 0.655 (n=33, err=3) | 0.956 (n=33, err=3) | 0.843 (n=36, err=0) |
| hybrid_rerank | 0.808 (n=33, err=3) | 0.929 (n=33, err=3) | 0.870 (n=36, err=0) |
| production | 0.806 (n=11, err=25) | 1.000 (n=11, err=25) | 0.947 (n=10, err=26) |

Production: the needs-search gate skipped search on 0 retrieval case(s); 0 plan(s) degraded.
