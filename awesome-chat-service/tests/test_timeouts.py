"""Every upstream the chat service calls has a finite timeout (chat ticket 03 review).

A thread already blocked in a synchronous Voyage call can't be cancelled, so the
client-level timeout is what bounds how long an abandoned search lingers.
"""

import sys
import types

import pytest


class Recorder:
    """Stands in for a client class; remembers how it was constructed."""

    instances: list = []

    def __init__(self, *args, **kwargs):
        self.kwargs = kwargs
        Recorder.instances.append(self)


@pytest.fixture(autouse=True)
def reset():
    Recorder.instances = []
    yield


def test_the_query_embedder_is_built_with_a_timeout(monkeypatch):
    monkeypatch.setitem(sys.modules, "voyageai", types.SimpleNamespace(Client=Recorder))
    monkeypatch.setenv("VOYAGE_API_KEY", "test-key")
    from retrieval.embedding import create_embedder

    create_embedder(timeout=7.5)

    assert Recorder.instances[0].kwargs["timeout"] == 7.5


def test_the_embedder_default_is_unchanged_for_the_ingest_worker(monkeypatch):
    monkeypatch.setitem(sys.modules, "voyageai", types.SimpleNamespace(Client=Recorder))
    monkeypatch.setenv("VOYAGE_API_KEY", "test-key")
    from retrieval.embedding import create_embedder

    create_embedder()

    assert "timeout" not in Recorder.instances[0].kwargs  # ingest keeps the SDK default


def test_the_reranker_is_built_with_a_timeout_and_a_single_retry(monkeypatch):
    monkeypatch.setitem(sys.modules, "voyageai", types.SimpleNamespace(Client=Recorder))
    monkeypatch.setenv("VOYAGE_API_KEY", "test-key")
    monkeypatch.setenv("CHAT_UPSTREAM_TIMEOUT_S", "9")
    from rerank import create_reranker

    create_reranker()

    kwargs = Recorder.instances[0].kwargs
    assert kwargs["timeout"] == 9.0
    assert kwargs["max_retries"] == 1


def test_the_openai_client_has_finite_connect_read_and_total_timeouts(monkeypatch):
    import generate

    monkeypatch.setattr(generate, "_client", None)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(AsyncOpenAI=Recorder))
    monkeypatch.setenv("CHAT_GENERATION_TIMEOUT_S", "45")

    generate._openai()

    timeout = Recorder.instances[0].kwargs["timeout"]
    assert timeout.read == 45.0  # between streamed chunks, not the whole answer
    assert timeout.connect <= 10
    assert 0 < timeout.write <= 60 and 0 < timeout.pool <= 60


def test_the_planner_call_has_its_own_short_timeout(monkeypatch):
    import asyncio

    import generate

    seen = {}

    class FakeCompletions:
        async def create(self, **kwargs):
            seen.update(kwargs)
            return types.SimpleNamespace(choices=[types.SimpleNamespace(message=types.SimpleNamespace(content="{}"))])

    fake = types.SimpleNamespace(chat=types.SimpleNamespace(completions=FakeCompletions()))
    monkeypatch.setattr(generate, "_client", fake)
    monkeypatch.setenv("CHAT_UPSTREAM_TIMEOUT_S", "12")

    asyncio.run(generate.plan_fn([{"role": "user", "content": "x"}]))

    assert seen["timeout"] == 12.0


def test_rerank_calls_run_on_the_given_bounded_executor(monkeypatch):
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    seen = {}

    class FakeVoyage:
        def __init__(self, **kwargs):
            pass

        def rerank(self, query, texts, model):
            import threading

            seen["thread"] = threading.current_thread().name
            return types.SimpleNamespace(results=[types.SimpleNamespace(index=0)])

    monkeypatch.setitem(sys.modules, "voyageai", types.SimpleNamespace(Client=FakeVoyage))
    monkeypatch.setenv("VOYAGE_API_KEY", "test-key")
    from rerank import create_reranker

    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bounded-search")
    rerank = create_reranker(executor=executor)

    assert asyncio.run(rerank("q", ["a"])) == [0]
    assert seen["thread"].startswith("bounded-search")
