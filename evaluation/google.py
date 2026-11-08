"""Opt-in dense retrieval evaluation against an existing isolated Google corpus."""

import argparse
import json
import logging
import sys
from pathlib import Path

from evaluation.benchmark import google_cases, run_suite

ROOT = Path(__file__).resolve().parents[1]
QUESTIONS = ROOT / "ingest-worker" / "experimental_results" / "sample_q&a" / "google_questions.json"
CORRECTIONS = ROOT / "evaluation" / "google_corrections.json"
LOG = logging.getLogger("evaluation.google")


def validate_collection(client, labels, embedding_model=None, chunks=None, *,
                        collection="google_eval_chunks", uid="google-eval"):
    metadata = client.get_collection(collection).config.metadata or {}
    expected = {"purpose": "doculyze-evaluation", "corpus_version": labels["corpus_version"],
                "chunker_version": labels["chunker_version"]}
    if embedding_model is not None:
        expected["embedding_model"] = embedding_model
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise ValueError("Evaluation collection metadata does not match reviewed corpus and chunker versions")
    if chunks is not None:
        from evaluation.corpus import corpus_version

        found, offset = [], None
        while True:
            points, offset = client.scroll(collection, limit=100, offset=offset,
                                           with_payload=True, with_vectors=False)
            for point in points:
                payload = point.payload or {}
                if payload.get("userId") != uid:
                    raise ValueError("Evaluation collection contents contain an unexpected tenant")
                found.append({"document": payload.get("docId"), "chunk_index": payload.get("chunk_index"),
                              "content": payload.get("content")})
            if offset is None:
                break
        try:
            found.sort(key=lambda item: (item["document"], item["chunk_index"]))
            if (len(found) != len(chunks) or corpus_version(found) != labels["corpus_version"]
                    or corpus_version(chunks) != labels["corpus_version"]):
                raise ValueError("Evaluation collection contents do not match the versioned corpus")
        except TypeError as exc:
            raise ValueError("Invalid evaluation collection contents") from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, required=True, help="Reviewed, versioned evidence mappings")
    parser.add_argument("--output", type=Path, default=ROOT / "evaluation" / "results" / "google.json")
    parser.add_argument("--case", help="Run one question ID for a smoke test")
    parser.add_argument("--live", action="store_true", help="Allow calls to Qdrant and the embedding provider")
    args = parser.parse_args()
    if not args.live:
        parser.error("--live is required for network evaluation")
    source = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    if args.case:
        source["questions"] = [item for item in source["questions"] if item["id"] == args.case]
        if not source["questions"]:
            parser.error("unknown case ID")
    from evaluation.corpus import load_google_chunks
    corpus = load_google_chunks(json.loads(QUESTIONS.read_text(encoding="utf-8")),
                                ROOT / "ingest-worker" / "experimental_results" / "chunks")
    corrections = json.loads(CORRECTIONS.read_text(encoding="utf-8"))
    cases = google_cases(source, labels, corpus, corrections)

    sys.path.insert(0, str(ROOT / "ingest-worker" / "src"))
    from ingest.mytests.eval_support import connect, create_dense_embedder, query_dense
    from retrieval.config import embedding_model

    client = connect()
    validate_collection(client, labels, embedding_model(), corpus)
    embed = create_dense_embedder()
    config = {"strategy": "dense", "collection": "google_eval_chunks", "uid": "google-eval",
              "embedding_model": embedding_model(), "corpus_version": labels["corpus_version"],
              "chunker_version": labels["chunker_version"]}

    def retrieve(question, limit):
        hits = query_dense(client, config["collection"], embed, question, config["uid"], limit=limit)
        return [{"document": hit["metadata"]["docId"], "chunk_index": hit["metadata"]["chunk_index"],
                 "content": hit["content"], "score": hit["score"]} for hit in hits]

    LOG.info("Running %d cases against evaluation collection", len(cases))
    report = run_suite(cases, retrieve, config)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    LOG.info("Completed %d cases with %d failures", report["count"], report["failed"])
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    raise SystemExit(main())
