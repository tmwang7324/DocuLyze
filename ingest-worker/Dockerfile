FROM python:3.12-slim

# Non-root user.
RUN adduser --disabled-password --gecos "" worker

WORKDIR /app

# Native libs for OpenCV (pulled in by rapidocr-onnxruntime) — the slim base has
# neither. Kept to the two OpenCV needs; models are ONNX/CPU, no CUDA layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake Docling's models into the image so conversions run fully offline (no
# network at ingest time). DOCLING_ARTIFACTS_PATH points every converter built
# by docling_convert.py at this baked dir.
RUN docling-tools models download layout tableformer rapidocr -o /opt/docling-models --quiet
ENV DOCLING_ARTIFACTS_PATH=/opt/docling-models

COPY src ./src
ENV PYTHONPATH=/app/src

# Credentials and emulator hosts arrive via compose env/mounts — never baked here.
USER worker
CMD ["python", "-m", "ingest.consumer"]
