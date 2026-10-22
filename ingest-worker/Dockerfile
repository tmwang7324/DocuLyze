# Build context is the REPO ROOT (chat ticket 01), so this image can install the
# shared packages/retrieval; Dockerfile.dockerignore next to this file allowlists
# what the context sends. Build via docker compose, or:
#     docker build -f ingest-worker/Dockerfile .
FROM python:3.12-slim

# Non-root user.
RUN adduser --disabled-password --gecos "" worker

WORKDIR /app

# Native libs for OpenCV (pulled in by rapidocr-onnxruntime) — the slim base has
# neither. Kept to the two OpenCV needs; models are ONNX/CPU, no CUDA layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY ingest-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake Docling's models into the image so conversions run fully offline (no
# network at ingest time). DOCLING_ARTIFACTS_PATH points every converter built
# by docling_convert.py at this baked dir.
RUN docling-tools models download layout tableformer rapidocr -o /opt/docling-models --quiet
ENV DOCLING_ARTIFACTS_PATH=/opt/docling-models

# Shared retrieval package (ADR-0006): installed (not put on PYTHONPATH) so its
# pinned qdrant-client/fastembed/voyageai resolve with it. After the model bake
# so editing the gateway doesn't re-download Docling's models.
COPY packages/retrieval /tmp/retrieval
RUN pip install --no-cache-dir /tmp/retrieval && rm -rf /tmp/retrieval

COPY ingest-worker/src ./src
ENV PYTHONPATH=/app/src

# Credentials and emulator hosts arrive via compose env/mounts — never baked here.
USER worker
CMD ["python", "-m", "ingest.consumer"]
