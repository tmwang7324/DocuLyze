import asyncio
import json
import subprocess
import sys

import pytest

from evaluation import uda
from evaluation.benchmark import run_suite


def _source():
    return {"questions": [
        {"id": "uda-tathybrid-q1", "question": "What was Goodwill?", "ground_truth_answer": "2,306.8",
         "domain": "tathybrid", "source_doc_name": "acme_2019", "type": "factual_lookup"},
        {"id": "uda-papertab-q2", "question": "Which models?", "ground_truth_answer": "LSTM",
         "domain": "papertab", "source_doc_name": "1234.5678", "type": "factual_lookup"},
        {"id": "uda-papertext-q3", "question": "Is it reported?", "ground_truth_answer": "No",
         "domain": "papertext", "source_doc_name": "1111.2222", "type": "reasoning"},
        {"id": "uda-tathybrid-multi_hop-01", "question": "", "status": "pending_authoring",
         "domain": "tathybrid", "source_doc_name": ""},
    ]}


def _extended():
    return {
        "tathybrid": {"acme_2019": [{"q_uid": "q1", "question": "What was Goodwill?", "facts": ["2,306.8", "2,306.8"],
                                     "answers": {"answer": ["2,306.8"], "scale": "million"}, "derivation": ""}]},
        "papertab": {"1234.5678": [{"q_uid": "q2", "question": "Which models?", "evidence": [
            {"highlighted_evidence": ["FLOAT SELECTED: Table 1: Results for baselines."]},
            {"highlighted_evidence": ["second annotator"]}]}]},
        "papertext": {"1111.2222": [{"q_uid": "q3", "question": "Is it reported?", "evidence": [
            {"highlighted_evidence": []}]}]},
    }


def test_import_joins_by_identifier_and_excludes_placeholders():
    evidence = uda.import_evidence(_source(), _extended())
    assert evidence["excluded_placeholders"] == ["uda-tathybrid-multi_hop-01"]
    tat = evidence["cases"]["uda-tathybrid-q1"]
    assert tat["reference_passages"] == [{"id": "fact1", "text": "2,306.8", "kind": "table_value"}]
    assert tat["reference_answer"] == "2,306.8 million"
    caption = evidence["cases"]["uda-papertab-q2"]["reference_passages"]
    assert caption == [{"id": "e1", "text": "Table 1: Results for baselines.", "kind": "caption"}]
    assert evidence["cases"]["uda-papertext-q3"]["reference_passages"] == []


def test_import_rejects_unverified_identifiers():
    extended = _extended()
    extended["papertab"]["1234.5678"][0]["question"] = "A different question"
    with pytest.raises(ValueError, match="does not match"):
        uda.import_evidence(_source(), extended)
    extended = _extended()
    extended["tathybrid"]["acme_2019"] = []
    with pytest.raises(ValueError, match="Expected one"):
        uda.import_evidence(_source(), extended)


def _corpus():
    return [{"document": "acme_2019", "chunk_index": 0, "content": "|Balance|$ 2,306.8|"},
            {"document": "acme_2019", "chunk_index": 1, "content": "Total goodwill was 12,306.8 in 2019."},
            {"document": "1234.5678", "chunk_index": 0, "content": "Table 1: Results for baselines. |LSTM|0.4|"},
            {"document": "1111.2222", "chunk_index": 0, "content": "Unrelated text."}]


def test_fact_matching_respects_number_boundaries():
    assert uda._fact_pattern("2,306.8").search("|$ 2,306.8|")
    assert not uda._fact_pattern("2,306.8").search("12,306.8")
    assert uda._fact_pattern("2018").search("|July28,2018|")


def test_proposals_are_unreviewed_and_case_scoring_requires_review(monkeypatch):
    monkeypatch.setattr(uda, "chunker_version", lambda: "test-chunker")
    evidence = uda.import_evidence(_source(), _extended())
    labels = uda.propose_labels(evidence, _corpus())
    assert all(label["reviewed_by"] == "" for label in labels["cases"].values())
    assert labels["cases"]["uda-tathybrid-q1"]["chunks"][0]["chunk_index"] == 0

    cases = {case["id"]: case for case in uda.uda_cases(evidence, labels, _corpus())}
    assert "review" in cases["uda-tathybrid-q1"]["invalid_mapping"]
    assert cases["uda-papertext-q3"]["not_scored_reason"]

    cases = {case["id"]: case for case in uda.uda_cases(evidence, labels, _corpus(), allow_unreviewed=True)}
    assert cases["uda-tathybrid-q1"]["provisional"] is True
    assert cases["uda-tathybrid-q1"]["mapping"] == {("acme_2019", 0): ["fact1"]}


