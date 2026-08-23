import { Queue, Worker, QueueEvents } from "bullmq";
import Redis from "ioredis";
import Groq from "groq-sdk";

const GROQ_QUEUE_NAME = "groq-request-queue";

let dispatchMode = "direct";
let rpmLimit = 12;
let rateWindowMs = 60_000;

let groqClient = null;
let connection = null;
let queue = null;
let worker = null;
let queueEvents = null;

const directTimestamps = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGroqClient() {
  if (!process.env.GROQ_API_KEY) {
    return null;
  }
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

async function callGroqJson({ model, temperature, system, user }) {
  const client = getGroqClient();
  if (!client) {
    return null;
  }

  const completion = await client.chat.completions.create({
    model,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const content = completion.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content);
}

async function acquireDirectRateSlot() {
  const now = Date.now();
  while (directTimestamps.length > 0 && now - directTimestamps[0] >= rateWindowMs) {
    directTimestamps.shift();
  }

  if (directTimestamps.length < rpmLimit) {
    directTimestamps.push(now);
    return;
  }

  const oldest = directTimestamps[0];
  const waitMs = Math.max(0, rateWindowMs - (now - oldest) + 5);
  await sleep(waitMs);
  return acquireDirectRateSlot();
}

async function initGroqDispatcher({
  redisUrl,
  mode = "auto",
  requestsPerMinute = 12,
  windowMs = 60_000,
}) {
  rpmLimit = requestsPerMinute;
  rateWindowMs = windowMs;

  const wantsDirect = mode === "direct";
  if (wantsDirect) {
    dispatchMode = "direct";
    return { mode: dispatchMode, rpmLimit, rateWindowMs };
  }

  try {
    connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableReadyCheck: false,
      retryStrategy: () => null,
    });
    connection.on("error", () => {
      // Intentionally swallow to avoid noisy unhandled event spam in fallback mode.
    });

    await connection.connect();
    await connection.ping();

    queue = new Queue(GROQ_QUEUE_NAME, { connection });
    queueEvents = new QueueEvents(GROQ_QUEUE_NAME, { connection });
    await queueEvents.waitUntilReady();

    worker = new Worker(
      GROQ_QUEUE_NAME,
      async (job) => {
        return callGroqJson(job.data);
      },
      {
        connection,
        limiter: {
          max: rpmLimit,
          duration: rateWindowMs,
        },
      }
    );

    worker.on("failed", (job, error) => {
      console.error("[groq-dispatcher] job failed", job?.id, error.message);
    });

    dispatchMode = "bullmq";
  } catch (error) {
    if (connection) {
      try {
        connection.disconnect();
      } catch {
        // no-op
      }
    }
    console.warn("[groq-dispatcher] BullMQ unavailable, falling back to direct limiter:", error.message);
    dispatchMode = "direct";
  }

  return { mode: dispatchMode, rpmLimit, rateWindowMs };
}

async function dispatchGroqJson(payload) {
  if (!process.env.GROQ_API_KEY) {
    return null;
  }

  if (dispatchMode === "bullmq" && queue && queueEvents) {
    const job = await queue.add("groq-json", payload, {
      removeOnComplete: true,
      removeOnFail: 200,
    });
    return job.waitUntilFinished(queueEvents, 120_000);
  }

  await acquireDirectRateSlot();
  return callGroqJson(payload);
}

function getGroqDispatcherInfo() {
  return {
    mode: dispatchMode,
    requestsPerMinute: rpmLimit,
    reservedFromProviderLimit: Math.max(0, 30 - rpmLimit),
    providerHardLimit: 30,
    windowMs: rateWindowMs,
  };
}

export {
  initGroqDispatcher,
  dispatchGroqJson,
  getGroqDispatcherInfo,
};
