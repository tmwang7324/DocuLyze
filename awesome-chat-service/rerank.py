"""The rerank boundary (ADR-0007) — the only place the Voyage reranker is called.

`rerank_fn(query, texts) -> indices, best first`. run_turn reranks each
Sub-query's candidates against that Sub-query; tests inject a deterministic fake.
"""

import asyncio
import functools
import logging
from concurrent.futures import Executor

from retrieval.config import voyage_api_key

from config import rerank_model, upstream_timeout_s

log = logging.getLogger("chat")


def create_reranker(executor: Executor | None = None):
    """`executor` bounds how many rerank calls run at once: the chat service passes
    the same pool its searches use, so parallel reranks can't exceed the cap."""
    import voyageai

    client = voyageai.Client(api_key=voyage_api_key(), timeout=upstream_timeout_s(), max_retries=1)
    model = rerank_model()
    log.info("reranker created: model=%s", model)

    async def rerank(query: str, texts: list[str]) -> list[int]:
        call = functools.partial(client.rerank, query, texts, model=model)
        result = await asyncio.get_running_loop().run_in_executor(executor, call)
        return [r.index for r in result.results]

    return rerank
