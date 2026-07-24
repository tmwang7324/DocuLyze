import "server-only";
import amqp from "amqplib";

// Topology — MUST match ingest-worker/src/ingest/consumer.py exactly. assertQueue
// hard-fails on an argument mismatch, which is the drift alarm we want.
const QUEUE = process.env.INGEST_QUEUE ?? "doc.ingest";
const DLX = "doc.ingest.dlx";
const DEAD_QUEUE = "doc.ingest.dead";

let warnedDisabled = false;

// Lazy + self-healing (grill 2026-07-19). We cache the in-flight PROMISE — not the
// resolved channel — so N concurrent first-publishes share ONE connect (the second
// caller awaits the same pending promise). On any 'error'/'close' we null the cache
// so the NEXT publish reconnects (passive). The error handlers are mandatory, not
// cosmetic — an unhandled 'error' event on an amqplib connection is re-thrown by
// Node and crashes the process.
let channelPromise: Promise<amqp.ConfirmChannel> | null = null;

async function connect(url: string): Promise<amqp.ConfirmChannel> {
  const invalidate = () => {
    channelPromise = null;
  };
  const conn = await amqp.connect(url);
  // Attach BEFORE createConfirmChannel + the asserts: if the connection drops with
  // no listener attached, Node re-throws the 'error' event and crashes the process.
  conn.on("error", invalidate);
  conn.on("close", invalidate);
  // Confirm channel (grill Q3/Q4): the broker acks a publish only after a persistent
  // message is fsync'd onto the durable queue, so the producer->broker hop stops
  // being fire-and-forget. publishIngestJob awaits that ack.
  const ch = await conn.createConfirmChannel();
  ch.on("error", invalidate);
  ch.on("close", invalidate);

  await ch.assertExchange(DLX, "direct", { durable: true });
  await ch.assertQueue(DEAD_QUEUE, { durable: true });
  await ch.bindQueue(DEAD_QUEUE, DLX, QUEUE);
  await ch.assertQueue(QUEUE, {
    durable: true,
    arguments: { "x-dead-letter-exchange": DLX },
  });
  
  console.log("RabbitMQ producer confirm channel ready");
  return ch;
}

// Returns a ready confirm channel, or null when ingest is disabled (RABBITMQ_URL
// unset — plain `npm run dev` without docker must not error-storm). Reuses the
// cached connection and reconnects transparently after a drop.
//
// Non-async on purpose: assigning `channelPromise = connect(url)` synchronously,
// before any await, is what makes concurrent callers share ONE connect (grill Q2).
export function createChannel(): Promise<amqp.ConfirmChannel | null> {
  const url = process.env.RABBITMQ_URL;
  if (!url) {
    if (!warnedDisabled) {
      console.info("RABBITMQ_URL unset — ingest disabled; uploads rest at 'uploaded'.");
      warnedDisabled = true;
    }
    return Promise.resolve(null);
  }
  if (!channelPromise) {
    channelPromise = connect(url).catch((err) => {
      channelPromise = null; // don't cache a rejected promise; next call retries
      throw err; // propagates to finalizeUpload's swallow-and-log
    });
  }
  return channelPromise;
}
