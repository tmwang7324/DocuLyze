import asyncio
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from functools import cache

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from retrieval.embedding import create_embedder, create_sparse_embedder
from retrieval.vector_store import qdrant_client

from config import retrieval_top_k, search_concurrency, upstream_timeout_s
from generate import generate_fn, plan_fn
from rerank import create_reranker
from turn import ChatRequest, TurnDeps, run_turn

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI()
logger = logging.getLogger(__name__)

@cache
def turn_deps() -> TurnDeps:
    # One pool for searches AND reranks: the hard cap on synchronous upstream calls
    # in flight across every Turn.
    pool = ThreadPoolExecutor(max_workers=search_concurrency(), thread_name_prefix="search")
    return TurnDeps(
        qdrant=qdrant_client(),
        embed_fn=create_embedder(timeout=upstream_timeout_s()),
        sparse_embed_fn=create_sparse_embedder(),
        generate_fn=generate_fn,
        top_k=retrieval_top_k(),
        plan_fn=plan_fn,
        rerank_fn=create_reranker(executor=pool),
        search_executor=pool,
    )


async def chat_controller(body: ChatRequest) -> StreamingResponse:
    """Stream one retrieval-grounded Turn as SSE."""
    logger.info("Chat stream started")
    async def frames():
        try:
            deps = await asyncio.to_thread(turn_deps)
            async for event in run_turn(body, deps):
                if event.get("type") == "error":
                    logger.error("Chat turn failed: %s", event.get("message", "unknown error"))
                elif event.get("type") == "done":
                    logger.info("Chat stream completed")
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.CancelledError:
            logger.info("Chat stream stopped")
            raise
        except Exception:
            logger.exception("Chat stream failed")
            yield f'data: {json.dumps({"type": "error", "message": "Chat service failed to start the answer."})}\n\n'

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/")
async def main():
    return {"message": "Hello from awesome-chat-service!"}


@app.post("/awesome-chat")
async def awesome_chat(body: ChatRequest) -> StreamingResponse:
    return await chat_controller(body)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
