"""Live evaluation of Retrieval Plan v1 (chat ticket 03): the real planner and the
real Voyage reranker, judged by gpt-5-mini in conjunction with deterministic scoring.

Opt-in (costs a few cents, needs network):
    RUN_LIVE_EVAL=1 uv run pytest -q tests/test_plan_live_eval.py -s
Keys come from the environment or the repo-root .env (OPENAI_API_KEY, VOYAGE_API_KEY).
"""

import asyncio
import datetime as dt
import os
from pathlib import Path

import pytest


# Keys are loaded from the repo-root .env by conftest.py when RUN_LIVE_EVAL=1.

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE_EVAL") != "1" or not os.environ.get("OPENAI_API_KEY") or not os.environ.get("VOYAGE_API_KEY"),
    reason="live eval: set RUN_LIVE_EVAL=1 with OPENAI_API_KEY and VOYAGE_API_KEY",
)

from plan import parse_plan, planner_messages  # noqa: E402
from turn import Message  # noqa: E402

TODAY = dt.date(2026, 11, 6)
TITLES = ["sre-handbook.pdf", "indigenous-health-study.pdf", "heap-notes.md"]

SRE = [
    "An error budget is 100% minus the SLO; at 99.9% availability that is about 43 minutes a month.",
    "When the error budget is exhausted, feature launches freeze until reliability recovers.",
    "Burn-rate alerts fire when the error budget is consumed faster than the SLO window allows.",
]
HEALTH = [
    "Among Indigenous adults, high cholesterol was associated with smoking, obesity and low income.",
    "The study measured cholesterol in 2,300 participants across four regions.",
]


def run(coro):
    return asyncio.run(coro)


async def plan(question, history=()):
    from generate import plan_fn

    return parse_plan(await plan_fn(planner_messages(question, list(history), TITLES, TODAY)))


async def judge(query: str, passage: str) -> bool:
    """gpt-5-mini as a relevance judge: does the passage help answer the query?"""
    from generate import _openai

    r = await _openai().chat.completions.create(
        model="gpt-5-mini",
        reasoning_effort="low",
        messages=[{
            "role": "user",
            "content": f"Query: {query}\nPassage: {passage}\n\nDoes the passage help answer the query? Reply with only yes or no.",
        }],
    )
    return (r.choices[0].message.content or "").strip().lower().startswith("yes")


def overlap(query: str, text: str) -> int:
    """Deterministic score: shared lowercase words."""
    return len(set(query.lower().split()) & set(text.lower().replace(";", " ").replace(",", " ").split()))


def test_compound_question_splits_and_each_half_reranks_to_its_own_topic():
    p = run(plan("What is an error budget, and which factors were linked to high cholesterol among Indigenous adults?"))
    print("\nplan:", p)
    assert 2 <= len(p.sub_queries) <= 3

    from rerank import create_reranker

    rerank = create_reranker()
    pool = SRE + HEALTH
    tops = {}
    for sq in p.sub_queries:
        order = run(rerank(sq, pool))
        top = pool[order[0]]
        det_best = max(pool, key=lambda t: overlap(sq, t))
        relevant = run(judge(sq, top))
        print(f"  {sq!r}: rerank top={top[:50]!r} | overlap top={det_best[:50]!r} | judge={relevant}")
        assert relevant, f"gpt-5-mini judged the reranked top passage irrelevant for {sq!r}"
        tops[sq] = top
    # Coverage: the halves land on different documents (the ADR-0007 failure mode).
    assert any(t in SRE for t in tops.values()) and any(t in HEALTH for t in tops.values())


def test_follow_up_resolves_to_the_topic_from_history():
    history = [
        Message(role="user", content="What is an error budget?"),
        Message(role="assistant", content="An error budget is 100% minus the SLO [1]."),
    ]
    p = run(plan("explain that more simply", history))
    print("\nplan:", p)
    assert p.sub_queries, "a follow-up about document content should still search"
    assert run(judge(p.sub_queries[0], SRE[0])), "the follow-up sub-query should target error budgets"


