# Build with the repository root as context:
#   docker build -f delete-worker/Dockerfile .
FROM python:3.12-slim

RUN adduser --disabled-password --gecos "" worker
WORKDIR /app

COPY delete-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY packages/retrieval /tmp/retrieval
RUN pip install --no-cache-dir /tmp/retrieval && rm -rf /tmp/retrieval

COPY delete-worker/src ./src
ENV PYTHONPATH=/app/src

USER worker
CMD ["python", "-m", "delete_worker.consumer"]
