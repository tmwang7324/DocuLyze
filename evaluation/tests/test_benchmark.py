import pytest
import sys
import subprocess
from pathlib import Path

from evaluation.benchmark import google_cases, run_case, run_suite

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ingest-worker" / "src"))


def test_collection_recreation_rejects_non_evaluation_target_before_contact():
    from ingest.mytests.eval_support import recreate_collection

    class NeverContact:
        def __getattr__(self, name):
            raise AssertionError("client must not be contacted")

    with pytest.raises(ValueError, match="evaluation"):
        recreate_collection(NeverContact(), "chunks")


def test_collection_setup_refuses_to_replace_existing_even_if_named_for_eval():
    from ingest.mytests.eval_support import recreate_collection

    class ExistingCollection:
        def collection_exists(self, name):
            return True

        def delete_collection(self, name):
            raise AssertionError("existing collection must not be deleted")

    with pytest.raises(ValueError, match="already exists"):
        recreate_collection(ExistingCollection(), "google_eval_chunks")


def test_benchmark_scores_unique_reference_passages_and_preserves_document_identity():
    case = {
        "id": "multi-doc",
        "question": "What changed?",
        "reference_passages": ["a", "b"],
        "mapping": {
            ("first.pdf", 0): ["a"],
            ("first.pdf", 1): ["a"],
            ("second.pdf", 0): ["b"],
        },
    }
    chunks = [
        {"document": "first.pdf", "chunk_index": 0, "content": "a"},
        {"document": "first.pdf", "chunk_index": 1, "content": "a again"},
        {"document": "third.pdf", "chunk_index": 0, "content": "noise"},
        {"document": "second.pdf", "chunk_index": 0, "content": "b"},
    ]
    result = run_case(case, lambda question, limit: chunks, {"strategy": "dense"})
    assert result["metrics"][3]["recall"] == 0.5
    assert result["metrics"][3]["precision"] == pytest.approx(2 / 3)
    assert result["metrics"][3]["f1"] == pytest.approx(4 / 7)
    assert result["metrics"][5]["recall"] == 1
    assert result["metrics"][5]["all_evidence"] is True
    assert result["metrics"][3]["ndcg"] == pytest.approx(0.7653606369)
    assert result["metrics"][5]["ndcg"] == pytest.approx(0.9674679835)
    assert result["returned_chunks"] == 4
    assert result["ranked_chunks"][3]["document"] == "second.pdf"


def test_suite_reports_failed_cases_separately_from_averages():
    cases = [
        {"id": "ok", "question": "ok", "reference_passages": ["a"], "mapping": {("x", 0): ["a"]}},
        {"id": "failed", "question": "failed", "reference_passages": ["a"], "mapping": {("x", 0): ["a"]}},
    ]

    def retrieve(question, limit):
        if question == "failed":
            raise RuntimeError("retrieval unavailable")
        return [{"document": "x", "chunk_index": 0, "content": "evidence"}]

    report = run_suite(cases, retrieve, {"strategy": "dense"})
    assert report["count"] == 2
    assert report["failed"] == 1
    assert report["metrics"][3]["recall"] == 1
    assert report["cases"][1]["error"] == "Retrieval failed (RuntimeError)"


def test_empty_results_have_zero_scores_and_no_reference_cases_are_rejected():
    case = {"id": "one", "question": "q", "reference_passages": ["a"], "mapping": {("x", 0): ["a"]}}
    result = run_case(case, lambda question, limit: [], {})
    assert result["metrics"][3] == {"recall": 0, "precision": 0, "f1": 0, "all_evidence": False, "ndcg": 0}
    case["reference_passages"] = []
    with pytest.raises(ValueError, match="Reference Passage"):
        run_case(case, lambda question, limit: [], {})


def test_google_import_requires_reviewed_versioned_reference_passages():
    source = {"questions": [{"id": "g1", "question": "q", "relevant_chunks": [0]}]}
    labels = {"corpus_version": "v1", "chunker_version": "v1", "cases": {
        "g1": {"reviewed_by": "", "reference_passages": [{"id": "a", "text": "evidence"}],
               "chunks": [{"document": "a.pdf", "chunk_index": 0, "passage_ids": ["a"]}]}}}
    with pytest.raises(ValueError, match="review"):
        google_cases(source, labels)
    labels["cases"]["g1"]["reviewed_by"] = "human"
    cases = google_cases(source, labels)
    assert cases[0]["mapping"] == {("a.pdf", 0): ["a"]}
    with pytest.raises(ValueError, match="not present"):
        google_cases(source, labels, [{"document": "a.pdf", "chunk_index": 0, "content": "wrong"}])