def test_thanks_and_reformatting_need_no_search():
    history = [Message(role="user", content="What is a heap?"), Message(role="assistant", content="A tree-shaped priority structure [1].")]
    for msg in ("Thanks!", "put that in a table"):
        p = run(plan(msg, history))
        print(f"\n{msg!r} -> {p}")
        assert p.sub_queries == []


def test_this_year_means_the_current_year():
    p = run(plan("What changed in the SRE handbook this year?"))
    print("\nplan:", p)
    text = p.standalone + " " + " ".join(p.sub_queries)
    assert "2024" not in text and "2025" not in text


# --- Generated behaviour on a no-search Turn (chat ticket 03 review follow-up) ----

HEAP_HISTORY = [
    Message(role="user", content="What is a heap?"),
    Message(
        role="assistant",
        content="A heap is a complete binary tree stored in an array; in a min-heap the minimum sits at the root [1]. "
        "Insert and extract-min are O(log n) [1], and building a heap from an array is O(n) [1].",
    ),
]


async def generate_text(messages: list[dict]) -> str:
    from generate import generate_fn

    return "".join([t async for t in generate_fn(messages)])


async def judge_refusal(reply: str) -> bool:
    """gpt-5-mini: does the reply refuse, or say it lacks documents/excerpts?"""
    from generate import _openai

    r = await _openai().chat.completions.create(
        model="gpt-5-mini",
        reasoning_effort="low",
        messages=[{
            "role": "user",
            "content": f"Reply under review:\n{reply}\n\nDoes this reply refuse the request, or say it cannot answer "
            "because excerpts or documents are missing? Answer only yes or no.",
        }],
    )
    return (r.choices[0].message.content or "").strip().lower().startswith("yes")


def is_markdown_table(text: str) -> bool:
    import re

    # Tabular output in any common style: GitHub-style (with or without outer pipes)
    # or ASCII-art borders (+---+---+). The model varies run to run; what the test
    # needs is "it produced the table", with refusal judged separately.
    lines = text.splitlines()
    rows = [ln for ln in lines if "|" in ln and not re.fullmatch(r"[\s+|:\-]+", ln)]
    separators = [ln for ln in lines if "-" in ln and re.fullmatch(r"[\s+|:\-]+", ln)]
    return len(rows) >= 2 and bool(separators)


def test_put_that_in_a_table_is_answered_not_refused():
    from turn import ChatRequest, build_messages

    request = ChatRequest(uid="u", question="put that in a table", history=HEAP_HISTORY)
    reply = run(generate_text(build_messages(request, None)))
    print("\nno-search reply:\n", reply[:400])

    assert is_markdown_table(reply), "expected a markdown table (deterministic check)"
    assert not run(judge_refusal(reply)), "gpt-5-mini judged the reply a refusal"


def test_control_the_excerpts_only_prompt_would_have_refused():
    """Not an assertion about the product: shows the conflict the review found was real."""
    from turn import GROUNDED_PROMPT, NO_SEARCH_NOTE

    messages = [
        {"role": "system", "content": GROUNDED_PROMPT},
        *({"role": m.role, "content": m.content} for m in HEAP_HISTORY),
        {"role": "user", "content": f"{NO_SEARCH_NOTE}\n\nQuestion: put that in a table"},
    ]
    reply = run(generate_text(messages))
    print("\ncontrol (old prompt) reply:\n", reply[:300])
    print("control is a table:", is_markdown_table(reply), "| judged refusal:", run(judge_refusal(reply)))


def test_thanks_gets_a_short_reply_not_a_refusal():
    from turn import ChatRequest, build_messages

    request = ChatRequest(uid="u", question="Thanks!", history=HEAP_HISTORY)
    reply = run(generate_text(build_messages(request, None)))
    print("\nthanks reply:", reply[:200])

    assert not run(judge_refusal(reply))
