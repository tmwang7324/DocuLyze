"""`run_turn(request, deps)` — one Turn as a stream of events (ADR-0006).

Retrieval Plan v1 (chat ticket 03, ADR-0007): a planner call rewrites the
question and splits it into 0–3 Sub-queries → hybrid search per Sub-query over the
user's Scope → rerank each against its own Sub-query → round-robin merge → gpt-5-mini.
Zero Sub-queries skips search entirely.

Events, in order:
    {"type": "plan", "standalone", "sub_queries", "degraded"}  always first
    {"type": "meta", "route", "answerMode"}  once, before sources and tokens
    {"type": "sources", "sources": [...]} the numbered chunks the answer may cite;
                                          omitted when nothing was retrieved
    {"type": "token", "text": "..."}   zero or more
    {"type": "done"}                    the answer finished
    {"type": "error", "message": "..."} instead of done; never raised to the caller

The service is stateless: Next sends the uid (from the session cookie), the
history and the question; Next owns every Conversation write.
"""

import asyncio
import datetime as dt
import functools
import logging
from concurrent.futures import ThreadPoolExecutor
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel
from retrieval.vector_store import query_user_chunks

from config import search_concurrency, search_timeout_s
from plan import Plan, merge_round_robin, parse_plan, pass_through, planner_messages

log = logging.getLogger("chat")

GROUNDED_PROMPT = (
    "You are DocuLyze, a study assistant. Answer the user's question using only the "
    "numbered excerpts from their own documents provided with it. Cite every claim "
    "with the excerpt's number in square brackets, like [n] or [1][3], right after "
    "the sentence it supports. If the excerpts don't contain the answer, say so "
    "plainly instead of answering from general knowledge, and cite nothing."
)

# Open mode (the user turned on "Allow general knowledge"): the excerpts still
# come first and keep their citations; anything beyond them goes in one clearly
# labelled section, so the reader can always tell the two apart.
OPEN_PROMPT = (
    "You are DocuLyze, a study assistant. Prefer the excerpts: the numbered excerpts "
    "from the user's own documents are provided with the question. Cite every claim "
    "they support with the excerpt's number in square brackets, like [n] or [1][3], "
    "right after the sentence it supports. If you add anything the excerpts do not "
    "support, put it in a separate final section headed 'General knowledge', and "
    "never cite it. If the excerpts cover nothing relevant, say so plainly, then "
    "answer from general knowledge under that same heading."
)

SYSTEM_PROMPTS = {"grounded": GROUNDED_PROMPT, "open": OPEN_PROMPT}

# A Turn whose plan has no Sub-queries ("thanks", "put that in a table") has no
# excerpts by design, so it must not be told to answer only from excerpts — the
# model would refuse. These answer from the conversation instead.
_NO_SEARCH_BASE = (
    "You are DocuLyze, a study assistant. This message needs no new search of the "
    "user's documents (no excerpts are provided this time): answer it from the "
    "conversation so far. Reformat, shorten, translate or summarize your earlier "
    "answers, or reply to thanks and greetings, and do not cite excerpts. "
)
NO_SEARCH_PROMPTS = {
    "grounded": _NO_SEARCH_BASE
    + "Don't add facts that are not already in the conversation; if the user is asking "
    "for new information, say you can look it up in their documents if they ask it as a question.",
    "open": _NO_SEARCH_BASE
    + "If you add anything that is not already in the conversation, put it in a separate "
    "final section headed 'General knowledge'.",
}


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class DocRef(BaseModel):
    doc_id: str
    file_name: str


class ChatRequest(BaseModel):
    uid: str
    question: str
    history: list[Message] = []
    # Set by Next from the Conversation, never from anything the user typed.
    answer_mode: Literal["grounded", "open"] = "grounded"
    # The Conversation's effective Scope: the ready documents this Turn may search,
    # with their names (for Sources). None = every chunk the user owns.
    documents: list[DocRef] | None = None

    def scope_ids(self) -> list[str] | None:
        return None if self.documents is None else [d.doc_id for d in self.documents]

    def file_name(self, doc_id: str) -> str:
        for d in self.documents or []:
            if d.doc_id == doc_id:
                return d.file_name
        return "Untitled document"


@dataclass
class TurnDeps:
    qdrant: Any
    embed_fn: Callable
    sparse_embed_fn: Callable
    generate_fn: Callable[[list[dict]], AsyncIterator[str]]
    top_k: int = 8
    # planner: messages -> JSON text. None = pass-through plan (the raw question).
    plan_fn: Callable[[list[dict]], Awaitable[str]] | None = None
    # reranker: (query, texts) -> indices, best first. None = keep RRF order.
    rerank_fn: Callable[[str, list[str]], Awaitable[list[int]]] | None = None
    today: Callable[[], dt.date] = field(default=dt.date.today)
    # Searches are synchronous calls, run in threads. A dedicated pool is the hard
    # bound on how many run at once across every Turn (TurnDeps is shared), and a
    # search still queued when its Turn is cancelled never starts.
    search_executor: ThreadPoolExecutor = field(
        default_factory=lambda: ThreadPoolExecutor(max_workers=search_concurrency(), thread_name_prefix="search")
    )
    search_timeout_s: float = field(default_factory=search_timeout_s)


NO_SEARCH_NOTE = (
    "(No document search was needed for this message; answer from the conversation so far. "
    "There are no excerpts this time, so do not include [n] citations.)"
)


