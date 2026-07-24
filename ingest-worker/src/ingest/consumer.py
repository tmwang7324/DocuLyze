"""pika consumer shell + DLQ/retry (guide Phase 8) — the ONLY broker-aware module.

Error policy (refined 2026-07-22): document-level failures are handled inside
run_ingest_job (write `failed`, return) -> ACK. A transient `busy` claim is
re-published to a dedicated retry queue, waits five minutes, then dead-letters
back to the main ingest queue. Infrastructure failures / bad JSON / bugs ->
NACK requeue=false -> doc.ingest.dlx -> doc.ingest.dead. Never requeue in-place
(poison loop). A message in the dead queue still means worker/infra malfunction,
never "user uploaded a bad file" — DLQ depth remains a pure alarm.

prefetch 1 + manual ack: a crash mid-job leaves the delivery unacked ->
redelivered -> claim sees `processing` -> RERUN (safe).
"""

import json
import logging
import sys

import pika

from ingest.config import (
    firebase_app,
    ingest_queue,
    rabbitmq_url,
    retry_delay_ms,
    retry_queue,
)
from ingest.job import run_ingest_job

log = logging.getLogger("ingest")

DLX = "doc.ingest.dlx"
DEAD_QUEUE = "doc.ingest.dead"
RETRY_EXCHANGE = "doc.ingest.retry"


def declare_topology(channel, ingest_queue: str, retry_queue: str) -> None:
    # Must match doculyze/_lib/ingest_broker.ts exactly — assertQueue hard-fails
    # on a mismatch, which is the drift alarm we want.

    # doculyze/_lib/ingest_broker
    # await ch.assertExchange(DLX, "direct", { durable: true });
    # await ch.assertQueue(DEAD_QUEUE, { durable: true });
    # await ch.bindQueue(DEAD_QUEUE, DLX, QUEUE);
    # await ch.assertQueue(QUEUE, {
    #     durable: true,
    #     arguments: { "x-dead-letter-exchange": DLX },
    # });
    channel.exchange_declare(exchange=DLX, exchange_type="direct", durable=True)
    channel.queue_declare(queue=DEAD_QUEUE, durable=True)
    channel.queue_bind(queue=DEAD_QUEUE, exchange=DLX, routing_key=ingest_queue)
    channel.queue_declare(
        queue=ingest_queue,
        durable=True,
        arguments={"x-dead-letter-exchange": DLX},
    )

    channel.exchange_declare(exchange=RETRY_EXCHANGE, exchange_type="direct", durable=True)
    channel.queue_declare(
        queue=retry_queue,
        durable=True,
        arguments={
            "x-dead-letter-exchange": "", # "" routes expired retries back to doc.ingest via 
            "x-dead-letter-routing-key": ingest_queue, # the default exchange's implicit queue-name binding 
            "x-message-ttl": retry_delay_ms(),
        },
    )
    channel.queue_bind(
        queue=retry_queue,
        exchange=RETRY_EXCHANGE,
        routing_key=retry_queue,
    )


def publish_retry(channel, body: bytes, queue: str) -> None:
    channel.basic_publish(
        exchange=RETRY_EXCHANGE,
        routing_key=queue,
        body=body,
        properties=pika.BasicProperties(
            delivery_mode=2,
            content_type="application/json",
        ),
    )


def on_message(channel, method, properties, body, retry_queue: str) -> None:
    try:
        envelope = json.loads(body)
        result = run_ingest_job(envelope)
        if result in ("skipped", "finished"):
            channel.basic_ack(delivery_tag=method.delivery_tag)
            return

        if result == "busy":
            publish_retry(channel, body, retry_queue)
            channel.basic_ack(delivery_tag=method.delivery_tag)
            return

        log.error("unexpected job outcome for %s: %s", envelope, result)
        channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

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
    retry = retry_queue()
    connection = pika.BlockingConnection(pika.URLParameters(url))
    channel = connection.channel()
    declare_topology(channel, queue, retry)
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(
        queue=queue,
        on_message_callback=lambda ch, method, properties, body: on_message(
            ch, method, properties, body, retry
        ),
        auto_ack=False,
    )
    log.info(
        "consuming %s (prefetch 1, manual ack; retry %s after %d ms; DLQ %s)",
        queue,
        retry,
        retry_delay_ms(),
        DEAD_QUEUE,
    )
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        channel.stop_consuming()
        connection.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
