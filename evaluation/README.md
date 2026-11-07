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
