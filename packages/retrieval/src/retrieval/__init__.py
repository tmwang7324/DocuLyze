"""Shared retrieval package (ADR-0006): the Qdrant tenant gateway and the
dense/sparse embedders, installed by both the ingest worker (write side) and
the chat service (query side) so the two can't drift apart."""
