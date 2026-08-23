import path from "path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { fetchSlackLive } from "../services/ingestion/fetchSources.js";
import { initMongo, upsertSlackMessagesBatch } from "../services/storage/stores.js";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "../backend/.env") });

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const dbName = process.env.MONGO_DB || "chro_intelligence";
const orgId = process.env.ORG_ID || process.env.DEFAULT_ORG_ID || "demo";

if (!mongoUri) {
  throw new Error("Missing MONGO_URI in llm/.env");
}

const payload = await fetchSlackLive({ employeeEmail: null, slackCursor: 0 });
if (!payload) {
  throw new Error(
    "Live Slack fetch unavailable. Ensure SLACK_BOT_TOKEN and channel ids are configured in the service environment or backend/.env"
  );
}

await initMongo({ mongoUri, mongoDbName: dbName, useMemoryStore: false });
const upsertStats = await upsertSlackMessagesBatch({
  payload,
  orgId,
  purgeLegacyMock: true,
});

const client = new MongoClient(mongoUri);
await client.connect();
const db = client.db(dbName);

const countFilter = { orgId };
const totalMessages = await db.collection("slack_messages").countDocuments(countFilter);
const totalDocuments = await db
  .collection("documents")
  .countDocuments({ orgId, sourceSystem: "slack", documentType: "slack_message" });

const latestSample = await db
  .collection("slack_messages")
  .find(countFilter)
  .sort({ tsDate: -1, updatedAt: -1 })
  .limit(3)
  .project({ _id: 0, messageKey: 1, employeeEmail: 1, channelName: 1, ts: 1, text: 1 })
  .toArray();

await client.close();

console.log(
  JSON.stringify(
    {
      dbName,
      orgId,
      source: "slack_api",
      upsertStats,
      totalMessages,
      totalDocuments,
      includedChannels: Object.keys(payload).filter((key) => Array.isArray(payload[key]) && key !== "members" && key !== "summary"),
      latestSample,
    },
    null,
    2
  )
);
