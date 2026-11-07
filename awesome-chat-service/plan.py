"""Retrieval Plan v1 (chat ticket 03, ADR-0007): the pure parts.

One planner call sees the recent Messages, today's date and a titles-only
Manifest, and returns a standalone rewrite plus 0–3 Sub-queries. Each
Sub-query's candidates are reranked against that Sub-query, then the final
top-k is merged round-robin so no Sub-query can take every slot.
"""

import datetime as dt
import json
from dataclasses import dataclass, field

MAX_SUB_QUERIES = 3
RECENT_MESSAGES = 6
MESSAGE_CHARS = 1500

PLANNER_PROMPT = """You plan document searches for a study assistant.
Given the conversation so far and the user's new message, return JSON:
{"standalone": "<the new message rewritten to stand alone, with every reference resolved>",
 "sub_queries": ["<search query>", ...]}

Rules:
- Resolve follow-ups ("that", "explain it more simply") into the actual topic from the conversation.
- Relative dates ("this year", "last month") are relative to today's date given below.
- Return 0 sub_queries ("sub_queries": []) only for thanks, greetings, acknowledgements, or a pure
  layout change of the previous answer: "put that in a table/list/bullets", "make it shorter", "translate it".
  Example: after an answer about heaps, "put that in a table" -> {"standalone": "Put the previous answer about heaps in a table.", "sub_queries": []}.
- Requests to explain, simplify, elaborate on, or give examples of an earlier topic DO search: the
  sub-queries target that resolved topic.
  Example: after an answer about error budgets, "explain that more simply" -> {"standalone": "Explain error budgets more simply.", "sub_queries": ["error budget definition"]}.
- Split a question with independent parts (e.g. about two different documents) into one sub-query per part.
- Never return near-duplicate sub-queries; at most 3.
- Sub-queries are short keyword-rich search phrases, not full sentences."""


@dataclass
class Plan:
    standalone: str
    sub_queries: list[str]
    degraded: bool = False
    notes: list[str] = field(default_factory=list)  # why it degraded, for the log

    def event(self) -> dict:
        return {"type": "plan", "standalone": self.standalone, "sub_queries": self.sub_queries, "degraded": self.degraded}


def pass_through(question: str, degraded: bool = False, note: str | None = None) -> Plan:
    return Plan(question, [question], degraded, [note] if note else [])


def planner_messages(question: str, history: list, titles: list[str], today: dt.date) -> list[dict]:
    recent = history[-RECENT_MESSAGES:]
    convo = "\n".join(f"{m.role}: {m.content[:MESSAGE_CHARS]}" for m in recent) or "(none)"
    manifest = "\n".join(f"- {t}" for t in titles) or "(no documents)"
    return [
        {"role": "system", "content": PLANNER_PROMPT},
        {
            "role": "user",
            "content": f"Today's date: {today.isoformat()}\n\nDocuments:\n{manifest}\n\n"
            f"Conversation so far:\n{convo}\n\nNew message: {question}",
        },
    ]


def parse_plan(text: str) -> Plan:
    """Raises ValueError on anything that isn't the expected JSON shape."""
    data = json.loads(text)
    standalone = data.get("standalone")
    subs = data.get("sub_queries")
    if not isinstance(standalone, str) or not standalone.strip() or not isinstance(subs, list):
        raise ValueError("planner JSON missing standalone/sub_queries")
    # An invalid entry means the model's output can't be trusted. Silently dropping
    # it could turn [null] into an apparently valid zero-search plan, so the whole
    # plan is rejected and the caller degrades to pass-through. Duplicates are fine.
    cleaned: list[str] = []
    for s in subs:
        if not isinstance(s, str) or not s.strip():
            raise ValueError(f"planner sub_queries entry is not a non-empty string: {type(s).__name__}")
        if s.strip() not in cleaned:
            cleaned.append(s.strip())
    return Plan(standalone.strip(), cleaned[:MAX_SUB_QUERIES])


def chunk_key(chunk: dict) -> tuple:
    m = chunk["metadata"]
    return (m.get("docId"), m.get("chunk_index"), chunk["content"] if m.get("chunk_index") is None else None)


def merge_round_robin(ranked_lists: list[list[dict]], k: int) -> list[dict]:
    """Take each list's next unseen chunk in turn until k are picked: an even
    quota per Sub-query, with leftover slots going to lists that still have chunks."""
    picked: list[dict] = []
    seen: set = set()
    cursors = [0] * len(ranked_lists)
    while len(picked) < k:
        progressed = False
        for i, lst in enumerate(ranked_lists):
            while cursors[i] < len(lst) and chunk_key(lst[cursors[i]]) in seen:
                cursors[i] += 1
            if cursors[i] < len(lst) and len(picked) < k:
                chunk = lst[cursors[i]]
                seen.add(chunk_key(chunk))
                picked.append(chunk)
                cursors[i] += 1
                progressed = True
        if not progressed:
            break
    return picked
