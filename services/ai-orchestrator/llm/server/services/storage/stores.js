import { MongoClient } from "mongodb";

const memory = {
  employees: [],
  rawData: [],
  profiles: [],
  sentimentHistory: [],
  riskHistory: [],
  alerts: [],
  syncState: [],
  meetings: [],
  systemState: [],
  chatSessions: [],
  chatMessages: [],
};

let mongoClient = null;
let mongoDb = null;

async function initMongo({ mongoUri, mongoDbName, useMemoryStore }) {
  if (useMemoryStore || !mongoUri) {
    return { mode: "memory" };
  }

  mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  mongoDb = mongoClient.db(mongoDbName);

  await mongoDb.collection("employee_profiles").createIndex({ employeeEmail: 1, version: -1 });
  await mongoDb.collection("alerts").createIndex({ employeeEmail: 1, createdAt: -1 });
  await mongoDb.collection("employees").createIndex(
    { employeeEmail: 1 },
    {
      unique: true,
      partialFilterExpression: { employeeEmail: { $type: "string" } },
    }
  );
  await mongoDb.collection("employee_raw_data").createIndex({ employeeEmail: 1, fetchedAt: -1 });
  await mongoDb.collection("sentiment_history").createIndex({ employeeEmail: 1, analyzedAt: -1 });
  await mongoDb.collection("sentiment_history").createIndex({ employeeEmail: 1, profileVersion: -1 });
  await mongoDb.collection("risk_history").createIndex({ employeeEmail: 1, analyzedAt: -1 });
  await mongoDb.collection("risk_history").createIndex({ employeeEmail: 1, profileVersion: -1 });
  await mongoDb.collection("sync_state").createIndex(
    { employeeEmail: 1 },
    {
      unique: true,
      partialFilterExpression: { employeeEmail: { $type: "string" } },
    }
  );
  await mongoDb.collection("meetings").createIndex({ employeeEmail: 1, meetingAt: -1 });
  await mongoDb.collection("meetings").createIndex(
    { meetingId: 1 },
    {
      unique: true,
      partialFilterExpression: { meetingId: { $type: "string" } },
    }
  );
  await mongoDb.collection("system_state").createIndex(
    { key: 1 },
    {
      unique: true,
      partialFilterExpression: { key: { $type: "string" } },
    }
  );
  await mongoDb.collection("chat_sessions").createIndex(
    { sessionId: 1 },
    {
      unique: true,
      partialFilterExpression: { sessionId: { $type: "string" } },
    }
  );
  await mongoDb.collection("chat_sessions").createIndex({ lastMessageAt: -1 });
  await mongoDb.collection("chat_sessions").createIndex({ status: 1, lastMessageAt: -1 });
  await mongoDb.collection("chat_sessions").createIndex({ userId: 1, lastMessageAt: -1 });
  await mongoDb.collection("chat_messages").createIndex(
    { sessionId: 1, messageIndex: 1 },
    {
      unique: true,
      partialFilterExpression: { sessionId: { $type: "string" }, messageIndex: { $type: "int" } },
    }
  );
  await mongoDb.collection("chat_messages").createIndex({ sessionId: 1, createdAt: 1 });

  return { mode: "mongo" };
}

function isMongoReady() {
  return Boolean(mongoDb);
}

function byAnalyzedAtDesc(a, b) {
  const left = new Date(a?.analyzedAt || 0).getTime();
  const right = new Date(b?.analyzedAt || 0).getTime();
  return right - left;
}

function parseHistoryLimit(limit = 30) {
  const parsed = Number.parseInt(String(limit), 10);
  if (!Number.isFinite(parsed)) {
    return 30;
  }
  return Math.max(1, Math.min(parsed, 180));
}

function isMissingIdentityValue(value) { const normalized = String(value || "").trim().toLowerCase(); return !normalized || normalized === "unknown" || normalized === "n/a" || normalized === "na"; }

function pickIdentityValue(incoming, existing, fallback = "Unknown") { if (!isMissingIdentityValue(incoming)) return String(incoming).trim(); if (!isMissingIdentityValue(existing)) return String(existing).trim(); return fallback; }

function isPlaceholderEmployeeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) {
    return true;
  }
  if (!email.includes("@")) {
    return true;
  }
  return (
    email === "unknown@company.com" ||
    email === "unknown@unknown.local" ||
    email.startsWith("unknown@")
  );
}

async function getLatestProfile(employeeEmail) {
  if (!employeeEmail) {
    return null;
  }

  if (!isMongoReady()) {
    const filtered = memory.profiles
      .filter((item) => item.employeeEmail === employeeEmail)
      .sort((a, b) => b.version - a.version);
    return filtered[0] || null;
  }

  return mongoDb.collection("employee_profiles").findOne(
    { employeeEmail },
    { sort: { version: -1 } }
  );
}

