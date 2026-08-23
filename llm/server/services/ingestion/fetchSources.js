import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { WebClient } from "@slack/web-api";
import { getDatabaseMeetingSource, upsertSlackMessagesBatch } from "../storage/stores.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let backendEnvCache = null;
let legacyMockPurged = false;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function getBackendEnv() {
  if (backendEnvCache) {
    return backendEnvCache;
  }

  const backendEnvPath = path.resolve(__dirname, "../../../../backend/.env");
  if (!fs.existsSync(backendEnvPath)) {
    backendEnvCache = {};
    return backendEnvCache;
  }

  const raw = fs.readFileSync(backendEnvPath, "utf-8");
  backendEnvCache = dotenv.parse(raw);
  return backendEnvCache;
}

function getConfigValue(key, fallback = "") {
  const direct = process.env[key];
  if (direct !== undefined && String(direct).trim() !== "") {
    return String(direct);
  }

  const backendEnv = getBackendEnv();
  const inherited = backendEnv[key];
  if (inherited !== undefined && String(inherited).trim() !== "") {
    return String(inherited);
  }

  return fallback;
}

function clampInt(value, { min, max, fallback }) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(parsed, max));
}

function getSlackSourceMode() {
  return String(getConfigValue("SLACK_SOURCE_MODE", "auto")).trim().toLowerCase();
}

function getSlackChannelIds() {
  const fromList = String(getConfigValue("SLACK_CHANNEL_IDS", ""))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const configured = [
    String(getConfigValue("SLACK_GENERAL_CHANNEL_ID", "")).trim(),
    String(getConfigValue("SLACK_RANDOM_CHANNEL_ID", "")).trim(),
    ...fromList,
  ].filter(Boolean);

  return Array.from(new Set(configured));
}

function decodeSlackMentions(text, userNameById) {
  return String(text || "").replace(/<@([A-Z0-9]+)>/g, (_match, userId) => {
    return userNameById.get(userId) || `@${userId}`;
  });
}

function normalizeSlackReactions(reactions = []) {
  if (!Array.isArray(reactions)) {
    return [];
  }

  return reactions.map((item) => ({
    name: String(item?.name || ""),
    count: Number(item?.count || 0),
  }));
}

async function getAllSlackMembers(slackClient) {
  const out = [];
  let cursor;
  let pages = 0;
  const maxPages = clampInt(getConfigValue("SLACK_USERS_MAX_PAGES", "20"), {
    min: 1,
    max: 100,
    fallback: 20,
  });

  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await slackClient.users.list({ limit: 200, cursor });
    const members = Array.isArray(page?.members) ? page.members : [];
    out.push(...members);
    cursor = page?.response_metadata?.next_cursor || undefined;
    pages += 1;
  } while (cursor && pages < maxPages);

  return out;
}

function normalizeSlackMember(member = {}) {
  const email = String(member?.profile?.email || "").trim().toLowerCase();
  return {
    userId: String(member?.id || "").trim(),
    name: String(member?.name || "").trim(),
    realName: String(member?.profile?.real_name || member?.real_name || member?.name || "").trim(),
    displayName: String(member?.profile?.display_name || member?.profile?.real_name || member?.name || "").trim(),
    email,
    profileImage: member?.profile?.image_192 || null,
  };
}

function resolveSlackChannelKey(channelId) {
  const general = String(getConfigValue("SLACK_GENERAL_CHANNEL_ID", "")).trim();
  const random = String(getConfigValue("SLACK_RANDOM_CHANNEL_ID", "")).trim();

  if (general && channelId === general) {
    return "general";
  }
  if (random && channelId === random) {
    return "random";
  }
  return channelId;
}

