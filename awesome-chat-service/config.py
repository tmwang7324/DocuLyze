"""Env-driven configuration for the chat service. Vector-store and embedding
settings come from the shared retrieval package (retrieval.config)."""

import os


def chat_model() -> str:
    return os.environ.get("CHAT_MODEL", "gpt-5-mini")


def chat_reasoning_effort() -> str:
    # gpt-5-mini reasons before its first token; "low" keeps time-to-first-token short.
    return os.environ.get("CHAT_REASONING_EFFORT", "low")


def openai_api_key() -> str:
    return os.environ["OPENAI_API_KEY"]  # required, fail loudly


def retrieval_top_k() -> int:
    return int(os.environ.get("CHAT_TOP_K", "8"))


def planner_model() -> str:
    # ADR-0007: one fused rewrite-and-split call to a small, fast model.
    return os.environ.get("PLANNER_MODEL", "gpt-4.1-mini")


def rerank_model() -> str:
    # ADR-0007 evidence (test_decompose.py) was measured with this model.
    return os.environ.get("RERANK_MODEL", "rerank-3-lite")


def search_concurrency() -> int:
    # Hard cap on searches running at once across ALL Turns (each is a synchronous
    # Voyage + Qdrant call in a thread). Excess searches queue.
    return int(os.environ.get("CHAT_SEARCH_CONCURRENCY", "8"))


def search_timeout_s() -> float:
    # Per Turn: how long the search stage (and, separately, each rerank) may take
    # before the Turn fails (search) or degrades (rerank) instead of hanging.
    return float(os.environ.get("CHAT_SEARCH_TIMEOUT_S", "20"))


def upstream_timeout_s() -> float:
    # Request timeout for the short upstream calls: query embedding, rerank, planner.
    return float(os.environ.get("CHAT_UPSTREAM_TIMEOUT_S", "15"))


def generation_timeout_s() -> float:
    # Read timeout for the streamed answer: the longest silence between chunks
    # (gpt-5-mini can think before its first token), not the whole answer's length.
    return float(os.environ.get("CHAT_GENERATION_TIMEOUT_S", "60"))
