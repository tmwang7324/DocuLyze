"""Seam: run_turn(request, deps) — assert on the event sequence (chat ticket 02)."""

import asyncio

from conftest import fake_embedder, fake_sparse_embedder

from turn import ChatRequest, Message, TurnDeps, run_turn


class FakeGenerate:
    """Records the Chat Context it was given and streams fixed tokens."""

    def __init__(self, tokens=("Hello", " world"), fail_after: int | None = None):
        self.tokens = tokens
        self.fail_after = fail_after
        self.messages = None
        self.closed = False

    async def __call__(self, messages):
        self.messages = messages
        try:
            for i, t in enumerate(self.tokens):
                if self.fail_after is not None and i == self.fail_after:
                    raise RuntimeError("openai down")
                yield t
        finally:
            self.closed = True

    def prompt(self) -> str:
        return self.messages[-1]["content"]


def deps(qdrant, generate) -> TurnDeps:
    return TurnDeps(qdrant, fake_embedder(), fake_sparse_embedder(), generate, top_k=50)


def collect(request, d) -> list[dict]:
    async def go():
        return [e async for e in run_turn(request, d)]

    return asyncio.run(go())


def test_turn_streams_tokens_then_done(qdrant, write_doc):
    write_doc("user-a", "doc-1", "Recursion reduces a problem to a smaller instance.")
    gen = FakeGenerate()

    events = collect(ChatRequest(uid="user-a", question="What is recursion?"), deps(qdrant, gen))

    assert events == [
        {"type": "token", "text": "Hello"},
        {"type": "token", "text": " world"},
        {"type": "done"},
    ]
    assert "Recursion reduces a problem" in gen.prompt()


def test_turn_never_sees_another_users_chunks(qdrant, write_doc):
    write_doc("user-a", "doc-a", "Alice private salary notes.")
    write_doc("user-b", "doc-b", "Bob lecture notes on salary bands.")
    gen = FakeGenerate()

    collect(ChatRequest(uid="user-b", question="salary notes"), deps(qdrant, gen))

    assert "Bob lecture notes" in gen.prompt()
    assert "Alice private" not in gen.prompt()


def test_turn_respects_the_scope(qdrant, write_doc):
    write_doc("user-a", "doc-1", "Stacks are last in first out.")
    write_doc("user-a", "doc-2", "Queues are first in first out.")
    gen = FakeGenerate()

    collect(ChatRequest(uid="user-a", question="first out", doc_ids=["doc-2"]), deps(qdrant, gen))

    assert "Queues" in gen.prompt()
    assert "Stacks" not in gen.prompt()


def test_chat_context_order_is_system_history_then_question(qdrant, write_doc):
    write_doc("user-a", "doc-1", "Some notes.")
    gen = FakeGenerate()
    history = [Message(role="user", content="earlier q"), Message(role="assistant", content="earlier a")]

    collect(ChatRequest(uid="user-a", question="new q", history=history), deps(qdrant, gen))

    assert [m["role"] for m in gen.messages] == ["system", "user", "assistant", "user"]
    assert gen.messages[1]["content"] == "earlier q"
    assert gen.prompt().endswith("Question: new q")


def test_retrieval_failure_is_an_error_event_and_skips_generation():
    class BrokenQdrant:
        def query_points(self, *a, **k):
            raise ConnectionError("qdrant down")

    gen = FakeGenerate()

    events = collect(ChatRequest(uid="user-a", question="q"), deps(BrokenQdrant(), gen))

    assert [e["type"] for e in events] == ["error"]
    assert gen.messages is None


def test_generation_failure_mid_stream_ends_with_error_not_done(qdrant, write_doc):
    write_doc("user-a", "doc-1", "Notes.")
    gen = FakeGenerate(tokens=("partial", " more"), fail_after=1)

    events = collect(ChatRequest(uid="user-a", question="q"), deps(qdrant, gen))

    assert [e["type"] for e in events] == ["token", "error"]


def test_closing_the_turn_closes_generation(qdrant, write_doc):
    # Stop = the client disconnects and the turn generator is closed mid-stream;
    # that close must reach generate_fn so the OpenAI stream is released.
    write_doc("user-a", "doc-1", "Notes.")
    gen = FakeGenerate(tokens=("a", "b", "c", "d"))

    async def go():
        turn = run_turn(ChatRequest(uid="user-a", question="q"), deps(qdrant, gen))
        first = await anext(turn)
        await turn.aclose()
        return first

    assert asyncio.run(go()) == {"type": "token", "text": "a"}
    assert gen.closed
