"""Seam: run_turn with an answer mode (user-chosen answer mode spec, Phase 1)."""

from test_turn import FakeGenerate, collect, deps
from turn import ChatRequest


def test_a_missing_answer_mode_means_grounded(qdrant, write_doc):
    write_doc("u", "doc-1", "Heaps keep the minimum at the root.")
    gen = FakeGenerate()

    events = collect(ChatRequest(uid="u", question="heaps"), deps(qdrant, gen))

    assert events[0] == {"type": "meta", "route": "retrieve", "answerMode": "grounded"}


def test_each_mode_selects_its_own_system_prompt(qdrant, write_doc):
    write_doc("u", "doc-1", "Heaps keep the minimum at the root.")
    grounded, opened = FakeGenerate(), FakeGenerate()

    collect(ChatRequest(uid="u", question="heaps", answer_mode="grounded"), deps(qdrant, grounded))
    collect(ChatRequest(uid="u", question="heaps", answer_mode="open"), deps(qdrant, opened))

    assert "General knowledge" not in grounded.messages[0]["content"]
    assert "say so" in grounded.messages[0]["content"].lower()
    assert "'General knowledge'" in opened.messages[0]["content"]
    assert grounded.messages[0]["content"] != opened.messages[0]["content"]


def test_open_mode_still_asks_for_citations_and_prefers_the_excerpts(qdrant, write_doc):
    write_doc("u", "doc-1", "Heaps keep the minimum at the root.")
    gen = FakeGenerate()

    collect(ChatRequest(uid="u", question="heaps", answer_mode="open"), deps(qdrant, gen))

    assert "[n]" in gen.messages[0]["content"]
    assert "prefer the excerpts" in gen.messages[0]["content"].lower()


def test_meta_comes_before_sources_and_the_first_token(qdrant, write_doc):
    write_doc("u", "doc-1", "Heaps keep the minimum at the root.")

    events = collect(ChatRequest(uid="u", question="heaps", answer_mode="open"), deps(qdrant, FakeGenerate()))

    assert [e["type"] for e in events] == ["meta", "sources", "token", "token", "done"]
    assert events[0] == {"type": "meta", "route": "retrieve", "answerMode": "open"}


def test_an_unknown_answer_mode_is_rejected_by_the_request_model():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ChatRequest(uid="u", question="q", answer_mode="anything-goes")
