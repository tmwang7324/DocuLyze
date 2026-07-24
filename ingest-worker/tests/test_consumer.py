import json

from ingest import consumer


class FakeChannel:
    def __init__(self):
        self.exchange_declarations = []
        self.queue_declarations = []
        self.bindings = []
        self.publishes = []
        self.acks = []
        self.nacks = []

    def exchange_declare(self, **kwargs):
        self.exchange_declarations.append(kwargs)

    def queue_declare(self, **kwargs):
        self.queue_declarations.append(kwargs)

    def queue_bind(self, **kwargs):
        self.bindings.append(kwargs)

    def basic_publish(self, **kwargs):
        self.publishes.append(kwargs)

    def basic_ack(self, **kwargs):
        self.acks.append(kwargs)

    def basic_nack(self, **kwargs):
        self.nacks.append(kwargs)


class Method:
    delivery_tag = "tag-1"


def test_declare_topology_adds_ttl_retry_queue(monkeypatch):
    channel = FakeChannel()
    monkeypatch.setattr(consumer, "retry_delay_ms", lambda: 300000)

    consumer.declare_topology(channel, "doc.ingest", "doc.ingest.retry")

    assert {
        "queue": "doc.ingest.retry",
        "durable": True,
        "arguments": {
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": "doc.ingest",
            "x-message-ttl": 300000,
        },
    } in channel.queue_declarations
    assert {
        "queue": "doc.ingest.retry",
        "exchange": consumer.RETRY_EXCHANGE,
        "routing_key": "doc.ingest.retry",
    } in channel.bindings


def test_retry_publish_routing_key_matches_binding(monkeypatch):
    channel = FakeChannel()
    monkeypatch.setattr(consumer, "retry_delay_ms", lambda: 300000)
    consumer.declare_topology(channel, "doc.ingest", "doc.ingest.retry")

    consumer.publish_retry(channel, b"{}", "doc.ingest.retry")

    binding = next(b for b in channel.bindings if b["exchange"] == consumer.RETRY_EXCHANGE)
    publish = channel.publishes[0]
    assert publish["routing_key"] == binding["routing_key"]


def test_terminal_job_outcomes_are_acked(monkeypatch):
    for outcome in ("skipped", "finished"):
        channel = FakeChannel()
        body = json.dumps({"uid": "u1", "docId": "d1"}).encode()
        monkeypatch.setattr(consumer, "run_ingest_job", lambda envelope, _o=outcome: _o)

        consumer.on_message(channel, Method(), None, body, "doc.ingest.retry")

        assert channel.acks == [{"delivery_tag": "tag-1"}], outcome
        assert channel.nacks == []
        assert channel.publishes == []


def test_busy_job_is_published_to_retry_and_acked(monkeypatch):
    channel = FakeChannel()
    body = json.dumps({"uid": "u1", "docId": "d1"}).encode()
    monkeypatch.setattr(consumer, "run_ingest_job", lambda envelope: "busy")

    consumer.on_message(channel, Method(), None, body, "doc.ingest.retry")

    assert len(channel.publishes) == 1
    publish = channel.publishes[0]
    assert publish["exchange"] == consumer.RETRY_EXCHANGE
    assert publish["routing_key"] == "doc.ingest.retry"
    assert publish["body"] == body
    assert channel.acks == [{"delivery_tag": "tag-1"}]
    assert channel.nacks == []