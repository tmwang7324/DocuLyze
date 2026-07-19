"""pika consumer shell + DLQ (guide Phase 8) — the ONLY broker-aware module.

Error policy (grill 2026-07-18, "ack failures, DLQ bugs, one-shot"):
document-level failures are handled inside run_ingest_job (write `failed`,
return) -> ACK. Infrastructure failures / bad JSON / bugs -> NACK requeue=false
-> doc.ingest.dlx -> doc.ingest.dead. Never requeue in-place (poison loop); no
retry topology. A message in the dead queue always means worker/infra
malfunction, never "user uploaded a bad file" — DLQ depth is a pure alarm.

prefetch 1 + manual ack: a crash mid-job leaves the delivery unacked ->
redelivered -> claim sees `processing` -> RERUN (safe).
"""

import json
import logging
import sys

import pika

from ingest.config import firebase_app, ingest_queue, rabbitmq_url
from ingest.job import run_ingest_job

log = logging.getLogger("ingest")

DLX = "doc.ingest.dlx"
DEAD_QUEUE = "doc.ingest.dead"


def declare_topology(channel, queue: str) -> None:
    # Must match doculyze/_lib/ingest_broker.ts exactly — assertQueue hard-fails
    # on a mismatch, which is the drift alarm we want.
    channel.exchange_declare(exchange=DLX, exchange_type="direct", durable=True)
    channel.queue_declare(queue=DEAD_QUEUE, durable=True)
    channel.queue_bind(queue=DEAD_QUEUE, exchange=DLX, routing_key=queue)
    channel.queue_declare(
        queue=queue, durable=True, arguments={"x-dead-letter-exchange": DLX}
    )


def on_message(channel, method, properties, body) -> None:
    try:
        envelope = json.loads(body)
        run_ingest_job(envelope)
        channel.basic_ack(delivery_tag=method.delivery_tag)
    except Exception:  # noqa: BLE001 — infra failure / bad JSON / bug
        log.exception("infra failure; dead-lettering delivery")
        channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    url = rabbitmq_url()
    if not url:
        log.error("RABBITMQ_URL is required for the consumer; refusing to start.")
        return 1
    firebase_app()  # boot log names which Firestore/Storage this worker talks to

    queue = ingest_queue()
    connection = pika.BlockingConnection(pika.URLParameters(url))
    channel = connection.channel()
    declare_topology(channel, queue)
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue=queue, on_message_callback=on_message, auto_ack=False)
    log.info("consuming %s (prefetch 1, manual ack; DLQ %s)", queue, DEAD_QUEUE)
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        channel.stop_consuming()
        connection.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