async function upsertEmployeeIdentity(identityDoc) {
  if (!identityDoc?.employeeEmail) {
    return null;
  }

  const employeeEmail = String(identityDoc.employeeEmail).toLowerCase();
  if (isPlaceholderEmployeeEmail(employeeEmail)) {
    return null;
  }
  const incomingIdentity = {
    employeeId: identityDoc.employeeId || identityDoc.id,
    displayName: identityDoc.displayName || identityDoc.fullName || identityDoc.name,
    role: identityDoc.role || identityDoc.title || identityDoc.jobTitle,
    department: identityDoc.department || identityDoc.dept,
    source: identityDoc.source,
  };

  if (!isMongoReady()) {
    const index = memory.employees.findIndex((item) => item.employeeEmail === employeeEmail);
    const existing = index >= 0 ? memory.employees[index] : null;

    const base = {
      employeeEmail,
      employeeId: !isMissingIdentityValue(incomingIdentity.employeeId)
        ? String(incomingIdentity.employeeId).trim()
        : !isMissingIdentityValue(existing?.employeeId)
          ? String(existing.employeeId).trim()
          : null,
      displayName: pickIdentityValue(incomingIdentity.displayName, existing?.displayName, "Unknown"),
      role: pickIdentityValue(incomingIdentity.role, existing?.role, "Unknown"),
      department: pickIdentityValue(incomingIdentity.department, existing?.department, "Unknown"),
      source: !isMissingIdentityValue(incomingIdentity.source)
        ? String(incomingIdentity.source).trim()
        : !isMissingIdentityValue(existing?.source)
          ? String(existing.source).trim()
          : "unknown",
      updatedAt: new Date().toISOString(),
    };

    if (index >= 0) {
      memory.employees[index] = { ...memory.employees[index], ...base };
      return memory.employees[index];
    }

    memory.employees.push(base);
    return base;
  }

  const existing = await mongoDb.collection("employees").findOne({ employeeEmail });

  const base = {
    employeeEmail,
    employeeId: !isMissingIdentityValue(incomingIdentity.employeeId)
      ? String(incomingIdentity.employeeId).trim()
      : !isMissingIdentityValue(existing?.employeeId)
        ? String(existing.employeeId).trim()
        : null,
    displayName: pickIdentityValue(incomingIdentity.displayName, existing?.displayName, "Unknown"),
    role: pickIdentityValue(incomingIdentity.role, existing?.role, "Unknown"),
    department: pickIdentityValue(incomingIdentity.department, existing?.department, "Unknown"),
    source: !isMissingIdentityValue(incomingIdentity.source)
      ? String(incomingIdentity.source).trim()
      : !isMissingIdentityValue(existing?.source)
        ? String(existing.source).trim()
        : "unknown",
    updatedAt: new Date().toISOString(),
  };

  await mongoDb.collection("employees").updateOne(
    { employeeEmail },
    {
      $set: base,
      $setOnInsert: { createdAt: new Date().toISOString() },
    },
    { upsert: true }
  );

  return mongoDb.collection("employees").findOne({ employeeEmail });
}

async function listEmployees() {
  if (!isMongoReady()) {
    return memory.employees.filter((item) => !isPlaceholderEmployeeEmail(item?.employeeEmail));
  }
  const rows = await mongoDb.collection("employees").find({}).toArray();
  return rows.filter((item) => !isPlaceholderEmployeeEmail(item?.employeeEmail));
}

async function getSyncState(employeeEmail) {
  const key = String(employeeEmail || "").toLowerCase();
  if (!key) {
    return { employeeEmail: "", slackCursor: 0, meetingCursor: 0 };
  }

  if (!isMongoReady()) {
    const row = memory.syncState.find((item) => item.employeeEmail === key);
    return row || { employeeEmail: key, slackCursor: 0, meetingCursor: 0 };
  }

  const row = await mongoDb.collection("sync_state").findOne({ employeeEmail: key });
  return row || { employeeEmail: key, slackCursor: 0, meetingCursor: 0 };
}

async function updateSyncState(employeeEmail, patch = {}) {
  const key = String(employeeEmail || "").toLowerCase();
  const next = {
    employeeEmail: key,
    slackCursor: Number(patch.slackCursor || 0),
    meetingCursor: Number(patch.meetingCursor || 0),
    updatedAt: new Date().toISOString(),
  };

  if (!isMongoReady()) {
    const index = memory.syncState.findIndex((item) => item.employeeEmail === key);
    if (index >= 0) {
      memory.syncState[index] = { ...memory.syncState[index], ...next };
      return memory.syncState[index];
    }
    memory.syncState.push(next);
    return next;
  }

  await mongoDb.collection("sync_state").updateOne(
    { employeeEmail: key },
    {
      $set: next,
      $setOnInsert: { createdAt: new Date().toISOString() },
    },
    { upsert: true }
  );

  return mongoDb.collection("sync_state").findOne({ employeeEmail: key });
}

async function isColdBootCompleted() {
  if (!isMongoReady()) {
    const state = memory.systemState.find((item) => item.key === "cold_boot_completed");
    return Boolean(state?.value);
  }

  const state = await mongoDb.collection("system_state").findOne({ key: "cold_boot_completed" });
  return Boolean(state?.value);
}

async function markColdBootCompleted(details = {}) {
  const payload = {
    key: "cold_boot_completed",
    value: true,
    completedAt: new Date().toISOString(),
    details,
  };

  if (!isMongoReady()) {
    const index = memory.systemState.findIndex((item) => item.key === "cold_boot_completed");
    if (index >= 0) {
      memory.systemState[index] = payload;
    } else {
      memory.systemState.push(payload);
    }
    return payload;
  }

  await mongoDb.collection("system_state").updateOne(
    { key: "cold_boot_completed" },
    { $set: payload },
    { upsert: true }
  );
  return payload;
}

function toSafeSessionId(value) {
  return String(value || "").trim();
}

function toSafeRole(role) {
  const safe = String(role || "").toLowerCase();
  if (["user", "assistant", "system"].includes(safe)) {
    return safe;
  }
  return "assistant";
}

async function getChatSession(sessionId) {
  const key = toSafeSessionId(sessionId);
  if (!key) {
    return null;
  }

  if (!isMongoReady()) {
    return memory.chatSessions.find((item) => item.sessionId === key) || null;
  }

  return mongoDb.collection("chat_sessions").findOne({ sessionId: key });
}

