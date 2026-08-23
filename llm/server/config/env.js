import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_ROOT = path.resolve(__dirname, "../../mock_data");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "chro_intelligence";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_DISPATCH_MODE = process.env.GROQ_DISPATCH_MODE || "auto";
const GROQ_REQUESTS_PER_MINUTE = Number(process.env.GROQ_REQUESTS_PER_MINUTE || 12);
const GROQ_RATE_WINDOW_MS = Number(process.env.GROQ_RATE_WINDOW_MS || 60_000);
const PORT = Number(process.env.PORT || 8080);
const SLACK_DEBOUNCE_MS = Number(process.env.SLACK_DEBOUNCE_MS || 1 * 1000);
const QUEUE_MODE = process.env.QUEUE_MODE || "auto";
const DATA_ROOT = process.env.DATA_ROOT
  ? path.resolve(process.env.DATA_ROOT)
  : DEFAULT_DATA_ROOT;

const USE_MEMORY_STORE = String(process.env.USE_MEMORY_STORE || "true").toLowerCase() === "true";
const USE_MEMORY_CACHE = String(process.env.USE_MEMORY_CACHE || "true").toLowerCase() === "true";

const env = {
  REDIS_URL,
  MONGO_URI,
  MONGO_DB,
  GROQ_MODEL,
  GROQ_DISPATCH_MODE,
  GROQ_REQUESTS_PER_MINUTE,
  GROQ_RATE_WINDOW_MS,
  PORT,
  SLACK_DEBOUNCE_MS,
  QUEUE_MODE,
  DATA_ROOT,
  USE_MEMORY_STORE,
  USE_MEMORY_CACHE,
};

export { env };
