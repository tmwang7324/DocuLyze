import asyncio

import pytest

from evaluation import ragas_scoring as rs


def _scorers(**overrides):
    async def fixed(**inputs):
        return 0.5

    return {name: overrides.get(name, fixed) for name in rs.RAGAS_METRICS}


def _result(case_id, status="scored", group="papertext", reference="Spanish"):
    return {"id": case_id, "group": group, "status": status, "question": "Which language?",
            "reference_answer": reference,
            "ranked_chunks": [{"content": f"chunk {i}", "breadcrumb": f"doc > s{i}"} for i in range(10)]}


def test_prompt_and_generation_config_come_from_the_chat_service():
    prompt = rs.production_prompt()
    assert prompt.startswith("You are DocuLyze") and "[n]" in prompt
    config = rs.production_generation_config()
    assert config["model"] and config["reasoning_effort"] and config["top_k"] == 8


def test_messages_number_excerpts_like_the_production_turn():
    messages = rs.answer_messages("Q?", [{"breadcrumb": "a > b", "content": "x"}, {"content": "y"}], "SYS")
    assert messages[0] == {"role": "system", "content": "SYS"}
    assert messages[1]["content"] == "Excerpts:\n[1] a > b\nx\n\n[2] \ny\n\nQuestion: Q?"
    assert "(no matching excerpts)" in rs.answer_messages("Q?", [], "SYS")[1]["content"]


def test_judge_failures_and_missing_inputs_are_errors_not_scores():
    async def broken(**inputs):
        raise RuntimeError("judge timed out")

    async def out_of_range(**inputs):
        return 1.7

    inputs = {"user_input": "q", "response": "a", "reference": "", "retrieved_contexts": ["c"]}
    result = asyncio.run(rs.score_answer(inputs, _scorers(faithfulness=broken, response_relevancy=out_of_range)))
    assert result["scores"] == {}
    assert result["errors"]["context_precision"] == "Missing input: reference"
    assert result["errors"]["faithfulness"].startswith("RuntimeError")
    assert "out of range" in result["errors"]["response_relevancy"]

    async def float_noise(**inputs):
        return 1.0000000000000002

    result = asyncio.run(rs.score_answer(inputs, _scorers(faithfulness=float_noise)))
    assert result["scores"]["faithfulness"] == 1.0


def test_answers_use_top_k_contexts_and_skip_failed_retrieval():
    seen = {}

    async def generate(messages):
        seen["prompt"] = messages[1]["content"]
        return "Spanish [1]"

    async def faithfulness(**inputs):
        seen["contexts"] = inputs["retrieved_contexts"]
        return 1.0

    results = [_result("a"), _result("b", status="not_scored", group="papertab"),
               {"id": "c", "group": "papertext", "status": "failed", "error": "Retrieval failed"}]
    rows = asyncio.run(rs.evaluate_answers(results, generate, _scorers(faithfulness=faithfulness), "SYS", top_k=8))
    assert [row["id"] for row in rows] == ["a", "b"]
    assert seen["contexts"] == [f"chunk {i}" for i in range(8)]
    assert "[8] doc > s7" in seen["prompt"] and "[9]" not in seen["prompt"]
    assert rows[0]["scores"]["faithfulness"] == 1.0


def test_generation_failure_is_recorded_and_excluded_from_means():
    async def generate(messages):
        raise TimeoutError("slow")

    rows = asyncio.run(rs.evaluate_answers([_result("a")], generate, _scorers(), "SYS", top_k=8))
    rows.append({"id": "b", "group": "papertab", "generation_error": None, "answer": "x",
                 "scores": {"faithfulness": 0.25}, "errors": {"context_precision": "Missing input: reference"}})
    summary = rs.aggregate_ragas(rows)
    assert rows[0]["generation_error"].startswith("TimeoutError")
    assert summary["overall"]["generation_failed"] == 1
    assert summary["overall"]["faithfulness"] == {"mean": 0.25, "n": 1, "errors": 1}
    assert summary["overall"]["context_precision"] == {"mean": None, "n": 0, "errors": 2}
    assert summary["groups"]["papertab"]["faithfulness"]["mean"] == 0.25


def test_calibration_sample_is_fixed_and_leaves_human_columns_blank():
    rows = [{"id": str(i), "question": "q", "reference_answer": "r", "answer": "a",
             "scores": {"faithfulness": 1.0}, "errors": {}, "generation_error": None} for i in range(10)]
    first = rs.calibration_sample(rows)
    assert first == rs.calibration_sample(list(reversed(rows)))
    assert len(first) == 5 and first[0]["human_faithfulness"] is None and first[0]["judge_faithfulness"] == 1.0


def test_pinned_ragas_version_is_installed():
    ragas = pytest.importorskip("ragas")
    assert ragas.__version__ == rs.JUDGE_CONFIG["ragas_version"]
