import asyncio
import json

import main


def test_chat_controller_streams_rag_turn_events(monkeypatch):
    deps = object()
    monkeypatch.setattr(main, "turn_deps", lambda: deps, raising=False)

    async def fake_turn(request, supplied_deps):
        assert request.question == "What is recursion?"
        assert supplied_deps is deps
        yield {"type": "token", "text": "Grounded answer"}
        yield {"type": "done"}

    monkeypatch.setattr(main, "run_turn", fake_turn, raising=False)

    async def collect():
        response = await main.chat_controller(
            main.ChatRequest(uid="user-a", question="What is recursion?")
        )
        frames = [chunk async for chunk in response.body_iterator]
        return response, frames

    response, frames = asyncio.run(collect())
    events = [json.loads(frame.removeprefix("data: ").strip()) for frame in frames]

    assert response.media_type == "text/event-stream"
    assert events == [{"type": "token", "text": "Grounded answer"}, {"type": "done"}]
