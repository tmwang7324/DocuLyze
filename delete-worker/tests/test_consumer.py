import json

from delete_worker import consumer


class FakeChannel:
    def __init__(self):
        self.exchange_declarations = []
        self.queue_declarations = []
        self.bindings = []
        self.acks = []
        self.nacks = []

    def exchange_declare(self, **kwargs):
        self.exchange_declarations.append(kwargs)

    def queue_declare(self, **kwargs):
        self.queue_declarations.append(kwargs)

    def queue_bind(self, **kwargs):
        self.bindings.append(kwargs)

    def basic_ack(self, **kwargs):
        self.acks.append(kwargs)

    def basic_nack(self, **kwargs):
        self.nacks.append(kwargs)


class Method:
    delivery_tag = "tag-1"


def test_topology_matches_node_producer():
    channel = FakeChannel()

    consumer.declare_topology(channel, "doc.delete")

    assert channel.exchange_declarations == [
        {"exchange": "doc.delete.dlx", "exchange_type": "direct", "durable": True}
    ]
    assert {"queue": "doc.delete.dead", "durable": True} in channel.queue_declarations
    assert {
        "queue": "doc.delete",
        "durable": True,
        "arguments": {"x-dead-letter-exchange": "doc.delete.dlx"},
    } in channel.queue_declarations
    assert channel.bindings == [
        {
            "queue": "doc.delete.dead",
            "exchange": "doc.delete.dlx",
            "routing_key": "doc.delete",
        }
    ]


def test_terminal_outcomes_are_acked(monkeypatch):
    for outcome in ("finished", "skipped"):
        channel = FakeChannel()
        monkeypatch.setattr(consumer, "run_delete_job", lambda envelope, result=outcome: result)

        consumer.on_message(
            channel,
            Method(),
            None,
            json.dumps({"uid": "user-a", "docId": "doc-a"}).encode(),
        )

        assert channel.acks == [{"delivery_tag": "tag-1"}]
        assert channel.nacks == []


def test_failure_is_dead_lettered(monkeypatch):
    channel = FakeChannel()
    monkeypatch.setattr(
        consumer,
        "run_delete_job",
        lambda envelope: (_ for _ in ()).throw(RuntimeError("qdrant down")),
    )

    consumer.on_message(
        channel,
        Method(),
        None,
        json.dumps({"uid": "user-a", "docId": "doc-a"}).encode(),
    )

    assert channel.acks == []
    assert channel.nacks == [{"delivery_tag": "tag-1", "requeue": False}]