async function fetchSlackLive({ employeeEmail = null, slackCursor = 0 } = {}) {
  const token = String(getConfigValue("SLACK_BOT_TOKEN", "")).trim();
  const channelIds = getSlackChannelIds();
  if (!token || channelIds.length === 0) {
    return null;
  }

  const daysBack = clampInt(getConfigValue("SLACK_HISTORY_DAYS", "120"), {
    min: 1,
    max: 3650,
    fallback: 120,
  });
  const maxPagesPerChannel = clampInt(getConfigValue("SLACK_HISTORY_MAX_PAGES", "25"), {
    min: 1,
    max: 200,
    fallback: 25,
  });

  const nowEpoch = Math.floor(Date.now() / 1000);
  const oldestByDays = nowEpoch - daysBack * 24 * 60 * 60;
  const oldestByCursor = Number(slackCursor || 0) > 0 ? Number(slackCursor || 0) - 1 : 0;
  const oldestEpoch = Math.max(oldestByDays, oldestByCursor);

  const slackClient = new WebClient(token, { timeout: 20000 });
  const membersRaw = await getAllSlackMembers(slackClient);
  const members = membersRaw
    .filter((member) => !member?.deleted && !member?.is_bot && String(member?.id || "") !== "USLACKBOT")
    .map((member) => normalizeSlackMember(member))
    .filter((member) => member.userId);

  const normalizedTargetEmail = String(employeeEmail || "").trim().toLowerCase();
  const selectedMembers = normalizedTargetEmail
    ? members.filter((member) => member.email === normalizedTargetEmail)
    : members.filter((member) => member.email);

  if (normalizedTargetEmail && selectedMembers.length === 0) {
    return createEmptySlackPayload();
  }

  const allowedUserIds = new Set(selectedMembers.map((member) => member.userId));
  const memberByUserId = new Map(selectedMembers.map((member) => [member.userId, member]));
  const userNameById = new Map(members.map((member) => [member.userId, member.realName || member.displayName || member.name || `@${member.userId}`]));

  const channelBuckets = {};
  const dedupe = new Set();

  for (const channelId of channelIds) {
    let cursor;
    let page = 0;
    const key = resolveSlackChannelKey(channelId);
    if (!Array.isArray(channelBuckets[key])) {
      channelBuckets[key] = [];
    }

    while (page < maxPagesPerChannel) {
      // eslint-disable-next-line no-await-in-loop
      const response = await slackClient.conversations.history({
        channel: channelId,
        limit: 200,
        oldest: String(oldestEpoch),
        cursor,
        inclusive: false,
      });

      const rows = Array.isArray(response?.messages) ? response.messages : [];
      rows.forEach((row) => {
        const userId = String(row?.user || "").trim();
        const ts = String(row?.ts || "").trim();
        const textRaw = decodeSlackMentions(row?.text, userNameById).trim();
        if (!userId || !ts || !textRaw) {
          return;
        }

        if (row?.bot_id || row?.subtype) {
          return;
        }

        if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
          return;
        }

        const dedupeKey = `${channelId}:${ts}:${userId}`;
        if (dedupe.has(dedupeKey)) {
          return;
        }
        dedupe.add(dedupeKey);

        const member = memberByUserId.get(userId) || null;
        channelBuckets[key].push({
          userId,
          text: textRaw,
          timestamp: ts,
          threadTs: row?.thread_ts || null,
          reactions: normalizeSlackReactions(row?.reactions),
          realName: member?.realName || userNameById.get(userId) || "Unknown",
          employeeEmail: member?.email || null,
          channelId,
          channelName: key,
        });
      });

      cursor = response?.response_metadata?.next_cursor || undefined;
      page += 1;
      if (!cursor) {
        break;
      }
    }
  }

  const hrDiscussions = Object.values(channelBuckets)
    .filter((value) => Array.isArray(value))
    .flat()
    .sort((a, b) => toNumericTs(a.timestamp) - toNumericTs(b.timestamp));

  const messagesByMember = {};
  hrDiscussions.forEach((item) => {
    const key = String(item?.realName || "Unknown");
    messagesByMember[key] = Number(messagesByMember[key] || 0) + 1;
  });

  return {
    ...channelBuckets,
    hr_discussions: hrDiscussions,
    members: selectedMembers,
    summary: {
      totalMessages: hrDiscussions.length,
      messagesByMember,
      mostActiveChannel: Object.entries(channelBuckets)
        .map(([name, value]) => ({ name, count: Array.isArray(value) ? value.length : 0 }))
        .sort((a, b) => b.count - a.count)[0]?.name || null,
      fetchedAt: new Date().toISOString(),
      sourceSystem: "slack_api",
    },
  };
}

