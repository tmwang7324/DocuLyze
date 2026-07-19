FROM python:3.12-slim

# Non-root user + antiword (.doc parser — grill 2026-07-18: kept).
RUN adduser --disabled-password --gecos "" worker \
    && apt-get update \
    && apt-get install -y --no-install-recommends antiword \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
ENV PYTHONPATH=/app/src

# Credentials and emulator hosts arrive via compose env/mounts — never baked here.
USER worker
CMD ["python", "-m", "ingest.consumer"]
