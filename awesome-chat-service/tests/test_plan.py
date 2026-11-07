"""Seam: run_turn with a Retrieval Plan (chat ticket 03, ADR-0007).

Deterministic: the planner and reranker are injected fakes; Qdrant is in-memory.
The live counterpart, judged by gpt-5-mini, is tests/test_plan_live_eval.py.
"""

import asyncio
import datetime as dt
import json

from conftest import fake_embedder, fake_sparse_embedder

from turn import ChatRequest, DocRef, Message, TurnDeps, run_turn


class FakeGenerate:
    def __init__(self):
        self.messages = None

    async def __call__(self, messages):
        self.messages = messages
        yield "ok"


class FakePlanner:
    """Returns a canned reply (JSON text, or raises) and records what it was shown."""

    def __init__(self, reply):
        self.reply = reply
        self.prompt = None

    async def __call__(self, messages):
        self.prompt = "\n".join(m["content"] for m in messages)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply if isinstance(self.reply, str) else json.dumps(self.reply)


class OverlapReranker:
    """Deterministic scoring: word overlap with the query — enough to tell topics apart."""

    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    async def __call__(self, query, texts):
        self.calls.append(query)
        if self.fail:
            raise RuntimeError("voyage down")
        q = set(query.lower().split())
        scores = [len(q & set(t.lower().split())) for t in texts]
        return sorted(range(len(texts)), key=lambda i: -scores[i])


class CountingEmbedder:
    def __init__(self):
        self.calls = 0
        self.inner = fake_embedder()

    def __call__(self, texts, input_type, token_size=None):
        self.calls += 1
        return self.inner(texts, input_type, token_size)


def make_deps(qdrant, planner, reranker=None, top_k=4, embed=None):
    return TurnDeps(
        qdrant,
        embed or fake_embedder(),
        fake_sparse_embedder(),
        FakeGenerate(),
        top_k=top_k,
        plan_fn=planner,
        rerank_fn=reranker or OverlapReranker(),
        today=lambda: dt.date(2026, 11, 6),
    )


def collect(request, d):
    async def go():
        return [e async for e in run_turn(request, d)]

    return asyncio.run(go())


DOCS = [DocRef(doc_id="doc-sre", file_name="sre-notes.md"), DocRef(doc_id="doc-health", file_name="health-study.pdf")]


def test_plan_event_streams_first_with_the_standalone_question_and_sub_queries(qdrant, write_doc):
    write_doc("u", "doc-sre", "An error budget is 100% minus the SLO.")
    planner = FakePlanner({"standalone": "What is an error budget?", "sub_queries": ["error budget definition"]})

    events = collect(ChatRequest(uid="u", question="what's that?", documents=DOCS), make_deps(qdrant, planner))

    assert events[0] == {
        "type": "plan",
        "standalone": "What is an error budget?",
        "sub_queries": ["error budget definition"],
        "degraded": False,
    }
    assert [e["type"] for e in events[1:]] == ["meta", "sources", "token", "done"]


def test_planner_sees_todays_date_the_manifest_titles_and_recent_messages(qdrant):
    planner = FakePlanner({"standalone": "q", "sub_queries": []})
    history = [Message(role="user", content="Tell me about error budgets"), Message(role="assistant", content="They are 100% minus SLO.")]

    collect(ChatRequest(uid="u", question="explain that more simply", history=history, documents=DOCS), make_deps(qdrant, planner))

    assert "2026-11-06" in planner.prompt
    assert "sre-notes.md" in planner.prompt and "health-study.pdf" in planner.prompt
    assert "Tell me about error budgets" in planner.prompt
    assert "explain that more simply" in planner.prompt


def test_zero_sub_queries_skips_search_and_rerank(qdrant, write_doc):
    write_doc("u", "doc-sre", "An error budget is 100% minus the SLO.")
    embed = CountingEmbedder()
    reranker = OverlapReranker()
    planner = FakePlanner({"standalone": "Thanks!", "sub_queries": []})
    deps = make_deps(qdrant, planner, reranker, embed=embed)

    events = collect(ChatRequest(uid="u", question="Thanks!", documents=DOCS), deps)

    assert [e["type"] for e in events] == ["plan", "meta", "token", "done"]
    assert embed.calls == 0 and reranker.calls == []
    assert "Excerpts" not in deps.generate_fn.messages[-1]["content"]
    # Earlier answers' [n] markers don't map to this Turn's (empty) Sources.
    assert "do not include [n] citations" in deps.generate_fn.messages[-1]["content"].lower()


