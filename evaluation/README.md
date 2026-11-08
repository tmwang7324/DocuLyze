# Retrieval evaluation

The Google runner queries the dedicated Qdrant collection `google_eval_chunks`
using tenant `google-eval`. To populate it with the three existing Google
documents, use `python -m evaluation.corpus --live`. Setup embeds and indexes
the 167 saved chunks, refuses to replace a collection with mismatched metadata,
and can resume an interrupted run with matching metadata. It never deletes an
existing collection. This performs paid network calls.

The collection must have been built from the same corpus and chunker versions
named in the mapping file, using document IDs and chunk indices matching that
file. Before scoring, the runner checks the model, metadata and all indexed
chunk contents against the corpus fingerprint; an incomplete index fails closed.
The collection metadata must contain `purpose: doculyze-evaluation` and the
same `corpus_version` and `chunker_version` as the reviewed mapping file.

The source questions are the existing Google questions. Supply a separate JSON
mapping, reviewed by a human, containing the original evidence text and its
mapping to chunks. Do not treat historical chunk indices or automatically
generated proposals as reviewed evidence. The required shape is:

The tracked `google_corrections.json` records proposed reference-answer
corrections and reasons without altering the original dataset. Evaluation output
includes the proposed and original answer, but leaves the effective reference
answer empty until a correction has been reviewed by a human.

Generate a starting file with `python -m evaluation.corpus --propose
evaluation/results/google-proposed-labels.json`. It contains the historical
chunk text and labels as unreviewed proposals, not verified Reference Passages.
Extract and review the actual evidence, consolidate repeated evidence across
chunks, and record the reviewer before scoring. The command refuses to replace
an existing file, protecting prior review work. Each mapped passage must occur
verbatim in the identified indexed chunk.

```json
{
  "corpus_version": "example-corpus-v1",
  "chunker_version": "example-chunker-v1",
  "cases": {
    "example-question-id": {
      "reviewed_by": "reviewer name",
      "reference_passages": [{"id": "p1", "text": "original evidence text"}],
      "chunks": [{"document": "example.pdf", "chunk_index": 0, "passage_ids": ["p1"]}]
    }
  }
}
```

From the repository root, after installing the ingest and shared retrieval
packages and configuring the provider credentials, an explicitly opt-in
single-case run is:

```sh
python -m evaluation.google --live --labels reviewed-mappings.json --case goog-q1-001
```

Results default to the ignored `evaluation/results/` directory. Omit `--case`
only once mappings for every Google question are reviewed. This
performs network calls to Qdrant and the embedding provider and may incur cost.
Do not commit result files containing private corpus text or credentials.

For each cutoff (3, 5 and 8), recall is the number of unique Reference Passages
covered divided by the number of reference passages. Precision is the number
of returned chunks with at least one mapped Reference Passage divided by the
number returned up to that cutoff; duplicate chunk identities count as misses.
F1 is their harmonic mean. It is a custom measure: its precision and recall
have different units. All-evidence coverage is one if recall is one.

NDCG uses binary chunk relevance: a distinct chunk is relevant if it maps to
at least one Reference Passage; duplicate retrieved chunk identities have zero
gain. The ideal ranking contains the number of distinct relevant mapped chunks
up to the cutoff. Multiple distinct chunks covering the same passage can each
receive NDCG gain, unlike passage recall. DCG uses logarithmic rank discounts.
Empty results score zero. Cases with no Reference Passages or missing, invalid,
or unreviewed mappings are not scored. Unanswerable and no-search cases are
not retrieval cases and need separate evaluation. Aggregate metrics exclude
failed cases, whose error and total count remain visible.

## Grouped reporting and edge cases (ticket 2)

`run_suite` reports every metric overall and per benchmark group (`google`,
`tathybrid`, `papertext`, `papertab`), each with `count`, `scored`, `failed` and
`not_scored`. Averages cover scored cases only. A case with no Reference Passages
that carries a `not_scored_reason` is still retrieved, so its answer can be
evaluated, but it is reported as `not_scored` instead of failing. A case whose
mapping is invalid or unreviewed fails visibly with the reason. The full policy is
in the `evaluation/benchmark.py` docstring.

## UDA benchmark

The 17 selected UDA questions (`uda_questions.json`; the eight
`pending_authoring` placeholders are excluded) run over a shared corpus of their 17
source documents. The corpus is chunked from the committed Markdown by the
production chunker, 2,331 chunks in total.

