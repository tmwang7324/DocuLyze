# ADR-0001: RabbitMQ as the ingest message broker

**Status:** Accepted (2026-07-18)

## Context

The data-architecture spec (issue #1, 2026-07-16 grill session) established exactly one
asynchronous flow — document ingest — carried by a broker whose job envelope is
`{ uid, docId }` and never bytes. The spec deliberately kept the broker *abstract*:
"RabbitMQ specifically remains cut by name" sat in its Out of Scope list, so that the
role (durable async hand-off, replayable envelopes) was pinned while the product choice
stayed open.

Ticket #4 (pull-based ingest tracer) now needs a concrete broker to build against.
The requirements the role imposes:

- Durable queueing with per-message acknowledgement (a worker crash must not lose an envelope).
- Safe redelivery (replaying an envelope is a supported, idempotent operation downstream).
- A dead-letter path for poison messages.
- Reachable from a Node.js producer (Next.js server action) and a Python consumer.
- Runs as an internal-only service (never internet-facing); local dev via Docker.

## Decision

Use **RabbitMQ** (AMQP 0-9-1) as the ingest broker.

- Producer: the Next.js layer via **amqplib**, publishing persistent JSON envelopes.
- Consumer: the Python ingest worker via **pika**, manual ack, prefetch 1.
- Topology: one durable queue for ingest jobs with a dead-letter exchange/queue for
  envelopes that cannot be processed.
- Local/dev deployment: official `rabbitmq:4-management` Docker image on an internal
  Docker network; the management UI is bound to localhost only.

This supersedes the "RabbitMQ remains cut by name" out-of-scope entry in the spec —
confirmed by the maintainer during triage of #4 on 2026-07-18.

## Consequences

- The broker is a named infrastructure dependency: dev setup gains a Docker Compose
  service, and deploy gains a RabbitMQ instance (or managed equivalent, e.g. CloudAMQP)
  on a private network.
- Trust-by-provenance holds via broker credentials + network placement: only the
  Next.js layer and the worker hold credentials; the AMQP port is never public.
- The envelope contract (`{ uid, docId }`, nothing else) is broker-agnostic, so a
  future broker swap would touch only the thin publish/consume shells, not the
  worker's job logic — the job-entry seam (ticket #4's test seam) is broker-free.
- RAG query stays synchronous per the spec; RabbitMQ carries ingest only.
