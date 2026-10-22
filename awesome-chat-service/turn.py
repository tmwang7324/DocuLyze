"""`run_turn(request, deps)` — one Turn as a stream of events (ADR-0006).

Tracer version (chat ticket 02): the Retrieval Plan is a pass-through (the raw
question is the only Sub-query) → hybrid search over the user's Scope → gpt-5.

Events, in order:
    {"type": "token", "text": "..."}   zero or more
    {"type": "done"}                    the answer finished
    {"type": "error", "message": "..."} instead of done; never raised to the caller

The service is stateless: Next sends the uid (from the session cookie), the
history and the question; Next owns every Conversation write.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel
from retrieval.vector_store import query_user_chunks

log = logging.getLogger("chat")

SYSTEM_PROMPT = (
    "You are DocuLyze, a study assistant. Answer the user's question using the "
    "excerpts from their own documents provided with it. If the excerpts don't "
    "contain the answer, say so plainly instead of answering from general knowledge."
)


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    uid: str
    question: str
    history: list[Message] = []
    doc_ids: list[str] | None = None  # the Conversation's Scope; None = all ready documents


@dataclass
class TurnDeps:
    qdrant: Any
    embed_fn: Callable
    sparse_embed_fn: Callable
    generate_fn: Callable[[list[dict]], AsyncIterator[str]]
    top_k: int = 8


def build_messages(request: ChatRequest, chunks: list[dict]) -> list[dict]:
    """Chat Context order: instructions → history → retrieved chunks + question.
    Chunks go last so the stable prefix hits OpenAI's prompt cache."""
    excerpts = "\n\n".join(
        f"[{i}] {c['metadata'].get('breadcrumb', '')}\n{c['content']}"
        for i, c in enumerate(chunks, start=1)
    ) or "(no matching excerpts)"
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        *({"role": m.role, "content": m.content} for m in request.history),
        {"role": "user", "content": f"Excerpts:\n{excerpts}\n\nQuestion: {request.question}"},
    ]


async def run_turn(request: ChatRequest, deps: TurnDeps) -> AsyncIterator[dict]:
    try:
        chunks = await asyncio.to_thread(
            query_user_chunks,
            deps.qdrant,
            deps.embed_fn,
            deps.sparse_embed_fn,
            request.uid,
            request.question,
            n_results=deps.top_k,
            doc_ids=request.doc_ids,
        )
    except Exception:
        log.exception("retrieval failed for uid=%s", request.uid)
        yield {"type": "error", "message": "Couldn't search your documents."}
        return

    try:
        async for text in deps.generate_fn(build_messages(request, chunks)):
            yield {"type": "token", "text": text}
    except Exception:
        log.exception("generation failed for uid=%s", request.uid)
        yield {"type": "error", "message": "Answer failed."}
        return
    yield {"type": "done"}
