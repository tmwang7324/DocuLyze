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

from plan import gate_messages, parse_gate, parse_plan, planner_messages  # noqa: E402
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


async def gate(question, history=()) -> bool:
    """The real needs-search agent (gpt-5.4-mini): True = needs a search."""
    from generate import needs_search_fn

    return parse_gate(await needs_search_fn(gate_messages(question, list(history))))


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


HEAP_CHAT = [
    Message(role="user", content="What is a heap?"),
    Message(role="assistant", content="A heap is a complete binary tree stored in an array; the minimum sits at the root [1]."),
]

# Labelled set for the gate. The dangerous error is skipping a search that was
# needed (a wrong answer with no sources), so SEARCH cases must be 100%.
GATE_SKIP = ["Thanks!", "thank you so much", "hi there", "ok got it", "put that in a table", "make it shorter",
             "translate that to Spanish", "turn that into bullet points", "what did you just say?"]
GATE_SEARCH = ["explain that more simply", "give me an example", "what about heap deletion?", "can you elaborate on the first point?",
               "What is an error budget?", "Compare error budgets with heap insertion", "what changed in the handbook this year?",
               "what is a B-tree?", "summarize the document", "how long does extract-min take?"]


def test_gate_labelled_set_never_skips_a_needed_search():
    results = {q: run(gate(q, HEAP_CHAT)) for q in GATE_SKIP + GATE_SEARCH}
    wrong_skip = [q for q in GATE_SEARCH if not results[q]]  # needed a search, gate said no
    wrong_search = [q for q in GATE_SKIP if results[q]]  # cheap miss: an unneeded search
    print(f"\ngate: {len(GATE_SEARCH) - len(wrong_skip)}/{len(GATE_SEARCH)} search cases right, "
          f"{len(GATE_SKIP) - len(wrong_search)}/{len(GATE_SKIP)} skip cases right")
    print("  wrongly skipped (dangerous):", wrong_skip)
    print("  wrongly searched (cheap):", wrong_search)
    assert not wrong_skip, f"gate skipped searches that were needed: {wrong_skip}"
    assert len(wrong_search) <= 1, f"gate searched too eagerly: {wrong_search}"


def test_gate_with_no_history_still_searches_a_real_question():
    assert run(gate("What is an error budget?")) is True
    assert run(gate("Thanks!")) is False


def test_planner_always_returns_a_sub_query_for_a_message_the_gate_passed():
    for q in ("explain that more simply", "what about the second one?"):
        p = run(plan(q, HEAP_CHAT))
        print(f"\n{q!r} -> {p}")
        assert p.sub_queries, f"planner returned no sub-queries for {q!r}"


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