async function createChatSession({ sessionId, status = "active" } = {}) {
  const key = toSafeSessionId(sessionId);
  if (!key) {
    return null;
  }

  const now = new Date().toISOString();

  if (!isMongoReady()) {
    const index = memory.chatSessions.findIndex((item) => item.sessionId === key);
    const existing = index >= 0 ? memory.chatSessions[index] : null;
    const next = {
      sessionId: key,
      status: String(status || "active"),
      startedAt: existing?.startedAt || now,
      lastMessageAt: existing?.lastMessageAt || now,
      nextMessageIndex: Number(existing?.nextMessageIndex || 0),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (index >= 0) {
      memory.chatSessions[index] = { ...existing, ...next };
      return memory.chatSessions[index];
    }

    memory.chatSessions.push(next);
    return next;
  }

  await mongoDb.collection("chat_sessions").updateOne(
    { sessionId: key },
    {
      $set: {
        status: String(status || "active"),
        updatedAt: now,
      },
      $setOnInsert: {
        sessionId: key,
        startedAt: now,
        lastMessageAt: now,
        nextMessageIndex: 0,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return mongoDb.collection("chat_sessions").findOne({ sessionId: key });
}

async function listChatSessions({ limit = 50, status } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 50), 200));
  const statusFilter = status ? String(status).toLowerCase() : "";

  if (!isMongoReady()) {
    let rows = [...memory.chatSessions];
    if (statusFilter) {
      rows = rows.filter((item) => String(item?.status || "").toLowerCase() === statusFilter);
    }

    return rows
      .sort((a, b) => new Date(b?.lastMessageAt || 0).getTime() - new Date(a?.lastMessageAt || 0).getTime())
      .slice(0, safeLimit);
  }

  const query = statusFilter ? { status: statusFilter } : {};
  return mongoDb
    .collection("chat_sessions")
    .find(query)
    .sort({ lastMessageAt: -1 })
    .limit(safeLimit)
    .toArray();
}

async function updateChatSession(sessionId, patch = {}) {
  const key = toSafeSessionId(sessionId);
  if (!key) {
    return null;
  }

  const now = new Date().toISOString();
  const next = { updatedAt: now };

  if (patch?.status) {
    const safeStatus = String(patch.status).toLowerCase();
    if (["active", "archived"].includes(safeStatus)) {
      next.status = safeStatus;
    }
  }

  if (patch?.title !== undefined) {
    const title = String(patch.title || "").trim();
    next.title = title || null;
  }

  if (patch?.userId !== undefined) {
    const userId = String(patch.userId || "").trim();
    next.userId = userId || null;
  }

  if (!isMongoReady()) {
    const index = memory.chatSessions.findIndex((item) => item.sessionId === key);
    if (index >= 0) {
      memory.chatSessions[index] = { ...memory.chatSessions[index], ...next };
      return memory.chatSessions[index];
    }

    const created = {
      sessionId: key,
      status: next.status || "active",
      startedAt: now,
      lastMessageAt: now,
      nextMessageIndex: 0,
      createdAt: now,
      ...next,
    };
    memory.chatSessions.push(created);
    return created;
  }

  await mongoDb.collection("chat_sessions").updateOne(
    { sessionId: key },
    {
      $set: next,
      $setOnInsert: {
        sessionId: key,
        startedAt: now,
        lastMessageAt: now,
        nextMessageIndex: 0,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return mongoDb.collection("chat_sessions").findOne({ sessionId: key });
}

async function deleteChatSession(sessionId) {
  const key = toSafeSessionId(sessionId);
  if (!key) {
    return null;
  }

  if (!isMongoReady()) {
    const sessionIndex = memory.chatSessions.findIndex((item) => item.sessionId === key);
    if (sessionIndex < 0) {
      return null;
    }

    memory.chatSessions.splice(sessionIndex, 1);
    const beforeCount = memory.chatMessages.length;
    memory.chatMessages = memory.chatMessages.filter((item) => item.sessionId !== key);
    const deletedMessageCount = beforeCount - memory.chatMessages.length;

    return {
      sessionId: key,
      deleted: true,
      deletedMessageCount,
    };
  }

  const [sessionDelete, messageDelete] = await Promise.all([
    mongoDb.collection("chat_sessions").deleteOne({ sessionId: key }),
    mongoDb.collection("chat_messages").deleteMany({ sessionId: key }),
  ]);

  if (Number(sessionDelete?.deletedCount || 0) < 1) {
    return null;
  }

  return {
    sessionId: key,
    deleted: true,
    deletedMessageCount: Number(messageDelete?.deletedCount || 0),
  };
}

async function updateChatSessionActivity(sessionId, patch = {}) {
  const key = toSafeSessionId(sessionId);
  if (!key) {
    return null;
  }

  const now = new Date().toISOString();
  const next = {
    lastMessageAt: patch.lastMessageAt || now,
    updatedAt: now,
  };
  if (patch.status) {
    next.status = String(patch.status);
  }

  if (!isMongoReady()) {
    const index = memory.chatSessions.findIndex((item) => item.sessionId === key);
    if (index >= 0) {
      memory.chatSessions[index] = { ...memory.chatSessions[index], ...next };
      return memory.chatSessions[index];
    }

    const created = {
      sessionId: key,
      status: String(patch.status || "active"),
      startedAt: now,
      createdAt: now,
      nextMessageIndex: 0,
      ...next,
    };
    memory.chatSessions.push(created);
    return created;
  }

  await mongoDb.collection("chat_sessions").updateOne(
    { sessionId: key },
    {
      $set: next,
      $setOnInsert: {
        sessionId: key,
        startedAt: now,
        createdAt: now,
        nextMessageIndex: 0,
      },
    },
    { upsert: true }
  );

  return mongoDb.collection("chat_sessions").findOne({ sessionId: key });
}

async function appendChatMessage({ sessionId, role, content, metadata = {} }) {
  const key = toSafeSessionId(sessionId);
  const safeRole = toSafeRole(role);
  const text = String(content || "").trim();
  if (!key || !text) {
    return null;
  }

  const now = new Date().toISOString();

  if (!isMongoReady()) {
    const sameSession = memory.chatMessages.filter((item) => item.sessionId === key);
    const messageIndex = sameSession.length
      ? Math.max(...sameSession.map((item) => Number(item.messageIndex || 0))) + 1
      : 0;

    const doc = {
      sessionId: key,
      messageIndex,
      role: safeRole,
      content: text,
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      createdAt: now,
      updatedAt: now,
    };

    memory.chatMessages.push(doc);
    await updateChatSessionActivity(key, { status: "active", lastMessageAt: now });
    return doc;
  }

  const sessionAfterUpdate = await mongoDb.collection("chat_sessions").findOneAndUpdate(
    { sessionId: key },
    {
      $inc: { nextMessageIndex: 1 },
      $set: {
        status: "active",
        lastMessageAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        sessionId: key,
        startedAt: now,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: "after" }
  );

  const nextMessageIndex = Number(sessionAfterUpdate?.nextMessageIndex || 1);
  const messageIndex = Math.max(0, nextMessageIndex - 1);

  const doc = {
    sessionId: key,
    messageIndex,
    role: safeRole,
    content: text,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    createdAt: now,
    updatedAt: now,
  };

  await mongoDb.collection("chat_messages").insertOne(doc);
  return doc;
}

async function listChatMessages(sessionId, { limit = 100 } = {}) {
  const key = toSafeSessionId(sessionId);
  const safeLimit = Math.max(1, Math.min(Number(limit || 100), 500));
  if (!key) {
    return [];
  }

  if (!isMongoReady()) {
    return memory.chatMessages
      .filter((item) => item.sessionId === key)
      .sort((a, b) => Number(a.messageIndex || 0) - Number(b.messageIndex || 0))
      .slice(-safeLimit);
  }

  const rows = await mongoDb
    .collection("chat_messages")
    .find({ sessionId: key })
    .sort({ messageIndex: -1 })
    .limit(safeLimit)
    .toArray();

  return rows.reverse();
}

async function getNextProfileVersion(employeeEmail) {
  const latest = await getLatestProfile(employeeEmail);
  return latest ? Number(latest.version || 0) + 1 : 1;
}

async function saveProfile(profileDoc) {
  if (!isMongoReady()) {
    memory.profiles.push(profileDoc);
    return profileDoc;
  }
  await mongoDb.collection("employee_profiles").insertOne(profileDoc);
  return profileDoc;
}

async function saveAlerts(alertDocs) {
  if (!Array.isArray(alertDocs) || alertDocs.length === 0) {
    return;
  }

  if (!isMongoReady()) {
    memory.alerts.push(...alertDocs);
    return;
  }

  await mongoDb.collection("alerts").insertMany(alertDocs);
}

async function saveRawDataSnapshot(rawDoc) {
  if (!rawDoc?.employeeEmail) {
    return null;
  }

  if (!isMongoReady()) {
    memory.rawData.push(rawDoc);
    return rawDoc;
  }

  await mongoDb.collection("employee_raw_data").insertOne(rawDoc);
  return rawDoc;
}

async function saveSentimentHistory(doc) {
  if (!doc?.employeeEmail) {
    return null;
  }

  if (!isMongoReady()) {
    memory.sentimentHistory.push(doc);
    return doc;
  }

  await mongoDb.collection("sentiment_history").insertOne(doc);
  return doc;
}

async function saveRiskHistory(doc) {
  if (!doc?.employeeEmail) {
    return null;
  }

  if (!isMongoReady()) {
    memory.riskHistory.push(doc);
    return doc;
  }

  await mongoDb.collection("risk_history").insertOne(doc);
  return doc;
}

async function listSentimentHistory(employeeEmail, { limit = 30 } = {}) {
  const email = String(employeeEmail || "").toLowerCase();
  if (!email) {
    return [];
  }

  const safeLimit = parseHistoryLimit(limit);

  if (!isMongoReady()) {
    return memory.sentimentHistory
      .filter((item) => String(item?.employeeEmail || "").toLowerCase() === email)
      .sort(byAnalyzedAtDesc)
      .slice(0, safeLimit)
      .reverse();
  }

  const rows = await mongoDb
    .collection("sentiment_history")
    .find({ employeeEmail: email })
    .sort({ analyzedAt: -1 })
    .limit(safeLimit)
    .toArray();

  return rows.reverse();
}

async function listRiskHistory(employeeEmail, { limit = 30 } = {}) {
  const email = String(employeeEmail || "").toLowerCase();
  if (!email) {
    return [];
  }

  const safeLimit = parseHistoryLimit(limit);

  if (!isMongoReady()) {
    return memory.riskHistory
      .filter((item) => String(item?.employeeEmail || "").toLowerCase() === email)
      .sort(byAnalyzedAtDesc)
      .slice(0, safeLimit)
      .reverse();
  }

  const rows = await mongoDb
    .collection("risk_history")
    .find({ employeeEmail: email })
    .sort({ analyzedAt: -1 })
    .limit(safeLimit)
    .toArray();

  return rows.reverse();
}

async function saveMeetingRecord(meetingDoc) {
  if (!meetingDoc?.meetingId) {
    return null;
  }

  if (!isMongoReady()) {
    const index = memory.meetings.findIndex((item) => item.meetingId === meetingDoc.meetingId);
    if (index >= 0) {
      memory.meetings[index] = { ...memory.meetings[index], ...meetingDoc };
      return memory.meetings[index];
    }
    memory.meetings.push(meetingDoc);
    return meetingDoc;
  }

  await mongoDb.collection("meetings").updateOne(
    { meetingId: meetingDoc.meetingId },
    {
      $set: meetingDoc,
      $setOnInsert: { createdAt: new Date().toISOString() },
    },
    { upsert: true }
  );

  return mongoDb.collection("meetings").findOne({ meetingId: meetingDoc.meetingId });
}

function normalizeSlackTsDate(tsValue) {
  const asNumber = Number(tsValue);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return null;
  }
  return new Date(Math.floor(asNumber * 1000));
}

function normalizeSlackText(value) {
  return String(value || "").trim();
}

function buildSlackMemberLookup(members = []) {
  const lookup = new Map();
  if (!Array.isArray(members)) {
    return lookup;
  }

  members.forEach((member) => {
    const userId = String(member?.userId || member?.id || "").trim();
    if (!userId) {
      return;
    }

    lookup.set(userId, {
      email: toLowerEmail(member?.email),
      realName: String(member?.realName || member?.displayName || member?.name || "").trim() || null,
    });
  });

  return lookup;
}

function collectSlackChannelEntries(payload = {}) {
  return Object.entries(payload || {}).filter(([key, value]) => {
    if (!Array.isArray(value)) {
      return false;
    }
    return key !== "members" && key !== "summary";
  });
}

async function removeLegacyMockSlackRows(orgId) {
  if (!isMongoReady()) {
    return;
  }

  await mongoDb.collection("slack_messages").deleteMany({
    orgId,
    $or: [
      { channelId: { $in: ["general", "random", "hr_discussions"] } },
      { messageKey: { $regex: "^hr_discussions:" } },
    ],
  });

  await mongoDb.collection("documents").deleteMany({
    orgId,
    sourceSystem: "slack",
    documentType: "slack_message",
    $or: [
      { externalId: { $regex: "^slack:message:general:" } },
      { externalId: { $regex: "^slack:message:random:" } },
      { externalId: { $regex: "^slack:message:hr_discussions:" } },
    ],
  });
}

async function upsertSlackMessagesBatch({ payload = {}, orgId = "demo", purgeLegacyMock = false } = {}) {
  if (!isMongoReady()) {
    return {
      mode: "memory",
      processed: 0,
      upserted: 0,
      documentsUpserted: 0,
    };
  }

  const safeOrgId = String(orgId || "demo").trim() || "demo";
  if (purgeLegacyMock) {
    await removeLegacyMockSlackRows(safeOrgId);
  }

  const now = new Date();
  const memberLookup = buildSlackMemberLookup(payload?.members);
  const channelEntries = collectSlackChannelEntries(payload);

  const messageOps = [];
  const documentOps = [];
  const seen = new Set();
  let processed = 0;

  channelEntries.forEach(([channelName, rows]) => {
    rows.forEach((row) => {
      const text = normalizeSlackText(row?.text);
      const ts = String(row?.timestamp || row?.ts || "").trim();
      const userId = String(row?.userId || row?.user || "").trim();

      if (!text || !ts || !userId) {
        return;
      }

      const channelId = String(row?.channelId || channelName).trim() || channelName;
      const dedupeKey = `${channelId}:${ts}:${userId}`;
      if (seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);

      const member = memberLookup.get(userId);
      const employeeEmail = toLowerEmail(row?.employeeEmail) || member?.email || null;
      const realName =
        String(row?.realName || row?.displayName || "").trim() || member?.realName || null;
      const tsDate = normalizeSlackTsDate(ts);
      const threadTs = String(row?.threadTs || row?.thread_ts || "").trim() || null;
      const reactions = Array.isArray(row?.reactions) ? row.reactions : [];
      const externalId = `slack:message:${channelId}:${ts}`;

      messageOps.push({
        updateOne: {
          filter: { orgId: safeOrgId, messageKey: dedupeKey },
          update: {
            $setOnInsert: {
              orgId: safeOrgId,
              messageKey: dedupeKey,
              createdAt: now,
            },
            $set: {
              employeeEmail,
              channelId,
              channelName,
              ts,
              tsDate,
              text,
              userId,
              realName,
              threadTs,
              reactions,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      });

      documentOps.push({
        updateOne: {
          filter: { orgId: safeOrgId, sourceSystem: "slack", externalId },
          update: {
            $setOnInsert: {
              orgId: safeOrgId,
              documentType: "slack_message",
              sourceSystem: "slack",
              externalId,
            },
            $set: {
              ingestedAt: now,
              sensitivity: "standard",
              content: text,
              metadata: {
                channelId,
                channelName,
                ts,
                user: userId,
                employeeEmail,
                thread_ts: threadTs,
                subtype: row?.subtype || null,
                bot_id: row?.bot_id || null,
              },
              raw: {
                ...row,
                user: userId,
                ts,
                text,
                thread_ts: threadTs,
              },
            },
          },
          upsert: true,
        },
      });

      processed += 1;
    });
  });

  if (messageOps.length) {
    await mongoDb.collection("slack_messages").bulkWrite(messageOps, { ordered: false });
  }

  if (documentOps.length) {
    await mongoDb.collection("documents").bulkWrite(documentOps, { ordered: false });
  }

  return {
    mode: "mongo",
    processed,
    upserted: messageOps.length,
    documentsUpserted: documentOps.length,
  };
}

function toLowerEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function toIsoMeetingDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return new Date().toISOString().slice(0, 10);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeTranscriptArray(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (!item) {
        return null;
      }

      if (typeof item === "string") {
        const text = item.trim();
        if (!text) return null;
        const match = text.match(/^([^:]{1,60}):\s*(.+)$/);
        return {
          speaker: match?.[1]?.trim() || "Participant",
          text: match?.[2]?.trim() || text,
        };
      }

      const text = String(item.text || item.message || item.content || "").trim();
      if (!text) return null;

      return {
        speaker: String(item.speaker || item.role || item.name || "Participant"),
        text,
        timestamp: item.timestamp || item.ts || item.time || null,
      };
    })
    .filter(Boolean);
}

function normalizeParticipants(participants = []) {
  const out = [];
  const seen = new Set();

  const pushOne = (item) => {
    if (!item) return;

    if (typeof item === "string") {
      const email = toLowerEmail(item);
      if (!email) return;
      const key = `email:${email}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ email, name: email.split("@")[0], role: "Participant" });
      return;
    }

    const email = toLowerEmail(item.email || item.workEmail || item.userEmail || item.employeeEmail);
    const name = String(item.name || item.displayName || item.fullName || "").trim();
    const role = String(item.role || item.type || "Participant").trim() || "Participant";
    const identity = email ? `email:${email}` : `name:${name.toLowerCase()}`;

    if (!email && !name) return;
    if (seen.has(identity)) return;
    seen.add(identity);

    out.push({
      email: email || "",
      name: name || (email ? email.split("@")[0] : "Participant"),
      role,
    });
  };

  participants.forEach(pushOne);
  return out;
}

function collectDocumentParticipants(doc = {}) {
  return normalizeParticipants([
    ...(Array.isArray(doc?.raw?.attendees) ? doc.raw.attendees : []),
    ...(Array.isArray(doc?.raw?.participants) ? doc.raw.participants : []),
    ...(Array.isArray(doc?.metadata?.attendees) ? doc.metadata.attendees : []),
    ...(Array.isArray(doc?.metadata?.participants) ? doc.metadata.participants : []),
    doc?.raw?.organizer,
    doc?.metadata?.organizer,
  ]);
}

function collectDocumentEmails(doc = {}, participants = []) {
  const out = new Set();
  const add = (value) => {
    const email = toLowerEmail(value);
    if (email && email.includes("@")) {
      out.add(email);
    }
  };

  add(doc?.metadata?.employeeEmail);
  add(doc?.raw?.employeeEmail);
  add(doc?.metadata?.organizer?.email);
  add(doc?.raw?.organizer?.email);
  add(doc?.raw?.creator?.email);

  participants.forEach((participant) => add(participant?.email));
  return Array.from(out);
}

function extractMeetingTimeFromDocument(doc = {}) {
  const candidates = [
    doc?.metadata?.meetingAt,
    doc?.metadata?.startAt,
    doc?.metadata?.start?.dateTime,
    doc?.metadata?.start?.date,
    doc?.raw?.meetingAt,
    doc?.raw?.start?.dateTime,
    doc?.raw?.start?.date,
    doc?.raw?.date,
    doc?.ingestedAt,
    doc?.createdAt,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const text = String(candidate).trim();
    if (!text) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function extractMeetingTitleFromDocument(doc = {}) {
  const candidates = [
    doc?.metadata?.title,
    doc?.metadata?.summary,
    doc?.raw?.title,
    doc?.raw?.summary,
    doc?.content,
  ];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text) {
      return text.slice(0, 180);
    }
  }

  return "1:1 Meeting";
}

function parseTranscriptFromText(content = "") {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const match = line.match(/^([^:]{1,60}):\s*(.+)$/);
    return {
      speaker: match?.[1]?.trim() || "Participant",
      text: match?.[2]?.trim() || line,
    };
  });
}

async function loadTranscriptFromChunks(documentId) {
  if (!isMongoReady() || !documentId) {
    return [];
  }

  const chunks = await mongoDb
    .collection("document_chunks")
    .find({ documentId })
    .sort({ chunkIndex: 1 })
    .limit(400)
    .toArray();

  const lines = [];
  chunks.forEach((chunk) => {
    const parsed = parseTranscriptFromText(chunk?.text || "");
    lines.push(...parsed);
  });

  return lines;
}

function buildKeyTakeaways({ doc, transcript }) {
  const fromMeta = Array.isArray(doc?.metadata?.keyTakeaways)
    ? doc.metadata.keyTakeaways
    : Array.isArray(doc?.metadata?.key_takeaways)
      ? doc.metadata.key_takeaways
      : Array.isArray(doc?.raw?.key_takeaways)
        ? doc.raw.key_takeaways
        : [];

  if (fromMeta.length > 0) {
    return fromMeta.slice(0, 5).map((item) => String(item || "").trim()).filter(Boolean);
  }

  return transcript
    .slice(0, 3)
    .map((item) => String(item?.text || "").trim())
    .filter(Boolean)
    .map((text) => (text.length > 180 ? `${text.slice(0, 177)}...` : text));
}

async function getDatabaseMeetingSource(employeeEmail) {
  if (!isMongoReady()) {
    return null;
  }

  const targetEmail = toLowerEmail(employeeEmail);
  const docs = await mongoDb
    .collection("documents")
    .find(
      {
        documentType: {
          $in: ["meeting_transcript", "transcript", "meeting_notes", "zoom_recording_audio"],
        },
      },
      {
        projection: {
          sourceSystem: 1,
          documentType: 1,
          content: 1,
          metadata: 1,
          raw: 1,
          ingestedAt: 1,
          createdAt: 1,
        },
      }
    )
    .sort({ ingestedAt: -1, createdAt: -1 })
    .limit(150)
    .toArray();

  if (docs.length === 0) {
    return null;
  }

  const ranked = docs
    .map((doc, index) => {
      const participants = collectDocumentParticipants(doc);
      const emails = collectDocumentEmails(doc, participants);
      const transcriptHint =
        Array.isArray(doc?.raw?.transcript) ||
        Array.isArray(doc?.metadata?.transcript) ||
        (typeof doc?.content === "string" && doc.content.trim().length > 0);

      let score = 0;
      if (targetEmail) {
        if (toLowerEmail(doc?.metadata?.employeeEmail) === targetEmail) score += 120;
        if (toLowerEmail(doc?.raw?.employeeEmail) === targetEmail) score += 120;
        if (emails.includes(targetEmail)) score += 80;
      }
      if (transcriptHint) score += 20;

      return { doc, participants, emails, score, index };
    })
    .filter((item) => {
      if (!targetEmail) return true;
      return item.score > 0;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

  if (ranked.length === 0) {
    return null;
  }

  const chosen = ranked[0];
  const doc = chosen.doc;

  let transcript = normalizeTranscriptArray(doc?.raw?.transcript || doc?.metadata?.transcript || []);
  if (transcript.length === 0) {
    transcript = parseTranscriptFromText(doc?.content || "");
  }
  if (transcript.length === 0) {
    transcript = await loadTranscriptFromChunks(doc?._id);
  }

  if (transcript.length === 0) {
    return null;
  }

  const meetingAt = extractMeetingTimeFromDocument(doc);
  const attendees = chosen.participants.length
    ? chosen.participants
    : targetEmail
      ? [{ email: targetEmail, name: targetEmail.split("@")[0], role: "Participant" }]
      : [];

  return {
    meeting_brief: {
      date: toIsoMeetingDate(meetingAt),
      previous_meeting: extractMeetingTitleFromDocument(doc),
      attendees: attendees.map((item) => ({
        name: item?.name || (item?.email ? item.email.split("@")[0] : "Participant"),
        role: item?.role || "Participant",
        email: item?.email || undefined,
      })),
      key_takeaways: buildKeyTakeaways({ doc, transcript }),
    },
    transcript,
    source: "database",
    sourceSystem: doc?.sourceSystem || "unknown",
    documentType: doc?.documentType || "unknown",
    documentId: doc?._id ? String(doc._id) : "",
  };
}

function toMeetingTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortMeetingsLatestFirst(rows = []) {
  return [...rows].sort((a, b) => {
    const byMeetingAt = toMeetingTime(b?.meetingAt) - toMeetingTime(a?.meetingAt);
    if (byMeetingAt !== 0) {
      return byMeetingAt;
    }
    return toMeetingTime(b?.updatedAt) - toMeetingTime(a?.updatedAt);
  });
}

function dedupeMeetingsByEmployeeDate(rows = []) {
  const ordered = sortMeetingsLatestFirst(rows);
  const seen = new Set();
  const out = [];

  ordered.forEach((row) => {
    const email = String(row?.employeeEmail || "").toLowerCase();
    const meetingAt = String(row?.meetingAt || "");
    const key = email && meetingAt ? `${email}|${meetingAt}` : `id|${String(row?.meetingId || "")}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(row);
  });

  return out;
}

async function getEmployeeMeetingStats(employeeEmail) {
  const email = String(employeeEmail || "").toLowerCase();
  if (!email) {
    return { totalMeetings: 0, lastMeetingAt: null };
  }

  if (!isMongoReady()) {
    const rows = memory.meetings.filter((row) => String(row?.employeeEmail || "").toLowerCase() === email);
    const deduped = dedupeMeetingsByEmployeeDate(rows);
    return {
      totalMeetings: deduped.length,
      lastMeetingAt: deduped[0]?.meetingAt || null,
    };
  }

  const rows = await mongoDb
    .collection("meetings")
    .find({ employeeEmail: email })
    .sort({ meetingAt: -1, updatedAt: -1 })
    .toArray();
  const deduped = dedupeMeetingsByEmployeeDate(rows);

  return {
    totalMeetings: deduped.length,
    lastMeetingAt: deduped[0]?.meetingAt || null,
  };
}

async function listMeetings({ employeeEmail, query, limit = 20 }) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 20), 100));
  const q = String(query || "").trim().toLowerCase();

  if (!isMongoReady()) {
    let rows = sortMeetingsLatestFirst(memory.meetings);
    if (employeeEmail) {
      rows = rows.filter((row) => row.employeeEmail === String(employeeEmail).toLowerCase());
    }
    if (q) {
      rows = rows.filter((row) => {
        const text = `${row.title || ""}\n${row.summary || ""}\n${(row.transcriptLines || []).join("\n")}`.toLowerCase();
        return text.includes(q);
      });
    }
    return dedupeMeetingsByEmployeeDate(rows).slice(0, safeLimit);
  }

  const filter = {};
  if (employeeEmail) {
    filter.employeeEmail = String(employeeEmail).toLowerCase();
  }
  if (q) {
    filter.$or = [
      { title: { $regex: q, $options: "i" } },
      { summary: { $regex: q, $options: "i" } },
      { transcriptLines: { $elemMatch: { $regex: q, $options: "i" } } },
    ];
  }

  const rows = await mongoDb
    .collection("meetings")
    .find(filter)
    .sort({ meetingAt: -1, updatedAt: -1 })
    .toArray();

  return dedupeMeetingsByEmployeeDate(rows).slice(0, safeLimit);
}

async function getMeetingById(meetingId) {
  if (!meetingId) {
    return null;
  }

  if (!isMongoReady()) {
    return memory.meetings.find((item) => item.meetingId === meetingId) || null;
  }

  return mongoDb.collection("meetings").findOne({ meetingId });
}

function sanitizeFilter(input = {}) {
  const safe = {};
  const allowedRisk = ["low", "medium", "high", "critical"];

  if (typeof input.employeeEmail === "string" && input.employeeEmail.includes("@")) {
    safe.employeeEmail = input.employeeEmail.toLowerCase();
  }

  if (typeof input.riskLevel === "string" && allowedRisk.includes(input.riskLevel.toLowerCase())) {
    safe["analysis.retentionRisk.level"] = input.riskLevel.toLowerCase();
  }

  if (typeof input.minHealthScore === "number") {
    safe["analysis.health.score"] = { ...(safe["analysis.health.score"] || {}), $gte: input.minHealthScore };
  }

  if (typeof input.maxHealthScore === "number") {
    safe["analysis.health.score"] = { ...(safe["analysis.health.score"] || {}), $lte: input.maxHealthScore };
  }

  if (typeof input.keyword === "string" && input.keyword.trim()) {
    safe["analysis.searchText"] = { $regex: input.keyword.trim(), $options: "i" };
  }

  const limit = Number(input.limit || 5);
  safe.__limit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 20)) : 5;
  return safe;
}

