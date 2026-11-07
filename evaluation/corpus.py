"""Build the isolated Google evaluation collection from the saved chunks."""

import hashlib
import json
import logging
import uuid
from pathlib import Path

from qdrant_client.models import Distance, PayloadSchemaType, PointStruct, VectorParams

COLLECTION = "google_eval_chunks"
UID = "google-eval"
CHUNKER_VERSION = "legacy-google-saved-chunks-v1"
LOG = logging.getLogger(__name__)


def corpus_version(chunks):
    data = json.dumps(chunks, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(data.encode("utf-8")).hexdigest()


def load_google_chunks(source, chunk_root):
    documents = source["metadata"]["cross_document_sources"]["documents"]
    chunks = []
    for document, info in sorted(documents.items()):
        folder = Path(chunk_root) / Path(info["chunk_dir"]).name
        for index in range(info["total_chunks"]):
            text = (folder / f"chunk_{index:03}.md").read_text(encoding="utf-8")
            chunks.append({"document": document, "chunk_index": index, "content": text})
    return chunks


def propose_legacy_labels(source, chunks):
    lookup = {(chunk["document"], chunk["chunk_index"]): chunk["content"] for chunk in chunks}
    labels = {"corpus_version": corpus_version(chunks), "chunker_version": CHUNKER_VERSION, "cases": {}}
    for question in source["questions"]:
        passages, mappings = [], []
        for index, ref in enumerate(question["relevant_chunks"]):
            if isinstance(ref, int):
                key = (source["metadata"]["source_document"], ref)
            else:
                key = (ref["document"], ref["chunk_index"])
            if key not in lookup:
                raise ValueError(f"Missing legacy source chunk for {question['id']}: {key}")
            passage_id = f"legacy-{index + 1}"
            passages.append({"id": passage_id, "text": lookup[key], "source_document": key[0],
                             "provenance": "Unreviewed legacy chunk label; extract and review evidence"})
            mappings.append({"document": key[0], "chunk_index": key[1], "passage_ids": [passage_id]})
        labels["cases"][question["id"]] = {"reviewed_by": "", "reference_passages": passages, "chunks": mappings}
    return labels


def index_corpus(client, chunks, embed, model, dimension):
    if not chunks or len({(c["document"], c["chunk_index"]) for c in chunks}) != len(chunks):
        raise ValueError("Corpus must contain uniquely identified chunks")
    metadata = {"purpose": "doculyze-evaluation", "corpus_version": corpus_version(chunks),
                "chunker_version": CHUNKER_VERSION, "embedding_model": model}
    if client.collection_exists(COLLECTION):
        actual = client.get_collection(COLLECTION).config.metadata or {}
        if any(actual.get(key) != value for key, value in metadata.items()):
            raise ValueError("Existing evaluation collection metadata does not match corpus")
    else:
        client.create_collection(COLLECTION, vectors_config={"dense": VectorParams(size=dimension, distance=Distance.COSINE)},
                                 metadata=metadata)
    client.create_payload_index(COLLECTION, "userId", PayloadSchemaType.KEYWORD, wait=True)
    for start in range(0, len(chunks), 32):
        batch = chunks[start:start + 32]
        vectors = embed([chunk["content"] for chunk in batch], input_type="document")
        if len(vectors) != len(batch) or any(len(vector) != dimension for vector in vectors):
            raise ValueError("Embedding count or dimension does not match corpus batch")
        points = []
        for chunk, vector in zip(batch, vectors, strict=True):
            key = f"{COLLECTION}/{UID}/{chunk['document']}/{chunk['chunk_index']}"
            points.append(PointStruct(id=str(uuid.uuid5(uuid.NAMESPACE_URL, key)), vector={"dense": vector},
                                      payload={"userId": UID, "docId": chunk["document"],
                                               "chunk_index": chunk["chunk_index"], "content": chunk["content"]}))
        client.upsert(COLLECTION, points, wait=True)
        LOG.info("Indexed %d/%d chunks", min(start + len(batch), len(chunks)), len(chunks))
    return metadata


def main():
    import argparse
    import sys

    from evaluation.google import QUESTIONS, ROOT

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Allow Qdrant and embedding-provider calls")
    parser.add_argument("--propose", type=Path, help="Save unreviewed legacy label proposals without network calls")
    args = parser.parse_args()
    if not args.live and not args.propose:
        parser.error("--live is required for network evaluation")
    source = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    chunks = load_google_chunks(source, ROOT / "ingest-worker" / "experimental_results" / "chunks")
    if args.propose:
        args.propose.parent.mkdir(parents=True, exist_ok=True)
        with args.propose.open("x", encoding="utf-8") as output:
            json.dump(propose_legacy_labels(source, chunks), output, ensure_ascii=False, indent=2)
        LOG.info("Wrote unreviewed proposals for %d cases", len(source["questions"]))
        if not args.live:
            return
    sys.path.insert(0, str(ROOT / "ingest-worker" / "src"))
    from ingest.mytests.eval_support import connect, create_dense_embedder
    from retrieval.config import embedding_dim, embedding_model

    metadata = index_corpus(connect(), chunks, create_dense_embedder(), embedding_model(), embedding_dim())
    LOG.info("Ready: %d chunks across %d documents, corpus %s", len(chunks),
             len({chunk["document"] for chunk in chunks}), metadata["corpus_version"])


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    main()
