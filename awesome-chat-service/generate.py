"""The generation boundary (ADR-0006) — the only place OpenAI is called.

`generate_fn(messages) -> AsyncIterator[str]` streams answer text. run_turn
takes it as a dependency, so tests swap in a fake and never touch the network.

Stopping: when the browser disconnects, Starlette cancels the response task,
the `async with` below exits, and the OpenAI stream is closed — that is what
actually halts generation (and billing) upstream.
"""

import logging
from collections.abc import AsyncIterator

from config import chat_model, chat_reasoning_effort, openai_api_key

log = logging.getLogger("chat")

_client = None


def _openai():
    global _client
    if _client is None:
        from openai import AsyncOpenAI

        _client = AsyncOpenAI(api_key=openai_api_key())
    return _client


async def generate_fn(messages: list[dict]) -> AsyncIterator[str]:
    stream = await _openai().chat.completions.create(
        model=chat_model(),
        messages=messages,
        reasoning_effort=chat_reasoning_effort(),
        stream=True,
    )
    chunks, finished = 0, False
    async with stream:
        try:
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    chunks += 1
                    yield chunk.choices[0].delta.content
            finished = True
        finally:
            log.info("openai stream closed: %s after %d chunks", "finished" if finished else "cancelled", chunks)
