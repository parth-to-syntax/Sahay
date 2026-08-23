import "dotenv/config";
import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGO_URI || "";
const dbName = process.env.MONGO_DB || "hrx";
const orgScoped = String(process.env.SCHEMA_REQUIRE_ORG_ID || "true").toLowerCase() !== "false";
const rawDataTtlDays = Number.parseInt(String(process.env.RAW_DATA_TTL_DAYS || "0"), 10) || 0;
const chatTtlDays = Number.parseInt(String(process.env.CHAT_TTL_DAYS || "0"), 10) || 0;

if (!mongoUri) {
  console.error("MONGO_URI is required. Set it in environment before running db:init.");
  process.exit(1);
}

function requiredOrgFields(baseRequired = []) {
  return orgScoped ? ["orgId", ...baseRequired] : baseRequired;
}

function withOrgPrefix(indexSpec) {
  if (!orgScoped) return indexSpec;
  return { orgId: 1, ...indexSpec };
}

async function ensureCollection(db, name, validator = null) {
  const existing = await db.listCollections({ name }).hasNext();
  if (!existing) {
    const options = validator
      ? {
          validator,
          validationLevel: "moderate",
          validationAction: "warn",
        }
      : {};
    await db.createCollection(name, options);
    return;
  }

  if (validator) {
    await db.command({
      collMod: name,
      validator,
      validationLevel: "moderate",
      validationAction: "warn",
    });
  }
}

async function ensureIndex(collection, keys, options = {}) {
  await collection.createIndex(keys, options);
}

