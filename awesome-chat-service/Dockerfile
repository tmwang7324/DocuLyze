# Build with the repository root as context (it installs packages/retrieval):
#   docker build -f awesome-chat-service/Dockerfile .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.10.4 /uv /bin/uv
RUN adduser --disabled-password --gecos "" chat
WORKDIR /app

# uv.lock records the retrieval package as ../packages/retrieval, so the image
# keeps the repo's layout. --no-editable copies it into the venv.
COPY packages/retrieval ./packages/retrieval
COPY awesome-chat-service/pyproject.toml awesome-chat-service/uv.lock ./awesome-chat-service/
WORKDIR /app/awesome-chat-service
RUN uv sync --frozen --no-dev --no-editable --no-install-project

COPY awesome-chat-service/*.py ./
ENV PATH="/app/awesome-chat-service/.venv/bin:$PATH"

# Credentials arrive via compose env — never baked here.
USER chat
CMD ["python", "main.py"]
