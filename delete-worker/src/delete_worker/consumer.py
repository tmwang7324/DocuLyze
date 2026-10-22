"""RabbitMQ deletion consumer with manual ack and a dead-letter queue."""

import json
import logging
import sys

import pika

from delete_worker.config import delete_queue, firebase_app, rabbitmq_url
from delete_worker.job import run_delete_job

log = logging.getLogger("delete-worker")

DLX = "doc.delete.dlx"
DEAD_QUEUE = "doc.delete.dead"


def declare_topology(channel, queue: str) -> None:
    # Must match doculyze/_lib/rabbitmq.ts exactly.
    channel.exchange_declare(exchange=DLX, exchange_type="direct", durable=True)
    channel.queue_declare(queue=DEAD_QUEUE, durable=True)
    channel.queue_bind(queue=DEAD_QUEUE, exchange=DLX, routing_key=queue)
    channel.queue_declare(
        queue=queue,
        durable=True,
        arguments={"x-dead-letter-exchange": DLX},
    )


def on_message(channel, method, properties, body) -> None:
    try:
        envelope = json.loads(body)
        result = run_delete_job(envelope)
        if result in ("finished", "skipped"):
            channel.basic_ack(delivery_tag=method.delivery_tag)
            return
        log.error("unexpected deletion outcome for %s: %s", envelope, result)
        channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
    except Exception:  # infrastructure failure, bad JSON, or bug
        log.exception("deletion failed; dead-lettering delivery")
        channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    url = rabbitmq_url()
    if not url:
        log.error("RABBITMQ_URL is required for the consumer; refusing to start.")
        return 1
    firebase_app()

    queue = delete_queue()
    connection = pika.BlockingConnection(pika.URLParameters(url))
    channel = connection.channel()
    declare_topology(channel, queue)
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(
        queue=queue,
        on_message_callback=on_message,
        auto_ack=False,
    )
    log.info("consuming %s (prefetch 1, manual ack; DLQ %s)", queue, DEAD_QUEUE)
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        channel.stop_consuming()
        connection.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
