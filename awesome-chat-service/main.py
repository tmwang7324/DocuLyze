import json
import logging
import os
from functools import cache

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from retrieval.embedding import create_embedder, create_sparse_embedder
from retrieval.vector_store import qdrant_client

from config import retrieval_top_k
from generate import generate_fn
from turn import ChatRequest, TurnDeps, run_turn

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI()


@cache
def turn_deps() -> TurnDeps:
    """Built on the first request, not at import, so a missing key fails a Turn
    rather than the process."""
    return TurnDeps(
        qdrant=qdrant_client(),
        embed_fn=create_embedder(),
        sparse_embed_fn=create_sparse_embedder(),
        generate_fn=generate_fn,
        top_k=retrieval_top_k(),
    )


async def chat_controller(body: ChatRequest) -> StreamingResponse:
    """Relay run_turn's events as SSE frames. Internal-only: the caller is Next's
    route handler, which already checked the session and supplies the uid."""
    deps = turn_deps()

    async def frames():
        async for event in run_turn(body, deps):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform"},
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
