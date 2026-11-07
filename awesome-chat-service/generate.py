"""The generation boundary (ADR-0006) — the only place OpenAI is called.

`generate_fn(messages) -> AsyncIterator[str]` streams answer text. run_turn
takes it as a dependency, so tests swap in a fake and never touch the network.

Stopping: when the browser disconnects, Starlette cancels the response task,
the `async with` below exits, and the OpenAI stream is closed — that is what
actually halts generation (and billing) upstream.
"""

import logging
from collections.abc import AsyncIterator

from config import (
    chat_model,
    chat_reasoning_effort,
    generation_timeout_s,
    openai_api_key,
    planner_model,
    upstream_timeout_s,
)

log = logging.getLogger("chat")

_client = None


def _openai():
    global _client
    if _client is None:
        import httpx
        from openai import AsyncOpenAI

        # The SDK default read timeout is 600s. Read = the longest silence between
        # streamed chunks, so a hung stream fails instead of holding a Turn open.
        timeout = httpx.Timeout(connect=5.0, read=generation_timeout_s(), write=30.0, pool=30.0)
        _client = AsyncOpenAI(api_key=openai_api_key(), timeout=timeout)
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


async def plan_fn(messages: list[dict]) -> str:
    """The Retrieval Plan call (ADR-0007): returns the planner's JSON text.
    Parsing and fallback live in run_turn, so this stays a thin boundary."""
    response = await _openai().chat.completions.create(
        model=planner_model(),
        messages=messages,
        response_format={"type": "json_object"},
        temperature=0,
        timeout=upstream_timeout_s(),  # a slow planner degrades the Turn; it must not stall it
    )
    return response.choices[0].message.content or ""
