import Redis from "ioredis";

const memoryCache = new Map();
let redisClient = null;

function withKey(key) {
  return `chro:${key}`;
}

async function initCache({ redisUrl, useMemoryCache }) {
  if (useMemoryCache || !redisUrl) {
    return { mode: "memory" };
  }

  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  redisClient.on("error", (error) => {
    console.error("[cache] redis error", error.message);
  });

  await redisClient.ping();
  return { mode: "redis" };
}

function isRedisReady() {
  return Boolean(redisClient);
}

async function setJson(key, value, ttlSec) {
  const namespaced = withKey(key);

  if (!isRedisReady()) {
    memoryCache.set(namespaced, { value, expiresAt: Date.now() + ttlSec * 1000 });
    return;
  }

  await redisClient.set(namespaced, JSON.stringify(value), "EX", ttlSec);
}

async function getJson(key) {
  const namespaced = withKey(key);

  if (!isRedisReady()) {
    const entry = memoryCache.get(namespaced);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      memoryCache.delete(namespaced);
      return null;
    }
    return entry.value;
  }

  const raw = await redisClient.get(namespaced);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

async function del(key) {
  const namespaced = withKey(key);
  if (!isRedisReady()) {
    memoryCache.delete(namespaced);
    return;
  }
  await redisClient.del(namespaced);
}

async function warmProfileCache(profile) {
  await setJson(`profile:${profile.employeeEmail}`, profile, 3600);
}

async function warmDashboardCache(summary) {
  await setJson("dashboard", summary, 900);
}

export {
  initCache,
  setJson,
  getJson,
  del,
  warmProfileCache,
  warmDashboardCache,
};
