"""Live checks for the shared clients under concurrency (chat ticket 03 review).

The chat service shares ONE Qdrant client, ONE Voyage embedder and ONE fastembed
BM25 model across every request, each called from worker threads. This verifies
that against the real services, using a synthetic uid that owns no data, so no
real user's documents are read.

Opt-in (needs network + keys; costs fractions of a cent):
    RUN_LIVE_EVAL=1 uv run pytest -q tests/test_concurrency_live.py -s
"""

import asyncio
import os
import statistics
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE_EVAL") != "1"
    or not os.environ.get("VOYAGE_API_KEY")
    or not os.environ.get("QDRANT_URL"),
    reason="live eval: set RUN_LIVE_EVAL=1 with VOYAGE_API_KEY and QDRANT_URL (repo-root .env)",
)

SYNTHETIC_UID = "synthetic-concurrency-check-no-docs"
TEXTS = [f"query number {i}: error budget, heap insertion, cholesterol risk factor {i * 7}" for i in range(12)]


def test_sparse_embedder_is_deterministic_when_shared_across_threads():
    from retrieval.embedding import create_sparse_embedder

    embed = create_sparse_embedder()
    expected = [embed([t], input_type="query")[0] for t in TEXTS]  # sequential reference

    with ThreadPoolExecutor(max_workers=16) as pool:
        got = list(pool.map(lambda t: embed([t], input_type="query")[0], TEXTS * 4))

    for i, vec in enumerate(got):
        ref = expected[i % len(TEXTS)]
        assert vec.indices == ref.indices and vec.values == ref.values, f"result {i} differs under concurrency"


def test_voyage_embedder_never_crosses_responses_when_shared_across_threads():
    """What matters is that a thread gets ITS OWN text's embedding back. (Measured
    2026-11-06: values drift ~0.002 per component between concurrent/batched and
    sequential calls — server-side numerics, since sequential repeats are
    bit-identical — so exact equality is the wrong check; cosine to the right
    reference is.)"""
    import math

    from retrieval.embedding import create_embedder

    def cosine(a, b):
        return sum(x * y for x, y in zip(a, b)) / math.sqrt(sum(x * x for x in a) * sum(y * y for y in b))

    embed = create_embedder(timeout=15)
    texts = TEXTS[:4]
    refs = [embed([t], input_type="query")[0] for t in texts]

    with ThreadPoolExecutor(max_workers=8) as pool:
        got = list(pool.map(lambda t: embed([t], input_type="query")[0], texts * 3))

    for i, vec in enumerate(got):
        own = i % len(texts)
        scores = [cosine(vec, r) for r in refs]
        assert scores[own] > 0.999, f"result {i} is not close to its own text ({scores[own]:.5f})"
        assert max(range(len(refs)), key=scores.__getitem__) == own, f"result {i} matches another text better: cross-talk"


def test_real_turns_run_concurrently_through_the_bounded_pool_without_errors():
    """Real Qdrant + Voyage + fastembed, a fake planner/generator (no OpenAI), a tight
    pool: many concurrent Turns must all complete and never exceed the bound."""
    import threading

    from retrieval.embedding import create_embedder, create_sparse_embedder
    from retrieval.vector_store import qdrant_client

    from turn import ChatRequest, DocRef, TurnDeps, run_turn

    in_flight = {"now": 0, "max": 0}
    lock = threading.Lock()
    real_embed = create_embedder(timeout=15)

    def tracked_embed(texts, input_type, token_size=None):
        with lock:
            in_flight["now"] += 1
            in_flight["max"] = max(in_flight["max"], in_flight["now"])
        try:
            return real_embed(texts, input_type=input_type, token_size=token_size)
        finally:
            with lock:
                in_flight["now"] -= 1

    async def planner(messages):
        return '{"standalone": "q", "sub_queries": ["error budget", "heap insertion", "cholesterol risk"]}'

    async def generate(messages):
        yield "ok"

    deps = TurnDeps(
        qdrant_client(), tracked_embed, create_sparse_embedder(), generate,
        top_k=4, plan_fn=planner, search_executor=ThreadPoolExecutor(max_workers=4),
    )
    request = ChatRequest(uid=SYNTHETIC_UID, question="q", documents=[DocRef(doc_id="none", file_name="none.md")])

    async def one():
        return [e async for e in run_turn(request, deps)]

    async def many():
        return await asyncio.gather(*(one() for _ in range(8)))

    started = time.monotonic()
    results = asyncio.run(many())
    elapsed = time.monotonic() - started
    print(f"\n8 concurrent Turns x 3 sub-queries on a 4-thread pool: {elapsed:.2f}s, max in flight={in_flight['max']}")

    errors = [e for r in results for e in r if e["type"] == "error"]
    assert not errors, errors
    assert all(r[-1] == {"type": "done"} for r in results)
    assert in_flight["max"] <= 4


def test_measure_rerank_sequential_vs_parallel():
    """Measurement, not a gate: decides whether per-Sub-query rerank should be parallelized."""
    if not os.environ.get("RERANK_MEASURE", "1") == "1":
        pytest.skip("RERANK_MEASURE=0")
    from rerank import create_reranker

    rerank = create_reranker()
    candidates = [f"Passage {i} about error budgets, burn rate, heaps and cholesterol factors, version {i}." * 3 for i in range(20)]
    queries = ["error budget definition", "binary heap insertion", "cholesterol risk factors"]

    async def sequential():
        for q in queries:
            await rerank(q, candidates)

    async def parallel():
        await asyncio.gather(*(rerank(q, candidates) for q in queries))

    asyncio.run(rerank(queries[0], candidates))  # warm the connection

    seq, par = [], []
    for _ in range(5):
        t = time.monotonic()
        asyncio.run(sequential())
        seq.append(time.monotonic() - t)
        t = time.monotonic()
        asyncio.run(parallel())
        par.append(time.monotonic() - t)
    print(
        f"\nrerank x{len(queries)} (20 candidates each), 5 runs: "
        f"sequential median {statistics.median(seq) * 1000:.0f}ms, "
        f"parallel median {statistics.median(par) * 1000:.0f}ms"
    )
