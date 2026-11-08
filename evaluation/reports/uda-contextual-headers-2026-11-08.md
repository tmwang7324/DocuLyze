# UDA retrieval: contextual headers vs plain chunk text

> **Provisional.** Scored against unreviewed (LLM-assisted) evidence mappings, 15 scored cases per run (2 answer-only cases excluded). Differences of a few points are within what one case can move.

Hybrid retrieval (dense + BM25, RRF), top-8 from the local evaluation index, identical questions and labels. *Plain* embeds the raw chunk text; *headers* embeds `Title > Section > Subsection`, a blank line, then the chunk text (`retrieval.context.embedding_text`, the format production ingest now writes). 2,190 of 2,331 chunks received a header; the rest already carry their headings or have none.

## Corpus scope

All 17 documents searched (questions say "the company", so they are ambiguous across filings).

| Run | recall@3 | recall@5 | recall@8 | ndcg@3 | ndcg@5 | ndcg@8 | all-evidence@8 |
|---|---|---|---|---|---|---|---|
| plain | 0.433 | 0.567 | 0.700 | 0.307 | 0.337 | 0.384 | 0.667 |
| headers | 0.433 | 0.567 | 0.700 | 0.316 | 0.348 | 0.415 | 0.667 |

## Document scope

Search restricted to each case's source document (as a Conversation pinned to it).

| Run | recall@3 | recall@5 | recall@8 | ndcg@3 | ndcg@5 | ndcg@8 | all-evidence@8 |
|---|---|---|---|---|---|---|---|
| plain | 0.633 | 0.700 | 0.833 | 0.465 | 0.522 | 0.557 | 0.800 |
| headers | 0.767 | 0.767 | 0.833 | 0.528 | 0.559 | 0.589 | 0.800 |

## Reading

- Headers improve ranking, not coverage: recall@8 and all-evidence@8 are unchanged in both scopes; recall@3 and ndcg rise (largest in document scope: recall@3 0.633 to 0.767).
- Headers do not close the corpus-versus-document gap (recall@8 0.700 vs 0.833). UDA questions never name the company, so a company name in a header cannot help; that gap is a scoping problem (document filters), not an embedding one.
- Per case the effect is mixed (some ndcg@8 values fall), so treat this as a small positive, not a proven win, until labels are reviewed.