def test_compound_question_returns_sources_from_both_documents(qdrant, write_doc):
    # ADR-0007 regression: one Sub-query's strong lexical matches must not take every slot.
    write_doc("u", "doc-sre", *[f"error budget burn rate alert policy note {i}" for i in range(6)])
    write_doc("u", "doc-health", "high cholesterol risk factors among adults")
    planner = FakePlanner({
        "standalone": "What is an error budget, and which factors were linked to high cholesterol?",
        "sub_queries": ["error budget burn rate", "high cholesterol risk factors"],
    })

    events = collect(ChatRequest(uid="u", question="error budget + cholesterol?", documents=DOCS), make_deps(qdrant, planner, top_k=4))

    sources = next(e for e in events if e["type"] == "sources")["sources"]
    assert {s["doc_id"] for s in sources} == {"doc-sre", "doc-health"}
    assert [s["n"] for s in sources] == list(range(1, len(sources) + 1))
    assert len(sources) <= 4


def test_bad_planner_json_falls_back_to_pass_through_and_marks_degraded(qdrant, write_doc):
    write_doc("u", "doc-sre", "An error budget is 100% minus the SLO.")

    events = collect(ChatRequest(uid="u", question="error budget?", documents=DOCS), make_deps(qdrant, FakePlanner("not json")))

    assert events[0] == {"type": "plan", "standalone": "error budget?", "sub_queries": ["error budget?"], "degraded": True}
    assert "sources" in [e["type"] for e in events]


def test_planner_exception_also_falls_back(qdrant):
    events = collect(ChatRequest(uid="u", question="q", documents=DOCS), make_deps(qdrant, FakePlanner(RuntimeError("openai down"))))

    assert events[0]["degraded"] is True and events[-1] == {"type": "done"}


def test_rerank_failure_keeps_rrf_order_and_marks_degraded(qdrant, write_doc):
    write_doc("u", "doc-sre", "An error budget is 100% minus the SLO.", "Burn rate tracks budget use.")
    planner = FakePlanner({"standalone": "error budget?", "sub_queries": ["error budget"]})

    events = collect(ChatRequest(uid="u", question="error budget?", documents=DOCS), make_deps(qdrant, planner, OverlapReranker(fail=True)))

    assert events[0]["degraded"] is True
    assert [e["type"] for e in events[1:]] == ["meta", "sources", "token", "done"]


def test_sub_queries_are_capped_at_three(qdrant):
    planner = FakePlanner({"standalone": "q", "sub_queries": ["a", "b", "c", "d", "e"]})

    events = collect(ChatRequest(uid="u", question="q", documents=DOCS), make_deps(qdrant, planner))

    assert events[0]["sub_queries"] == ["a", "b", "c"]


import pytest  # noqa: E402


@pytest.mark.parametrize("mode", ["grounded", "open"])
def test_no_search_turn_gets_a_system_prompt_that_allows_answering_from_the_conversation(qdrant, mode):
    # "put that in a table" has no excerpts by design. A system prompt that says
    # "answer only from the numbered excerpts" would make the model refuse it.
    planner = FakePlanner({"standalone": "Put that in a table.", "sub_queries": []})
    deps = make_deps(qdrant, planner)

    collect(ChatRequest(uid="u", question="put that in a table", answer_mode=mode, documents=DOCS), deps)

    system = deps.generate_fn.messages[0]["content"].lower()
    assert "only the numbered excerpts" not in system
    assert "conversation" in system
    assert "no new search" in system


@pytest.mark.parametrize(
    "bad_sub_queries",
    [[None], [""], ["   "], [3], ["ok", None], {"a": "b"}, "heaps"],
)
def test_invalid_sub_query_entries_degrade_instead_of_silently_skipping_search(qdrant, write_doc, bad_sub_queries):
    # {"standalone": "Explain heaps", "sub_queries": [null]} must not become a valid
    # zero-search plan: the user asked a question and would get no retrieval.
    write_doc("u", "doc-sre", "An error budget is 100% minus the SLO.")
    planner = FakePlanner({"standalone": "Explain heaps", "sub_queries": bad_sub_queries})

    events = collect(ChatRequest(uid="u", question="Explain heaps", documents=DOCS), make_deps(qdrant, planner))

    assert events[0] == {"type": "plan", "standalone": "Explain heaps", "sub_queries": ["Explain heaps"], "degraded": True}
    assert "sources" in [e["type"] for e in events]
