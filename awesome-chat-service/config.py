"""Env-driven configuration for the chat service. Vector-store and embedding
settings come from the shared retrieval package (retrieval.config)."""

import os


def chat_model() -> str:
    return os.environ.get("CHAT_MODEL", "gpt-5")


def chat_reasoning_effort() -> str:
    # gpt-5 reasons before its first token; "low" keeps time-to-first-token short.
    return os.environ.get("CHAT_REASONING_EFFORT", "low")


def openai_api_key() -> str:
    return os.environ["OPENAI_API_KEY"]  # required, fail loudly


def retrieval_top_k() -> int:
    return int(os.environ.get("CHAT_TOP_K", "8"))
