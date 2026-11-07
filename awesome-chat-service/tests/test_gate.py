"""Seam: run_turn with a separate needs-search gate (chat ticket 03 follow-up).

One small agent (gpt-5.4-mini) decides ONLY whether a message needs a search of the
user's documents. If yes, the planner (gpt-5.4) decomposes it. The planner starts
speculatively alongside the gate and is cancelled when the gate says no.
"""

import asyncio
import json
import time

from conftest import fake_embedder
from test_plan import DOCS, CountingEmbedder, FakePlanner, OverlapReranker, collect, make_deps  # noqa: F401

from turn import ChatRequest, Message


class FakeGate:
    """Returns a canned reply (JSON text, or raises); optionally slow. Records its input."""

    def __init__(self, reply, delay: float = 0.0):
        self.reply = reply
        self.delay = delay
        self.prompt = None

    async def __call__(self, messages):
        self.prompt = "\n".join(m["content"] for m in messages)
        if self.delay:
            await asyncio.sleep(self.delay)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply if isinstance(self.reply, str) else json.dumps(self.reply)


SEARCH = {"needs_search": True}
SKIP = {"needs_search": False}
ONE = {"standalone": "What is an error budget?", "sub_queries": ["error budget definition"]}


def gated(qdrant, gate, planner, **kw):
    deps = make_deps(qdrant, planner, **kw)
    deps.needs_search_fn = gate
    return deps


def test_gate_says_no_search_skips_retrieval_and_the_plan_has_no_sub_queries(qdrant, write_doc):
    write_doc("u", "doc-sre", "An error budget is 100% minus the SLO.")
    embed, reranker = CountingEmbedder(), OverlapReranker()
    deps = gated(qdrant, FakeGate(SKIP), FakePlanner(ONE), reranker=reranker, embed=embed)

    events = collect(ChatRequest(uid="u", question="Thanks!", documents=DOCS), deps)

    assert events[0] == {"type": "plan", "standalone": "Thanks!", "sub_queries": [], "degraded": False}
    assert [e["type"] for e in events] == ["plan", "meta", "token", "done"]
    assert embed.calls == 0 and reranker.calls == []


def test_gate_says_search_hands_the_message_to_the_planner(qdrant, write_doc):
    write_doc("u", "doc-sre", "An error budget is 100% minus the SLO.")
    deps = gated(qdrant, FakeGate(SEARCH), FakePlanner(ONE))

    events = collect(ChatRequest(uid="u", question="what's that?", documents=DOCS), deps)

    assert events[0] == {
        "type": "plan", "standalone": "What is an error budget?",
        "sub_queries": ["error budget definition"], "degraded": False,
    }
    assert "sources" in [e["type"] for e in events]


def test_gate_sees_recent_messages_and_the_new_one_but_not_the_documents(qdrant):
    gate = FakeGate(SKIP)
    history = [Message(role="user", content="What is a heap?"), Message(role="assistant", content="A tree [1].")]
    deps = gated(qdrant, gate, FakePlanner(ONE))

    collect(ChatRequest(uid="u", question="put that in a table", history=history, documents=DOCS), deps)

    assert "What is a heap?" in gate.prompt and "put that in a table" in gate.prompt
    assert "sre-notes.md" not in gate.prompt  # a routing decision needs no Manifest


def test_gate_failure_falls_back_to_searching_and_marks_the_plan_degraded(qdrant, write_doc):
    write_doc("u", "doc-sre", "An error budget is 100% minus the SLO.")
    deps = gated(qdrant, FakeGate(RuntimeError("openai down")), FakePlanner(ONE))

    events = collect(ChatRequest(uid="u", question="error budget?", documents=DOCS), deps)

    assert events[0]["degraded"] is True
    assert events[0]["sub_queries"] == ["error budget definition"]
    assert "sources" in [e["type"] for e in events]


import pytest  # noqa: E402


@pytest.mark.parametrize(
    "bad_reply",
    ["not json", "[]", '{"needs_search": "yes"}', '{"needs_search": null}', "{}", '{"search": true}'],
)
def test_a_malformed_gate_reply_searches_rather_than_guessing_skip(qdrant, bad_reply):
    deps = gated(qdrant, FakeGate(bad_reply), FakePlanner(ONE))

    events = collect(ChatRequest(uid="u", question="q", documents=DOCS), deps)

    assert events[0]["degraded"] is True
    assert events[0]["sub_queries"] == ["error budget definition"]


def test_planner_returning_nothing_after_the_gate_said_search_still_searches(qdrant, write_doc):
    write_doc("u", "doc-sre", "An error budget is 100% minus the SLO.")
    deps = gated(qdrant, FakeGate(SEARCH), FakePlanner({"standalone": "Explain heaps", "sub_queries": []}))

    events = collect(ChatRequest(uid="u", question="Explain heaps", documents=DOCS), deps)

    # The gate and planner disagree; the safe side is to search with the raw question.
    assert events[0] == {"type": "plan", "standalone": "Explain heaps", "sub_queries": ["Explain heaps"], "degraded": True}
    assert "sources" in [e["type"] for e in events]


def test_the_speculative_planner_is_cancelled_when_the_gate_says_no_search(qdrant):
    class SlowPlanner:
        started = False
        cancelled = False

        async def __call__(self, messages):
            SlowPlanner.started = True
            try:
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                SlowPlanner.cancelled = True
                raise
            return json.dumps(ONE)

    # A real gate takes hundreds of ms, so the planner request is already in flight.
    deps = gated(qdrant, FakeGate(SKIP, delay=0.05), SlowPlanner())

    started = time.monotonic()
    events = collect(ChatRequest(uid="u", question="Thanks!", documents=DOCS), deps)

    assert time.monotonic() - started < 1  # didn't wait for the planner
    assert SlowPlanner.started and SlowPlanner.cancelled
    assert events[0]["sub_queries"] == []


def test_gate_and_planner_run_concurrently_on_a_search_turn(qdrant, write_doc):
    write_doc("u", "doc-sre", "An error budget is 100% minus the SLO.")

    class SlowPlanner(FakePlanner):
        async def __call__(self, messages):
            await asyncio.sleep(0.3)
            return await super().__call__(messages)

    deps = gated(qdrant, FakeGate(SEARCH, delay=0.3), SlowPlanner(ONE))

    started = time.monotonic()
    collect(ChatRequest(uid="u", question="error budget?", documents=DOCS), deps)

    assert time.monotonic() - started < 0.55  # ~0.3s, not 0.6s sequentially


def test_cancelling_the_turn_cancels_the_speculative_planner_too(qdrant):
    class SlowPlanner:
        cancelled = False

        async def __call__(self, messages):
            try:
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                SlowPlanner.cancelled = True
                raise

    from turn import run_turn

    deps = gated(qdrant, FakeGate(SEARCH, delay=5), SlowPlanner())

    async def go():
        async def consume():
            return [e async for e in run_turn(ChatRequest(uid="u", question="q", documents=DOCS), deps)]

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.1)  # gate and planner are both in flight
        task.cancel()  # the browser disconnected
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.sleep(0.05)

    asyncio.run(go())

    assert SlowPlanner.cancelled  # no orphaned gpt-5.4 request left running