def test_mappings_for_another_corpus_or_chunker_are_rejected(monkeypatch):
    monkeypatch.setattr(uda, "chunker_version", lambda: "test-chunker")
    evidence = uda.import_evidence(_source(), _extended())
    labels = uda.propose_labels(evidence, _corpus())
    changed = [dict(chunk) for chunk in _corpus()]
    changed[0]["content"] = "|Balance|$ 2,306.8| edited"
    with pytest.raises(ValueError, match="different corpus"):
        uda.uda_cases(evidence, labels, changed)
    monkeypatch.setattr(uda, "chunker_version", lambda: "new-chunker")
    with pytest.raises(ValueError, match="different corpus"):
        uda.uda_cases(evidence, labels, _corpus())


def test_merged_proposals_must_quote_their_chunk_verbatim(monkeypatch):
    monkeypatch.setattr(uda, "chunker_version", lambda: "test-chunker")
    evidence = uda.import_evidence(_source(), _extended())
    good = {"uda-tathybrid-q1": {"chunks": [{"chunk_index": 0, "passage_ids": ["fact1"], "matched_text": ["2,306.8"]}]},
            "uda-papertab-q2": {"chunks": [{"chunk_index": 0, "passage_ids": ["e1"],
                                            "matched_text": ["Table 1: Results for baselines."]}],
                                "confidence": "high"}}
    labels = uda.merge_proposals(evidence, _corpus(), good, "test")
    assert labels["cases"]["uda-papertab-q2"]["confidence"] == "high"
    bad = json.loads(json.dumps(good))
    bad["uda-tathybrid-q1"]["chunks"][0]["matched_text"] = ["2,306.9"]
    with pytest.raises(ValueError, match="not verbatim"):
        uda.merge_proposals(evidence, _corpus(), bad, "test")


def test_suite_reports_not_scored_and_failed_cases_per_group(monkeypatch):
    monkeypatch.setattr(uda, "chunker_version", lambda: "test-chunker")
    evidence = uda.import_evidence(_source(), _extended())
    labels = uda.propose_labels(evidence, _corpus())
    del labels["cases"]["uda-papertab-q2"]["chunks"][:]  # an incomplete mapping fails visibly
    cases = uda.uda_cases(evidence, labels, _corpus(), allow_unreviewed=True)

    def retrieve(question, limit):
        return [{"document": "acme_2019", "chunk_index": 1, "content": "noise"},
                {"document": "acme_2019", "chunk_index": 0, "content": "|Balance|$ 2,306.8|"}]

    report = run_suite(cases, retrieve, {"strategy": "fake", "provisional": True})
    assert (report["count"], report["scored"], report["failed"], report["not_scored"]) == (3, 1, 1, 1)
    assert report["groups"]["tathybrid"]["metrics"][3]["recall"] == 1
    assert report["groups"]["tathybrid"]["metrics"][3]["precision"] == 0.5
    assert report["groups"]["papertab"]["metrics"][3]["recall"] is None
    not_scored = next(case for case in report["cases"] if case["status"] == "not_scored")
    assert not_scored["metrics"] is None and not_scored["ranked_chunks"]
    summary = uda.render_summary(report)
    assert "Provisional" in summary and "uda-papertab-q2" in summary


def test_committed_labels_match_the_current_corpus_and_chunker():
    """Fails when the chunker or a source document changes: re-propose and re-review."""
    source = json.loads(uda.QUESTIONS.read_text(encoding="utf-8"))
    evidence = json.loads(uda.EVIDENCE.read_text(encoding="utf-8"))
    labels = json.loads(uda.LABELS.read_text(encoding="utf-8"))
    chunks, _ = uda.load_corpus(source)
    cases = uda.uda_cases(evidence, labels, chunks, allow_unreviewed=True)
    assert len(cases) == 17
    assert not [case["id"] for case in cases if case.get("invalid_mapping")]
    assert sum(bool(case.get("not_scored_reason")) for case in cases) == 2


def test_cli_refuses_network_without_live_flag():
    result = subprocess.run([sys.executable, "-m", "evaluation.uda"], capture_output=True, text=True)
    assert result.returncode != 0
    assert "--live" in result.stderr