function createEmptySlackPayload() {
  return {
    members: [],
    hr_discussions: [],
    summary: {
      totalMessages: 0,
      messagesByMember: {},
      mostActiveChannel: null,
      fetchedAt: new Date().toISOString(),
      sourceSystem: "slack_api",
    },
  };
}

function normalizeBambooDirectoryEmployee(row = {}) {
  return {
    id: row?.id || row?.employeeId || null,
    firstName: row?.firstName || "",
    lastName: row?.lastName || "",
    displayName:
      row?.displayName ||
      [row?.firstName, row?.lastName].filter(Boolean).join(" ") ||
      "Unknown",
    workEmail: row?.workEmail || row?.email || "",
    role: row?.role || row?.title || row?.jobTitle || "",
    department: row?.department || "",
    location: row?.location || "",
    hireDate: row?.hireDate || "",
    supervisor: row?.supervisor || row?.managerName || "",
    supervisorId: row?.supervisorId || null,
    source: "bamboohr",
  };
}

async function fetchBambooHrDirectoryFromApi() {
  const endpoint =
    String(process.env.BAMBOOHR_DIRECTORY_URL || "").trim() ||
    "http://localhost:4000/api/bamboohr/employees/directory";

  const timeoutRaw = Number.parseInt(String(process.env.BAMBOOHR_FETCH_TIMEOUT_MS || "10000"), 10);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 1000 ? Math.min(timeoutRaw, 30000) : 10000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`BambooHR directory request failed (${response.status})`);
    }

    const payload = await response.json();
    const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    const rows = Array.isArray(data?.employees) ? data.employees : [];

    if (!rows.length) {
      return null;
    }

    return {
      sourceSystem: data?.sourceSystem || "BambooHR API",
      fetchedAt: data?.fetchedAt || new Date().toISOString(),
      employees: rows.map((row) => normalizeBambooDirectoryEmployee(row)),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toNumericTs(value, fallback = 0) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).split(".")[0];
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mergeInjectedSlackEvent(payload, event = null) {
  if (!event?.text) {
    return payload;
  }

  const copy = JSON.parse(JSON.stringify(payload));
  if (!Array.isArray(copy.hr_discussions)) {
    copy.hr_discussions = [];
  }

  const nowTs = event.timestamp ? toNumericTs(event.timestamp) : Math.floor(Date.now() / 1000);
  copy.hr_discussions.push({
    userId: event.userId || "U_WEBHOOK",
    realName: event.realName || "Webhook User",
    text: String(event.text),
    timestamp: `${nowTs}.000000`,
    threadTs: null,
    reactions: [],
  });

  return copy;
}

async function fetchSlackMock(dataRoot, employeeEmail) {
  const payload = readJson(path.join(dataRoot, "hr_slack_simulation.json"));
  if (!employeeEmail) {
    return payload;
  }

  const member = Array.isArray(payload?.members)
    ? payload.members.find((item) => String(item.email || "").toLowerCase() === String(employeeEmail).toLowerCase())
    : null;

  if (!member) {
    return createEmptySlackPayload();
  }

  const copy = { ...payload };
  Object.keys(copy).forEach((key) => {
    if (!Array.isArray(copy[key])) {
      return;
    }
    copy[key] = copy[key].filter((item) => {
      if (item.userId === member.userId || item.realName === member.realName) {
        return true;
      }
      return String(item.text || "").toLowerCase().includes(member.realName.toLowerCase());
    });
  });
  return copy;
}

async function fetchSlackData({ dataRoot, employeeEmail, slackCursor = 0 }) {
  const mode = getSlackSourceMode();

  if (mode !== "mock") {
    try {
      const live = await fetchSlackLive({ employeeEmail, slackCursor });
      if (live) {
        await upsertSlackMessagesBatch({
          payload: live,
          orgId: String(getConfigValue("DEFAULT_ORG_ID", "demo")).trim() || "demo",
          purgeLegacyMock: !legacyMockPurged,
        });
        legacyMockPurged = true;
        return live;
      }
    } catch {
      if (mode === "live") {
        return createEmptySlackPayload();
      }
    }
  }

  return fetchSlackMock(dataRoot, employeeEmail);
}