function mapProfileForRead(profile) {
  return {
    employeeEmail: profile.employeeEmail,
    employeeName: profile.employeeName,
    version: profile.version,
    analyzedAt: profile.analyzedAt,
    analysis: profile.analysis,
    sourceStats: profile.sourceStats,
  };
}

function dedupeLatestProfiles(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = String(row?.employeeEmail || "").toLowerCase();
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, row);
    }
  });
  return Array.from(map.values());
}

async function queryProfiles(rawFilter) {
  const safeFilter = sanitizeFilter(rawFilter);
  const limit = safeFilter.__limit || 5;
  delete safeFilter.__limit;

  if (!isMongoReady()) {
    let rows = [...memory.profiles].sort((a, b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime());

    if (safeFilter.employeeEmail) {
      rows = rows.filter((item) => item.employeeEmail === safeFilter.employeeEmail);
    }

    if (safeFilter["analysis.retentionRisk.level"]) {
      rows = rows.filter(
        (item) =>
          String(item?.analysis?.retentionRisk?.level || "").toLowerCase() ===
          String(safeFilter["analysis.retentionRisk.level"])
      );
    }

    const scoreFilter = safeFilter["analysis.health.score"];
    if (scoreFilter?.$gte !== undefined) {
      rows = rows.filter((item) => Number(item?.analysis?.health?.score || 0) >= Number(scoreFilter.$gte));
    }
    if (scoreFilter?.$lte !== undefined) {
      rows = rows.filter((item) => Number(item?.analysis?.health?.score || 0) <= Number(scoreFilter.$lte));
    }

    if (safeFilter["analysis.searchText"]?.$regex) {
      const regex = new RegExp(safeFilter["analysis.searchText"].$regex, "i");
      rows = rows.filter((item) => regex.test(String(item?.analysis?.searchText || "")));
    }

    return rows.slice(0, limit).map(mapProfileForRead);
  }

  const mongoFilter = { ...safeFilter };

  if (mongoFilter["analysis.searchText"]?.$regex) {
    const rx = mongoFilter["analysis.searchText"].$regex;
    mongoFilter["analysis.searchText"] = { $regex: rx, $options: "i" };
  }

  const rows = await mongoDb
    .collection("employee_profiles")
    .find(mongoFilter)
    .sort({ analyzedAt: -1 })
    .limit(limit)
    .toArray();

  return rows.map(mapProfileForRead);
}

async function getDashboardSummary() {
  const roster = await listEmployees();
  const visibleRoster = (Array.isArray(roster) ? roster : []).filter(
    (row) => !isPlaceholderEmployeeEmail(row?.employeeEmail)
  );

  const latestRows = [];
  for (const employee of visibleRoster) {
    const latest = await getLatestProfile(String(employee?.employeeEmail || "").toLowerCase());
    if (latest) {
      latestRows.push(mapProfileForRead(latest));
    }
  }

  const visibleRows = latestRows.filter((row) => !isPlaceholderEmployeeEmail(row?.employeeEmail));

  const numericMean = (values = []) => {
    const numeric = values.filter((value) => Number.isFinite(Number(value))).map((value) => Number(value));
    if (!numeric.length) {
      return 0;
    }
    return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(2));
  };

  const todayMeetings = visibleRows
    .map((item) => item?.analysis?.brief?.meetingAt)
    .filter(Boolean)
    .slice(0, 10);

  const counts = { low: 0, medium: 0, high: 0, critical: 0 };
  visibleRows.forEach((row) => {
    const key = String(row?.analysis?.retentionRisk?.level || "low").toLowerCase();
    if (counts[key] !== undefined) {
      counts[key] += 1;
    }
  });

  const totalEmployees = visibleRoster.length;
  const atRiskEmployees = counts.high + counts.critical;
  const averageHealthScore = numericMean(visibleRows.map((row) => row?.analysis?.health?.score));
  const averageRiskScore = numericMean(visibleRows.map((row) => row?.analysis?.retentionRisk?.score));
  const averageConfidence = numericMean(visibleRows.map((row) => row?.analysis?.components?.confidence));
  const risingRiskEmployees = visibleRows.filter(
    (row) => Number(row?.analysis?.temporal?.deltaRisk30d) >= 15
  ).length;
  const fallingSentimentEmployees = visibleRows.filter(
    (row) => Number(row?.analysis?.temporal?.deltaSentiment7d) <= -20
  ).length;

  return {
    employees: visibleRows.map((row) => ({
      email: row.employeeEmail,
      name: row.employeeName,
      sentimentScore: row?.analysis?.sentiment?.score,
      healthScore: row?.analysis?.health?.score,
      riskScore: row?.analysis?.retentionRisk?.score,
      sentimentSmoothed: row?.analysis?.components?.sentimentSmoothed,
      confidence: row?.analysis?.components?.confidence,
      deltaRisk30d: row?.analysis?.temporal?.deltaRisk30d,
      deltaSentiment7d: row?.analysis?.temporal?.deltaSentiment7d,
      scoringVersion: row?.analysis?.scoringVersion,
      riskLevel: row?.analysis?.retentionRisk?.level,
      sentimentTrend: row?.analysis?.sentiment?.trend,
    })),
    totalEmployees,
    employeeCount: totalEmployees,
    atRiskEmployees,
    highRiskCount: atRiskEmployees,
    riskCounts: counts,
    meetingsThisWeek: todayMeetings.length,
    averageHealthScore,
    averageRiskScore,
    averageConfidence,
    risingRiskEmployees,
    fallingSentimentEmployees,
    todayMeetings,
    generatedAt: new Date().toISOString(),
  };
}

export {
  initMongo,
  upsertEmployeeIdentity,
  listEmployees,
  getSyncState,
  updateSyncState,
  isColdBootCompleted,
  markColdBootCompleted,
  getLatestProfile,
  getChatSession,
  listChatSessions,
  updateChatSession,
  deleteChatSession,
  createChatSession,
  appendChatMessage,
  listChatMessages,
  getNextProfileVersion,
  saveProfile,
  saveAlerts,
  saveRawDataSnapshot,
  saveSentimentHistory,
  saveRiskHistory,
  listSentimentHistory,
  listRiskHistory,
  saveMeetingRecord,
  upsertSlackMessagesBatch,
  getDatabaseMeetingSource,
  getEmployeeMeetingStats,
  listMeetings,
  getMeetingById,
  queryProfiles,
  getDashboardSummary,
  sanitizeFilter,
};