- `evaluation/uda_evidence.json`: each question joined by document and `q_uid` to
  UDA's `extended_qa_info` evidence. Paper questions use the first annotator's
  highlighted evidence (table captions keep kind `caption`). TatHybrid questions
  use the answer's `facts`, one passage per table value. Two yes/no questions have
  no evidence, so they are answer-only (`not_scored` for retrieval). Regenerate with
  `python -m evaluation.uda --import-evidence`, which downloads the evidence files.
- `evaluation/uda_labels.json`: evidence-to-chunk mappings. They were proposed with
  LLM assistance (one Claude Sonnet subagent per subset), and every excerpt was
  checked to occur verbatim in its chunk (`matched_text`). They are **not human
  reviewed** (`reviewed_by` is empty). Review them, fill in `reviewed_by`, and
  scoring no longer needs `--allow-unreviewed`. `python -m evaluation.uda --propose
  FILE` writes deterministic text-matching proposals instead. Labels are tied to the
  corpus fingerprint and to the chunker's source hash. If either changes, the runner
  and `test_committed_labels_match_the_current_corpus_and_chunker` fail until the
  labels are re-proposed and re-reviewed.

Live run (Voyage embeddings, plus OpenAI with `--ragas`; needs `VOYAGE_API_KEY` and
`OPENAI_API_KEY`):

```sh
python -m evaluation.uda --live --strategy hybrid --scope document --allow-unreviewed --ragas
```

The index is a local on-disk Qdrant (`evaluation/results/uda-qdrant`, collection
`uda_eval_chunks`, tenant `uda-eval`). No server is involved, and Qdrant Cloud and
the production collection are never touched. The first run embeds the corpus,
about $0.03 with voyage-3.5-lite. Later runs reuse the index after checking its
contents against the corpus fingerprint. Choose `--strategy dense|hybrid`
(production RRF fusion) and `--scope corpus|document`. UDA questions are written
per document ("the company", "they"), so `corpus` scope makes them ambiguous
across the 17 filings and papers. `document` scope searches only the case's source
document, as a Conversation pinned to it would. `--headers` embeds every chunk the
way production ingest does: its heading path (`Title > Section > Subsection`,
from `retrieval.context`) is prepended to the text the dense and BM25 embedders see,
while the stored and cited content stays raw. It uses its own collection
(`uda_eval_chunks_ctx`), so a contextual run never reads a plain index. The corpus
fingerprint covers raw chunk text only, so the reviewed labels stay valid for both.
Run both and compare to measure what the headers change. Each run writes `retrieval.json`,
`ragas.json`, `calibration.json` and `summary.md` under `evaluation/results/`, which
is ignored. `summary.md` contains no corpus text. Summaries from the first runs are
committed in `evaluation/reports/`.

## RAGAS answer scoring (ticket 6)

`--ragas` generates an answer per case the way the grounded chat Turn does. The
system prompt is `GROUNDED_PROMPT`, read from `awesome-chat-service/turn.py`, the
excerpts are numbered `[n] breadcrumb`, the top `CHAT_TOP_K` (8) chunks are used,
and the model and reasoning effort come from `CHAT_MODEL` and
`CHAT_REASONING_EFFORT`. RAGAS then scores the answer, separately from the
deterministic metrics:

| Metric | Measures | Inputs |
|---|---|---|
| context_precision | the retrieved contexts that help reach the reference answer, and whether they rank early | question, reference answer, contexts |
| faithfulness | whether the answer's claims are supported by the contexts | question, answer, contexts |
| response_relevancy | whether the answer addresses the question | question, answer (judge + embeddings) |

The judge is pinned in `ragas_scoring.JUDGE_CONFIG`: `gpt-4.1-mini-2025-04-14` at
temperature 0, `text-embedding-3-small`, and ragas 0.4.3. The judge is deliberately
a different model from the generator. A judge error, a missing input or a failed
generation is recorded per case in `errors` and counted beside each mean, never
averaged in as a score. `calibration.json` holds a fixed five-case sample with
empty `human_*` columns, for checking the judge against human grades.

None of these three metrics compares the answer with the reference for
correctness. A faithful answer drawn from the wrong document scores well. Add
RAGAS `FactualCorrectness` or `AnswerAccuracy` if correctness is needed.

Install the pinned environment with `pip install -r evaluation/requirements.txt`.
Run the offline tests with `python -m pytest evaluation/tests`.
`test_proposal_cli_creates_unreviewed_file_without_network` needs the uncommitted
`ingest-worker/experimental_results/chunks/` folder and fails without it.
