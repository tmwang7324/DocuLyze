"""Seam: run_turn under load — bounded concurrency, timeouts, cancellation.

Chat ticket 03 review follow-up. Searches are synchronous (Voyage + Qdrant) and run
in threads; cancelling a coroutine can't stop a thread already running, so the
guarantees here are: (1) at most N searches run at once across ALL Turns,
(2) a stuck upstream fails the Turn instead of hanging it, (3) cancelling a Turn
stops its queued searches from ever starting.
"""

import asyncio
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from conftest import fake_embedder, fake_sparse_embedder
from test_plan import DOCS, FakePlanner, OverlapReranker, collect, make_deps  # noqa: F401

from turn import ChatRequest, run_turn


class SlowEmbedder:
    """Thread-safe: records how many embeds ran at once, and how many started."""

    def __init__(self, delay: float):
        self.delay = delay
        self.inner = fake_embedder()
        self.lock = threading.Lock()
        self.active = 0
        self.max_active = 0
        self.started = 0

    def __call__(self, texts, input_type, token_size=None):
        with self.lock:
            self.active += 1
            self.started += 1
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(self.delay)
            return self.inner(texts, input_type, token_size)
        finally:
            with self.lock:
                self.active -= 1


THREE = {"standalone": "q", "sub_queries": ["alpha one", "beta two", "gamma three"]}


def test_concurrent_turns_never_exceed_the_search_limit(qdrant, write_doc):
    write_doc("u", "doc-sre", "alpha beta gamma notes")
    embed = SlowEmbedder(delay=0.05)
    deps = make_deps(qdrant, FakePlanner(THREE), embed=embed)
    deps.search_executor = ThreadPoolExecutor(max_workers=3)

    async def six_turns():
        async def one():
            return [e async for e in run_turn(ChatRequest(uid="u", question="q", documents=DOCS), deps)]

        return await asyncio.gather(*(one() for _ in range(6)))

    results = asyncio.run(six_turns())

    assert all(r[-1] == {"type": "done"} for r in results)
    assert embed.started == 18  # 6 turns x 3 sub-queries all ran
    assert embed.max_active <= 3  # ...but never more than 3 at once
    assert embed.max_active >= 2  # and the bound isn't vacuous: they did overlap


def test_a_stuck_search_fails_the_turn_instead_of_hanging_it(qdrant, caplog):
    embed = SlowEmbedder(delay=0.6)
    planner = FakePlanner({"standalone": "q", "sub_queries": ["alpha"]})
    deps = make_deps(qdrant, planner, embed=embed)
    deps.search_timeout_s = 0.1

    started = time.monotonic()
    with caplog.at_level(logging.ERROR, logger="chat"):
        events = collect(ChatRequest(uid="u", question="q", documents=DOCS), deps)
    elapsed = time.monotonic() - started

    assert [e["type"] for e in events] == ["plan", "error"]
    assert events[1]["message"] == "Couldn't search your documents."
    assert elapsed < 0.5
    assert any("timed out" in r.getMessage() for r in caplog.records)
    time.sleep(0.7)  # let the abandoned thread finish before the executor goes away


def test_a_stuck_rerank_degrades_to_rrf_order_instead_of_hanging(qdrant, write_doc):
    write_doc("u", "doc-sre", "alpha notes one", "alpha notes two")

    class StuckReranker:
        async def __call__(self, query, texts):
            await asyncio.sleep(5)

    planner = FakePlanner({"standalone": "q", "sub_queries": ["alpha"]})
    deps = make_deps(qdrant, planner, StuckReranker())
    deps.search_timeout_s = 0.2

    started = time.monotonic()
    events = collect(ChatRequest(uid="u", question="q", documents=DOCS), deps)

    assert time.monotonic() - started < 2
    assert events[0]["degraded"] is True
    assert "sources" in [e["type"] for e in events]


def test_cancelling_a_turn_stops_its_queued_searches_from_starting(qdrant):
    embed = SlowEmbedder(delay=0.3)
    deps = make_deps(qdrant, FakePlanner(THREE), embed=embed)
    deps.search_executor = ThreadPoolExecutor(max_workers=1)  # 1 runs, 2 queue

    async def go():
        async def consume():
            return [e async for e in run_turn(ChatRequest(uid="u", question="q", documents=DOCS), deps)]

        task = asyncio.create_task(consume())
        while embed.started == 0:  # the first search is running in its thread
            await asyncio.sleep(0.01)
        task.cancel()  # what Starlette does when the browser disconnects
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.sleep(0.8)  # long enough for any queued search to have run

    asyncio.run(go())

    assert embed.started == 1  # the running one finished; the queued two never started


def test_sub_query_reranks_run_in_parallel_and_keep_their_own_order(qdrant, write_doc):
    # Measured 2026-11-06 (live Voyage, 3 x 20 candidates): sequential ~360ms vs
    # parallel ~190ms per Turn, so per-Sub-query reranks overlap.
    write_doc("u", "doc-sre", "alpha notes", "beta notes", "gamma notes")
    active = {"now": 0, "max": 0}

    async def slow_reranker(query, texts):
        active["now"] += 1
        active["max"] = max(active["max"], active["now"])
        await asyncio.sleep(0.2)
        active["now"] -= 1
        # Rank the passage matching this Sub-query's own keyword first.
        keyword = query.split()[0]
        return sorted(range(len(texts)), key=lambda i: keyword not in texts[i])

    deps = make_deps(qdrant, FakePlanner(THREE), slow_reranker, top_k=3)

    started = time.monotonic()
    events = collect(ChatRequest(uid="u", question="q", documents=DOCS), deps)
    elapsed = time.monotonic() - started

    assert active["max"] == 3  # all three Sub-query reranks overlapped
    assert elapsed < 0.5  # ~0.2s, not 3 x 0.2s
    sources = next(e for e in events if e["type"] == "sources")["sources"]
    assert [s["text"].split()[0] for s in sources] == ["alpha", "beta", "gamma"]  # round-robin of each list's best


def test_one_sub_querys_rerank_failing_only_degrades_that_sub_query(qdrant, write_doc):
    write_doc("u", "doc-sre", "alpha notes", "beta notes", "gamma notes")

    async def flaky(query, texts):
        if query.startswith("beta"):
            raise RuntimeError("voyage hiccup")
        return list(range(len(texts)))

    events = collect(
        ChatRequest(uid="u", question="q", documents=DOCS), make_deps(qdrant, FakePlanner(THREE), flaky, top_k=3)
    )

    assert events[0]["degraded"] is True
    assert "sources" in [e["type"] for e in events]
