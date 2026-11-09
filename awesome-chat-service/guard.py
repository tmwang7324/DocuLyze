"""Heuristic prompt-injection signals in text that came from an uploaded document.

Detection only: a hit is logged, never used to drop an excerpt. Regexes miss paraphrases
and German-language attacks alike, and a security textbook legitimately quotes "ignore all
previous instructions", so blocking on this would be both porous and wrong. The real
defence is structural (the fence in turn.build_messages and the system prompts); this makes
attempts visible in the log so they can be reviewed.
"""

import re

_SIGNALS = {
    "override-instructions": re.compile(
        r"\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+|your\s+)?"
        r"(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|rules|prompts?|directions?)",
        re.IGNORECASE,
    ),
    "reveal-prompt": re.compile(
        r"\b(?:reveal|show|print|repeat|output|leak)\s+(?:me\s+)?(?:your|the)\s+"
        r"(?:system\s+|hidden\s+|initial\s+)?(?:prompt|instructions)",
        re.IGNORECASE,
    ),
    "role-reassignment": re.compile(r"\byou\s+are\s+now\s+(?:a|an|the|in)\b", re.IGNORECASE),
    # A line that starts like a chat role turn: "SYSTEM: ..." (mid-sentence "operating system:" is fine).
    "role-forgery": re.compile(r"^\s*(?:system|assistant|developer)\s*:", re.IGNORECASE | re.MULTILINE),
    "fence-forgery": re.compile(r"</?\s*(?:excerpts?|system|instructions?)\s*>", re.IGNORECASE),
}


def injection_signals(text: str) -> list[str]:
    """Names of the injection patterns found in `text` (empty when it looks ordinary)."""
    return [name for name, pattern in _SIGNALS.items() if pattern.search(text)]
