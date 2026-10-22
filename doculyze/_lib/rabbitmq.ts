import "server-only";
import amqp from "amqplib";
import { logOperationalEvent } from "./operational_logger";

// Topology — each queue MUST match its worker consumer exactly. assertQueue
// hard-fails on an argument mismatch, which is the drift alarm we want.
const INGEST_QUEUE = process.env.INGEST_QUEUE ?? "doc.ingest";
const INGEST_DLX = "doc.ingest.dlx";
const INGEST_DEAD_QUEUE = "doc.ingest.dead";
const DELETE_QUEUE = process.env.DELETE_QUEUE ?? "doc.delete";
const DELETE_DLX = "doc.delete.dlx";
const DELETE_DEAD_QUEUE = "doc.delete.dead";

let warnedDisabled = false;

// Lazy + self-healing (grill 2026-07-19). We cache the in-flight PROMISE — not the
// resolved channel — so N concurrent first-publishes share ONE connect (the second
// caller awaits the same pending promise). On any 'error'/'close' we null the cache
// so the NEXT publish reconnects (passive). The error handlers are mandatory, not
// cosmetic — an unhandled 'error' event on an amqplib connection is re-thrown by
// Node and crashes the process.
let channelPromise: Promise<amqp.ConfirmChannel> | null = null;

// The broker channel has no safe, stable public identifier to expose. This
// process-local ID is attached to the object instead, so every cache hit is
// traceable without logging a URL, credential, or broker implementation detail.
const channelIds = new WeakMap<amqp.ConfirmChannel, string>();
let nextChannelId = 1;


// assigns locally produced channel ids to the channelIds object,
// and returns the id for the given channel. 
// The id is stable for the lifetime of the channel object.
function channelId(channel: amqp.ConfirmChannel): string {
  let id = channelIds.get(channel);
  if (!id) {
    id = `channel-${nextChannelId++}`;
    channelIds.set(channel, id);
  }
  return id;
}

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
  // being fire-and-forget. Both job publishers await that ack.
  const ch = await conn.createConfirmChannel();
  ch.on("error", invalidate);
  ch.on("close", invalidate);

  await ch.assertExchange(INGEST_DLX, "direct", { durable: true });
  await ch.assertQueue(INGEST_DEAD_QUEUE, { durable: true });
  await ch.bindQueue(INGEST_DEAD_QUEUE, INGEST_DLX, INGEST_QUEUE);
  await ch.assertQueue(INGEST_QUEUE, {
    durable: true,
    arguments: { "x-dead-letter-exchange": INGEST_DLX },
  });

  await ch.assertExchange(DELETE_DLX, "direct", { durable: true });
  await ch.assertQueue(DELETE_DEAD_QUEUE, { durable: true });
  await ch.bindQueue(DELETE_DEAD_QUEUE, DELETE_DLX, DELETE_QUEUE);
  await ch.assertQueue(DELETE_QUEUE, {
    durable: true,
    arguments: { "x-dead-letter-exchange": DELETE_DLX },
  });
  
  console.log("RabbitMQ producer confirm channel ready");
  return ch;
}

// Returns a ready confirm channel, or null when background jobs are disabled (RABBITMQ_URL
// unset — plain `npm run dev` without docker must not error-storm). Reuses the
// cached connection and reconnects transparently after a drop.
//
// Non-async on purpose: assigning `channelPromise = connect(url)` synchronously,
// before any await, is what makes concurrent callers share ONE connect (grill Q2).
export function createChannel(): Promise<amqp.ConfirmChannel | null> {
  // Every caller gets one correlated start and one terminal outcome, including
  // callers that join an already-pending connection attempt.
  logOperationalEvent("info", { operation: "createChannel", lifecycle: "started" });
  const url = process.env.RABBITMQ_URL;
  if (!url) {
    logOperationalEvent("warn", { operation: "createChannel", lifecycle: "disabled" });
    if (!warnedDisabled) {
      console.info("RABBITMQ_URL unset — ingest disabled; uploads rest at 'uploaded'.");
      warnedDisabled = true;
    }
    return Promise.resolve(null);
  }
  if (!channelPromise) {
    const connecting = connect(url).then((channel) => {
      // Assign on readiness, rather than promise creation: the ID names the
      // usable channel callers receive, not an attempt that may still fail.
      channelId(channel);
      return channel;
    });
    channelPromise = connecting;
    return connecting.then(
      (channel) => {
        logOperationalEvent("info", {
          operation: "createChannel",
          lifecycle: "created",
          channelId: channelId(channel),
        });
        return channel;
      },
      (error) => {
        // A rejected promise must never poison the cache; the next caller gets
        // a fresh connection attempt just as it did before instrumentation.
        if (channelPromise === connecting) channelPromise = null;
        logOperationalEvent("error", { operation: "createChannel", lifecycle: "failed", error });
        throw error; // propagates to finalizeUpload's swallow-and-log
      },
    );
  }
  return channelPromise.then(
    (channel) => {
      // `channelId` is stable for the lifetime of the cached channel, so a
      // concurrent caller can be tied back to the channel it actually shared.
      logOperationalEvent("info", {
        operation: "createChannel",
        lifecycle: "reused",
        channelId: channelId(channel),
      });
      return channel;
    },
    (error) => {
      logOperationalEvent("error", { operation: "createChannel", lifecycle: "failed", error });
      throw error;
    },
  );
}