async function fetchMeetTranscriptMock(dataRoot) {
  return readJson(path.join(dataRoot, "meeting_transcript.json"));
}

function selectMeetingForEmployee(meet, employeeEmail) {
  if (!Array.isArray(meet?.meetings)) {
    return meet;
  }

  const targetEmail = String(employeeEmail || "").toLowerCase();
  const chosen = targetEmail
    ? meet.meetings.find((row) => String(row?.employeeEmail || "").toLowerCase() === targetEmail)
    : meet.meetings[0];

  return chosen || { transcript: [] };
}

async function resolveMeetingSource({ meet, employeeEmail }) {
  const fallbackMeet = selectMeetingForEmployee(meet, employeeEmail) || { transcript: [] };
  try {
    const dbMeet = await getDatabaseMeetingSource(employeeEmail);
    if (Array.isArray(dbMeet?.transcript) && dbMeet.transcript.length > 0) {
      return dbMeet;
    }
  } catch {
    // Fall back to current source if database transcript bridge is unavailable.
  }

  return fallbackMeet;
}

async function fetchBambooHrMock(dataRoot, employeeEmail) {
  const payload =
    (await fetchBambooHrDirectoryFromApi()) || readJson(path.join(dataRoot, "bamboohr_data.json"));
  const targetEmail = String(employeeEmail || "").toLowerCase();

  // New format: { employees: [...] }
  if (Array.isArray(payload?.employees)) {
    if (!targetEmail) {
      return payload;
    }

    const selected = payload.employees.find(
      (row) => String(row?.workEmail || row?.email || "").toLowerCase() === targetEmail
    );

    if (!selected) {
      return payload;
    }

    return {
      ...payload,
      employee: {
        id: selected.id || selected.employeeId || null,
        firstName: selected.firstName || "",
        lastName: selected.lastName || "",
        displayName:
          selected.displayName ||
          [selected.firstName, selected.lastName].filter(Boolean).join(" ") ||
          "Unknown",
        workEmail: selected.workEmail || selected.email || "",
        location: selected.location || "",
      },
      job: {
        title: selected.role || selected.title || selected.jobTitle || "",
        department: selected.department || "",
        hireDate: selected.hireDate || "",
        reportsTo: {
          id: selected.supervisorId || null,
          name: selected.supervisor || selected.managerName || "",
          title: "",
        },
      },
      performance: selected.performance || {},
      timeOff: selected.timeOff || {},
      compensation: selected.compensation || {},
    };
  }

  if (!employeeEmail) {
    return payload;
  }
  const email = String(payload?.employee?.workEmail || "").toLowerCase();
  if (email && email === String(employeeEmail).toLowerCase()) {
    return payload;
  }
  return payload;
}

async function fetchAllSourcesParallel({ dataRoot, employeeEmail }) {
  const [slack, meet, hrms] = await Promise.all([
    fetchSlackData({ dataRoot, employeeEmail }),
    fetchMeetTranscriptMock(dataRoot),
    fetchBambooHrMock(dataRoot, employeeEmail),
  ]);

  const selectedMeet = await resolveMeetingSource({ meet, employeeEmail });

  return {
    slack,
    meet: selectedMeet,
    hrms,
    fetchedAt: new Date().toISOString(),
  };
}

function applySlackDelta(slack, slackCursor, historicalMode) {
  const cursor = Number(slackCursor || 0);
  const output = JSON.parse(JSON.stringify(slack || {}));
  let maxTs = cursor;

  Object.keys(output).forEach((channel) => {
    if (channel === "members" || channel === "summary") {
      return;
    }

    if (!Array.isArray(output[channel])) {
      return;
    }

    const sorted = output[channel]
      .slice()
      .sort((a, b) => toNumericTs(a.timestamp || a.ts) - toNumericTs(b.timestamp || b.ts));
    const seen = new Set();
    output[channel] = sorted.filter((item) => {
      const ts = toNumericTs(item.timestamp || item.ts);
      const dedupeKey = `${ts}:${String(item?.userId || item?.user || "").trim()}:${String(item?.text || "").trim()}`;
      if (seen.has(dedupeKey)) {
        return false;
      }
      seen.add(dedupeKey);

      if (ts > maxTs) {
        maxTs = ts;
      }
      return historicalMode ? true : ts > cursor;
    });
  });

  return { data: output, nextCursor: maxTs };
}