def test_cli_refuses_network_without_explicit_live_flag():
    result = subprocess.run([sys.executable, "-m", "evaluation.google", "--labels", "missing.json"],
                            capture_output=True, text=True)
    assert result.returncode != 0
    assert "--live" in result.stderr


def test_proposal_cli_creates_unreviewed_file_without_network(tmp_path):
    import json

    path = tmp_path / "proposed.json"
    result = subprocess.run([sys.executable, "-m", "evaluation.corpus", "--propose", str(path)],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    labels = json.loads(path.read_text(encoding="utf-8"))
    assert len(labels["cases"]) == 36
    assert all(not case["reviewed_by"] for case in labels["cases"].values())


def test_collection_metadata_must_match_reviewed_versions():
    from evaluation.google import validate_collection

    class Config:
        metadata = {"purpose": "doculyze-evaluation", "corpus_version": "v1", "chunker_version": "old"}

    class Info:
        config = Config()

    class Client:
        def get_collection(self, name):
            return Info()

    with pytest.raises(ValueError, match="metadata"):
        validate_collection(Client(), {"corpus_version": "v1", "chunker_version": "v2"})
    with pytest.raises(ValueError, match="metadata"):
        validate_collection(Client(), {"corpus_version": "v1", "chunker_version": "old"}, "wrong-model")


def test_google_corpus_setup_indexes_all_documents_and_can_resume():
    from qdrant_client import QdrantClient
    from evaluation.corpus import index_corpus

    chunks = [
        {"document": "a.pdf", "chunk_index": 0, "content": "first"},
        {"document": "b.pdf", "chunk_index": 0, "content": "second"},
    ]
    client = QdrantClient(":memory:")
    try:
        embed = lambda texts, input_type: [[1.0, 0.0] for _ in texts]
        index_corpus(client, chunks, embed, "test-model", 2)
        index_corpus(client, chunks, embed, "test-model", 2)
        assert client.count("google_eval_chunks").count == 2
        assert client.get_collection("google_eval_chunks").config.metadata["corpus_version"].startswith("sha256:")
        with pytest.raises(ValueError, match="metadata"):
            index_corpus(client, chunks[:-1], embed, "test-model", 2)
        assert client.count("google_eval_chunks").count == 2
    finally:
        client.close()


def test_legacy_proposals_keep_cross_document_labels_and_are_not_reviewed():
    from evaluation.corpus import propose_legacy_labels

    source = {"metadata": {"source_document": "a.pdf"}, "questions": [
        {"id": "q", "relevant_chunks": [0, {"document": "b.pdf", "chunk_index": 0}]}]}
    chunks = [{"document": "a.pdf", "chunk_index": 0, "content": "a text"},
              {"document": "b.pdf", "chunk_index": 0, "content": "b text"}]
    labels = propose_legacy_labels(source, chunks)
    assert labels["cases"]["q"]["reviewed_by"] == ""
    assert [x["document"] for x in labels["cases"]["q"]["chunks"]] == ["a.pdf", "b.pdf"]
    with pytest.raises(ValueError, match="review"):
        google_cases({"questions": [{"id": "q", "question": "q"}]}, labels)


def test_incomplete_index_is_rejected_before_scoring():
    from qdrant_client import QdrantClient
    from evaluation.corpus import index_corpus, corpus_version, CHUNKER_VERSION
    from evaluation.google import validate_collection

    chunks = [{"document": "a.pdf", "chunk_index": i, "content": str(i)} for i in range(33)]
    client = QdrantClient(":memory:")
    calls = 0

    def failing_embed(texts, input_type):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("interrupted")
        return [[1.0, 0.0] for _ in texts]

    try:
        with pytest.raises(RuntimeError, match="interrupted"):
            index_corpus(client, chunks, failing_embed, "test-model", 2)
        labels = {"corpus_version": corpus_version(chunks), "chunker_version": CHUNKER_VERSION}
        with pytest.raises(ValueError, match="contents"):
            validate_collection(client, labels, "test-model", chunks)
        index_corpus(client, chunks, lambda texts, input_type: [[1.0, 0.0] for _ in texts], "test-model", 2)
        validate_collection(client, labels, "test-model", chunks)
    finally:
        client.close()