async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);

  await ensureCollection(db, "employees", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["employeeEmail", "displayName", "updatedAt"]),
      properties: {
        orgId: { bsonType: "string" },
        employeeEmail: { bsonType: "string" },
        employeeId: { bsonType: ["string", "null"] },
        displayName: { bsonType: "string" },
        role: { bsonType: ["string", "null"] },
        department: { bsonType: ["string", "null"] },
        managerName: { bsonType: ["string", "null"] },
        managerEmail: { bsonType: ["string", "null"] },
        source: { bsonType: ["string", "null"] },
        createdAt: { bsonType: ["date", "string", "null"] },
        updatedAt: { bsonType: ["date", "string"] },
      },
    },
  });

  await ensureCollection(db, "employee_profiles", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["employeeEmail", "version", "analyzedAt", "analysis"]),
      properties: {
        orgId: { bsonType: "string" },
        employeeEmail: { bsonType: "string" },
        employeeName: { bsonType: ["string", "null"] },
        version: { bsonType: "int" },
        reason: { bsonType: ["string", "null"] },
        analyzedAt: { bsonType: ["date", "string"] },
        analysis: { bsonType: "object" },
      },
    },
  });

  await ensureCollection(db, "meetings", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["meetingId", "employeeEmail", "meetingAt"]),
      properties: {
        orgId: { bsonType: "string" },
        meetingId: { bsonType: "string" },
        employeeEmail: { bsonType: "string" },
        title: { bsonType: ["string", "null"] },
        meetingAt: { bsonType: ["date", "string"] },
        participants: { bsonType: ["array", "null"] },
        summary: { bsonType: ["string", "null"] },
        transcript: { bsonType: ["array", "null"] },
      },
    },
  });

  await ensureCollection(db, "meeting_transcript_turns", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["meetingId", "turnIndex", "text"]),
      properties: {
        orgId: { bsonType: "string" },
        meetingId: { bsonType: "string" },
        turnIndex: { bsonType: "int" },
        speaker: { bsonType: ["string", "null"] },
        text: { bsonType: "string" },
      },
    },
  });

  await ensureCollection(db, "slack_messages", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["messageKey", "channelId", "ts", "text"]),
      properties: {
        orgId: { bsonType: "string" },
        messageKey: { bsonType: "string" },
        employeeEmail: { bsonType: ["string", "null"] },
        channelId: { bsonType: "string" },
        channelName: { bsonType: ["string", "null"] },
        ts: { bsonType: "string" },
        tsDate: { bsonType: ["date", "string", "null"] },
        text: { bsonType: "string" },
      },
    },
  });

  await ensureCollection(db, "bamboo_employee_snapshots", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["employeeEmail", "fetchedAt", "payload"]),
      properties: {
        orgId: { bsonType: "string" },
        employeeEmail: { bsonType: "string" },
        employeeId: { bsonType: ["string", "null"] },
        fetchedAt: { bsonType: ["date", "string"] },
        payload: { bsonType: "object" },
      },
    },
  });

  await ensureCollection(db, "alerts", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["employeeEmail", "severity", "kind", "message", "createdAt"]),
      properties: {
        orgId: { bsonType: "string" },
        employeeEmail: { bsonType: "string" },
        severity: { bsonType: "string" },
        kind: { bsonType: "string" },
        message: { bsonType: "string" },
        status: { bsonType: ["string", "null"] },
        createdAt: { bsonType: ["date", "string"] },
      },
    },
  });

  await ensureCollection(db, "sync_state", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["employeeEmail", "updatedAt"]),
      properties: {
        orgId: { bsonType: "string" },
        employeeEmail: { bsonType: "string" },
        slackCursor: { bsonType: ["int", "long", "double", "decimal", "string", "null"] },
        meetingCursor: { bsonType: ["int", "long", "double", "decimal", "string", "null"] },
        updatedAt: { bsonType: ["date", "string"] },
      },
    },
  });

  await ensureCollection(db, "employee_raw_data", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["employeeEmail", "fetchedAt", "payload"]),
      properties: {
        orgId: { bsonType: "string" },
        employeeEmail: { bsonType: "string" },
        reason: { bsonType: ["string", "null"] },
        fetchedAt: { bsonType: ["date", "string"] },
        payload: { bsonType: "object" },
        createdAt: { bsonType: ["date", "string", "null"] },
      },
    },
  });

  await ensureCollection(db, "system_state", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["key", "value"]),
      properties: {
        orgId: { bsonType: "string" },
        key: { bsonType: "string" },
        value: {},
        details: { bsonType: ["object", "null"] },
      },
    },
  });

  await ensureCollection(db, "chat_sessions", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["sessionId", "startedAt", "lastMessageAt", "status"]),
      properties: {
        orgId: { bsonType: "string" },
        sessionId: { bsonType: "string" },
        userId: { bsonType: ["string", "null"] },
        title: { bsonType: ["string", "null"] },
        startedAt: { bsonType: ["date", "string"] },
        lastMessageAt: { bsonType: ["date", "string"] },
        status: { bsonType: "string" },
      },
    },
  });

  await ensureCollection(db, "chat_messages", {
    $jsonSchema: {
      bsonType: "object",
      required: requiredOrgFields(["sessionId", "messageIndex", "role", "createdAt"]),
      properties: {
        orgId: { bsonType: "string" },
        sessionId: { bsonType: "string" },
        messageIndex: { bsonType: "int" },
        role: { bsonType: "string" },
        query: { bsonType: ["string", "null"] },
        answer: { bsonType: ["string", "null"] },
        createdAt: { bsonType: ["date", "string"] },
      },
    },
  });

  const employees = db.collection("employees");
  const employeeProfiles = db.collection("employee_profiles");
  const meetings = db.collection("meetings");
  const transcriptTurns = db.collection("meeting_transcript_turns");
  const slackMessages = db.collection("slack_messages");
  const bambooSnapshots = db.collection("bamboo_employee_snapshots");
  const alerts = db.collection("alerts");
  const syncState = db.collection("sync_state");
  const employeeRawData = db.collection("employee_raw_data");
  const systemState = db.collection("system_state");
  const chatSessions = db.collection("chat_sessions");
  const chatMessages = db.collection("chat_messages");

  await ensureIndex(employees, withOrgPrefix({ employeeEmail: 1 }), {
    unique: true,
    partialFilterExpression: { employeeEmail: { $type: "string" } },
    name: "uq_employee_email",
  });
  await ensureIndex(employees, withOrgPrefix({ employeeId: 1 }), {
    unique: true,
    partialFilterExpression: { employeeId: { $type: "string" } },
    name: "uq_employee_id",
  });
  await ensureIndex(employees, withOrgPrefix({ department: 1, updatedAt: -1 }), { name: "ix_department_updatedAt" });

  await ensureIndex(employeeProfiles, withOrgPrefix({ employeeEmail: 1, version: -1 }), {
    unique: true,
    partialFilterExpression: { employeeEmail: { $type: "string" }, version: { $type: "int" } },
    name: "uq_profile_version",
  });
  await ensureIndex(employeeProfiles, withOrgPrefix({ employeeEmail: 1, analyzedAt: -1 }), { name: "ix_profile_latest" });
  await ensureIndex(employeeProfiles, withOrgPrefix({ "analysis.retentionRisk.level": 1, "analysis.health.score": 1 }), {
    name: "ix_profile_risk_health",
  });

  await ensureIndex(meetings, withOrgPrefix({ meetingId: 1 }), {
    unique: true,
    partialFilterExpression: { meetingId: { $type: "string" } },
    name: "uq_meeting_id",
  });
  await ensureIndex(meetings, withOrgPrefix({ employeeEmail: 1, meetingAt: -1 }), { name: "ix_meetings_employee_date" });
  await ensureIndex(meetings, withOrgPrefix({ meetingAt: -1 }), { name: "ix_meetings_date" });

  await ensureIndex(transcriptTurns, withOrgPrefix({ meetingId: 1, turnIndex: 1 }), {
    unique: true,
    partialFilterExpression: { meetingId: { $type: "string" }, turnIndex: { $type: "int" } },
    name: "uq_transcript_turn",
  });
  await ensureIndex(transcriptTurns, withOrgPrefix({ meetingId: 1, turnIndex: 1 }), { name: "ix_transcript_order" });

  await ensureIndex(slackMessages, withOrgPrefix({ messageKey: 1 }), {
    unique: true,
    partialFilterExpression: { messageKey: { $type: "string" } },
    name: "uq_slack_message_key",
  });
  await ensureIndex(slackMessages, withOrgPrefix({ employeeEmail: 1, tsDate: -1 }), { name: "ix_slack_employee_ts" });
  await ensureIndex(slackMessages, withOrgPrefix({ channelId: 1, tsDate: -1 }), { name: "ix_slack_channel_ts" });

  await ensureIndex(bambooSnapshots, withOrgPrefix({ employeeEmail: 1, fetchedAt: -1 }), { name: "ix_bamboo_snapshot_latest" });
  await ensureIndex(bambooSnapshots, withOrgPrefix({ employeeId: 1 }), {
    partialFilterExpression: { employeeId: { $type: "string" } },
    name: "ix_bamboo_employee_id",
  });

  await ensureIndex(alerts, withOrgPrefix({ employeeEmail: 1, createdAt: -1 }), { name: "ix_alerts_employee_date" });
  await ensureIndex(alerts, withOrgPrefix({ severity: 1, status: 1, createdAt: -1 }), { name: "ix_alerts_triage" });

  await ensureIndex(syncState, withOrgPrefix({ employeeEmail: 1 }), {
    unique: true,
    partialFilterExpression: { employeeEmail: { $type: "string" } },
    name: "uq_sync_state_employee",
  });

  await ensureIndex(employeeRawData, withOrgPrefix({ employeeEmail: 1, fetchedAt: -1 }), { name: "ix_raw_employee_date" });
  if (rawDataTtlDays > 0) {
    await ensureIndex(employeeRawData, { createdAt: 1 }, {
      expireAfterSeconds: rawDataTtlDays * 24 * 60 * 60,
      partialFilterExpression: { createdAt: { $type: "date" } },
      name: "ttl_employee_raw_data_createdAt",
    });
  }

  await ensureIndex(systemState, withOrgPrefix({ key: 1 }), {
    unique: true,
    partialFilterExpression: { key: { $type: "string" } },
    name: "uq_system_state_key",
  });

  await ensureIndex(chatSessions, withOrgPrefix({ sessionId: 1 }), {
    unique: true,
    partialFilterExpression: { sessionId: { $type: "string" } },
    name: "uq_chat_session",
  });
  await ensureIndex(chatSessions, withOrgPrefix({ userId: 1, lastMessageAt: -1 }), {
    partialFilterExpression: { userId: { $type: "string" } },
    name: "ix_chat_sessions_user",
  });

  await ensureIndex(chatMessages, withOrgPrefix({ sessionId: 1, messageIndex: 1 }), {
    unique: true,
    partialFilterExpression: { sessionId: { $type: "string" }, messageIndex: { $type: "int" } },
    name: "uq_chat_message_order",
  });
  await ensureIndex(chatMessages, withOrgPrefix({ sessionId: 1, createdAt: 1 }), { name: "ix_chat_messages_session_time" });
  if (chatTtlDays > 0) {
    await ensureIndex(chatMessages, { createdAt: 1 }, {
      expireAfterSeconds: chatTtlDays * 24 * 60 * 60,
      partialFilterExpression: { createdAt: { $type: "date" } },
      name: "ttl_chat_messages_createdAt",
    });
  }

  console.log(`Mongo schema initialized for database ${dbName}.`);
  await client.close();
}

main().catch((error) => {
  console.error("db:init failed", error.message);
  process.exit(1);
});