def build_messages(request: ChatRequest, chunks: list[dict] | None) -> list[dict]:
    """Chat Context order: instructions → history → retrieved chunks + question.
    Chunks go last so the stable prefix hits OpenAI's prompt cache. `None` chunks
    means the plan skipped search (zero Sub-queries)."""
    history = [{"role": m.role, "content": m.content} for m in request.history]
    if chunks is None:
        return [
            {"role": "system", "content": NO_SEARCH_PROMPTS[request.answer_mode]},
            *history,
            {"role": "user", "content": f"{NO_SEARCH_NOTE}\n\nQuestion: {request.question}"},
        ]
    excerpts = "\n\n".join(
        f"[{i}] {c['metadata'].get('breadcrumb', '')}\n{c['content']}"
        for i, c in enumerate(chunks, start=1)
    ) or "(no matching excerpts)"
    return [
        {"role": "system", "content": SYSTEM_PROMPTS[request.answer_mode]},
        *history,
        {"role": "user", "content": f"Excerpts:\n{excerpts}\n\nQuestion: {request.question}"},
    ]


def display_section(breadcrumb: str, doc_id: str) -> str:
    """The chunker's breadcrumb carries the docId and a token count for embedding
    context; neither means anything to a reader, so the Source drops them."""
    parts = [p.strip() for p in breadcrumb.split(">")]
    return " > ".join(p for p in parts if p and p != doc_id and not p.startswith("tokens:"))


def to_sources(request: ChatRequest, chunks: list[dict]) -> list[dict]:
    """Numbered the same way as build_messages, so [n] in the answer is sources[n-1]."""
    return [
        {
            "n": i,
            "doc_id": c["metadata"].get("docId", ""),
            "file_name": request.file_name(c["metadata"].get("docId", "")),
            "section": display_section(c["metadata"].get("breadcrumb", ""), c["metadata"].get("docId", "")),
            "text": c["content"],
        }
        for i, c in enumerate(chunks, start=1)
    ]


async def make_plan(request: ChatRequest, deps: TurnDeps) -> Plan:
    """Planner failure or bad JSON falls back to pass-through, marked degraded."""
    if deps.plan_fn is None:
        return pass_through(request.question)
    titles = [d.file_name for d in request.documents or []]
    try:
        raw = await deps.plan_fn(planner_messages(request.question, request.history, titles, deps.today()))
        return parse_plan(raw)
    except Exception as exc:  # noqa: BLE001 — any planner failure degrades, never fails the Turn
        return pass_through(request.question, degraded=True, note=f"planner failed: {type(exc).__name__}: {exc}"[:200])


async def search(request: ChatRequest, deps: TurnDeps, plan: Plan) -> list[dict]:
    """Hybrid search per Sub-query (in parallel), rerank each against its own
    Sub-query, then merge round-robin. Search failure raises; rerank failure
    keeps RRF order and marks the plan degraded."""
    depth = max(deps.top_k * 2, 10)
    loop = asyncio.get_running_loop()

    def run_search(sq: str):
        return loop.run_in_executor(
            deps.search_executor,
            functools.partial(
                query_user_chunks, deps.qdrant, deps.embed_fn, deps.sparse_embed_fn,
                request.uid, sq, n_results=depth, doc_ids=request.scope_ids(),
            ),
        )

    try:
        # wait_for cancels the gather on timeout, which cancels searches still queued;
        # one already running in its thread can't be stopped, only abandoned (the
        # clients' own timeouts bound how long it lingers).
        candidates = await asyncio.wait_for(
            asyncio.gather(*(run_search(sq) for sq in plan.sub_queries)), timeout=deps.search_timeout_s
        )
    except TimeoutError:
        log.error("search timed out after %.1fs for uid=%s (%d sub-queries)", deps.search_timeout_s, request.uid, len(plan.sub_queries))
        raise
    async def rank(sq: str, chunks: list[dict]) -> list[dict]:
        if deps.rerank_fn is None or len(chunks) < 2:
            return chunks
        try:
            order = await asyncio.wait_for(
                deps.rerank_fn(sq, [c["content"] for c in chunks]), timeout=deps.search_timeout_s
            )
            return [chunks[i] for i in order if 0 <= i < len(chunks)]
        except Exception as exc:  # noqa: BLE001
            plan.degraded = True
            plan.notes.append(f"rerank failed: {type(exc).__name__}: {exc}"[:200])
            return chunks

    # Each Sub-query is reranked against itself (ADR-0007), in parallel: measured
    # ~190ms vs ~360ms sequential for 3. A failure only degrades that Sub-query.
    ranked = list(await asyncio.gather(*(rank(sq, c) for sq, c in zip(plan.sub_queries, candidates))))
    return merge_round_robin(ranked, deps.top_k)


async def run_turn(request: ChatRequest, deps: TurnDeps) -> AsyncIterator[dict]:
    plan = await make_plan(request, deps)

    chunks: list[dict] | None = None
    if plan.sub_queries:
        try:
            chunks = await search(request, deps, plan)
        except Exception:
            log.exception("retrieval failed for uid=%s", request.uid)
            yield plan.event()
            yield {"type": "error", "message": "Couldn't search your documents."}
            return

    log.info(
        "plan for uid=%s: mode=%s, %d sub-queries, %s chunks, degraded=%s%s",
        request.uid, request.answer_mode, len(plan.sub_queries), "no search" if chunks is None else len(chunks),
        plan.degraded, f" ({'; '.join(plan.notes)})" if plan.notes else "",
    )
    yield plan.event()
    # Phase 1 has no router: every Turn is a retrieve Turn.
    yield {"type": "meta", "route": "retrieve", "answerMode": request.answer_mode}

    if chunks:
        yield {"type": "sources", "sources": to_sources(request, chunks)}

    try:
        async for text in deps.generate_fn(build_messages(request, chunks)):
            yield {"type": "token", "text": text}
    except Exception:
        log.exception("generation failed for uid=%s", request.uid)
        yield {"type": "error", "message": "Answer failed."}
        return
    yield {"type": "done"}