function applyMeetingDelta(meet, meetingCursor, historicalMode) {
  const cursor = Number(meetingCursor || 0);
  const transcript = Array.isArray(meet?.transcript) ? meet.transcript : [];
  const enriched = transcript.map((item, index) => ({ ...item, __index: index + 1 }));

  const filtered = historicalMode
    ? enriched
    : enriched.filter((item) => Number(item.__index) > cursor);

  const nextCursor = Math.max(cursor, transcript.length);
  const out = {
    ...meet,
    transcript: filtered.map(({ __index, ...rest }) => rest),
  };

  return { data: out, nextCursor };
}

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

function extractIdentityCandidates({ hrms, slack }) {
  const candidates = [];

  const slackEmails = new Set(
    Array.isArray(slack?.members)
      ? slack.members
          .map((member) => String(member?.email || "").toLowerCase())
          .filter(Boolean)
      : []
  );

  const employeeRows = Array.isArray(hrms?.employees)
    ? hrms.employees
    : hrms?.employee
      ? [
          {
            ...hrms.employee,
            role: hrms?.job?.title,
            department: hrms?.job?.department,
          },
        ]
      : [];

  employeeRows.forEach((row) => {
    const employeeEmail = String(row?.workEmail || row?.email || "").toLowerCase();
    if (isPlaceholderEmployeeEmail(employeeEmail)) {
      return;
    }

    candidates.push({
      employeeEmail,
      employeeId: row?.id || null,
      displayName:
        row?.displayName ||
        row?.fullName ||
        row?.name ||
        [row?.firstName, row?.lastName].join(" ") ||
        "Unknown",
      role: row?.role || row?.title || row?.jobTitle || "Unknown",
      department: row?.department || row?.dept || "Unknown",
      source: "bamboohr",
      hasSlackMember: slackEmails.has(employeeEmail),
    });
  });

  return candidates;
}

async function fetchAllSourcesParallelWithDelta({
  dataRoot,
  employeeEmail,
  cursors = {},
  historicalMode = false,
  injectedSlackEvent = null,
}) {
  const [slack, meet, hrms] = await Promise.all([
    fetchSlackData({ dataRoot, employeeEmail, slackCursor: cursors.slackCursor }),
    fetchMeetTranscriptMock(dataRoot),
    fetchBambooHrMock(dataRoot, employeeEmail),
  ]);

  const selectedMeet = await resolveMeetingSource({ meet, employeeEmail });

  const mergedSlack = mergeInjectedSlackEvent(slack, injectedSlackEvent);
  const slackDelta = applySlackDelta(mergedSlack, cursors.slackCursor, historicalMode);
  const meetDelta = applyMeetingDelta(selectedMeet, cursors.meetingCursor, historicalMode);

  const identityCandidates = extractIdentityCandidates({ hrms, slack: mergedSlack });

  return {
    slack: slackDelta.data,
    meet: meetDelta.data,
    hrms,
    cursors: {
      slackCursor: slackDelta.nextCursor,
      meetingCursor: meetDelta.nextCursor,
    },
    identityCandidates,
    historicalMode,
    fetchedAt: new Date().toISOString(),
  };
}

async function listBambooHrIdentityCandidates({ dataRoot }) {
  const [slack, hrms] = await Promise.all([
    fetchSlackData({ dataRoot, employeeEmail: null }),
    fetchBambooHrMock(dataRoot),
  ]);

  return extractIdentityCandidates({ hrms, slack });
}

export {
  fetchAllSourcesParallel,
  fetchAllSourcesParallelWithDelta,
  extractIdentityCandidates,
  fetchSlackLive,
  listBambooHrIdentityCandidates,
};
