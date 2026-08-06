import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { WebClient } from "@slack/web-api";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const llmRoot = path.resolve(__dirname, "../..");
const servicesRoot = path.resolve(llmRoot, "../..");

dotenv.config({ path: path.join(llmRoot, ".env") });
dotenv.config({ path: path.join(servicesRoot, "api-gateway", "backend", ".env") });

const targetEmails = [
  "niharmehta245@gmail.com",
  "harshdshah333@gmail.com",
  "drashtimaheswari20@gmail.com",
  "nikhilsolanki9876@gmail.com",
  "parth.srivastava660@gmail.com",
].map((email) => String(email).trim().toLowerCase());

const bambooBase = process.env.BAMBOOHR_API_BASE || "https://api.bamboohr.com/api/gateway.php";
const bambooCompany = process.env.BAMBOOHR_COMPANY || process.env.BAMBOOHR_SUBDOMAIN || "";
const bambooKey = process.env.BAMBOOHR_API_KEY || "";
const slackToken = process.env.SLACK_BOT_TOKEN || "";
const slackGeneral = process.env.SLACK_GENERAL_CHANNEL_ID || "";
const slackRandom = process.env.SLACK_RANDOM_CHANNEL_ID || "";

function ensureConfig() {
  if (!bambooCompany || !bambooKey) {
    throw new Error("Missing BambooHR credentials in services/api-gateway/backend/.env (BAMBOOHR_COMPANY/BAMBOOHR_API_KEY)");
  }
  if (!slackToken) {
    throw new Error("Missing SLACK_BOT_TOKEN in services/api-gateway/backend/.env");
  }
}

function authHeader(apiKey) {
  const token = Buffer.from(`${apiKey}:x`, "utf8").toString("base64");
  return `Basic ${token}`;
}

async function bambooRequest(endpoint, params = {}) {
  const url = new URL(`${bambooBase}/${bambooCompany}/v1/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || String(value) === "") return;
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader(bambooKey),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`BambooHR ${endpoint} failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}

async function fetchBambooEmployees() {
  const directory = await bambooRequest("employees/directory");
  const rows = Array.isArray(directory?.employees) ? directory.employees : [];

  const selected = rows.filter((row) => targetEmails.includes(String(row?.workEmail || "").toLowerCase()));

  const fields = [
    "id",
    "firstName",
    "lastName",
    "displayName",
    "workEmail",
    "jobTitle",
    "department",
    "location",
    "hireDate",
    "supervisor",
    "supervisorId",
  ].join(",");

  const detailed = [];
  for (const row of selected) {
    const details = await bambooRequest(`employees/${encodeURIComponent(row.id)}`, { fields });
    detailed.push({
      id: details?.id || row?.id || null,
      firstName: details?.firstName || row?.firstName || "",
      lastName: details?.lastName || row?.lastName || "",
      displayName: details?.displayName || row?.displayName || "",
      workEmail: String(details?.workEmail || row?.workEmail || "").toLowerCase(),
      role: details?.jobTitle || row?.jobTitle || "",
      department: details?.department || row?.department || "",
      location: details?.location || row?.location || "",
      hireDate: details?.hireDate || row?.hireDate || "",
      supervisor: details?.supervisor || row?.supervisor || "",
      supervisorId: details?.supervisorId || row?.supervisorId || null,
      source: "bamboohr",
    });
  }

  return {
    sourceSystem: "BambooHR API",
    fetchedAt: new Date().toISOString(),
    employees: detailed,
  };
}

async function getAllSlackMembers(slack) {
  let cursor;
  const members = [];

  do {
    const page = await slack.users.list({ limit: 200, cursor });
    const rows = Array.isArray(page?.members) ? page.members : [];
    members.push(...rows);
    cursor = page?.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return members;
}

function decodeSlackMentions(text, userNameById) {
  return String(text || "").replace(/<@([A-Z0-9]+)>/g, (_m, userId) => {
    return userNameById.get(userId) || `@${userId}`;
  });
}

function isSystemJoinMessage(text) {
  const normalized = String(text || "").toLowerCase().trim();
  return normalized.includes("has joined the channel");
}

function normalizeReactions(reactions = []) {
  if (!Array.isArray(reactions)) return [];
  return reactions.map((r) => ({ name: r?.name || "", count: r?.count || 0 }));
}

async function fetchChannelMessages(slack, channelId, userIds, oldestEpoch, userNameById) {
  if (!channelId) return [];
  let cursor;
  const out = [];

  do {
    const page = await slack.conversations.history({
      channel: channelId,
      oldest: String(oldestEpoch),
      limit: 200,
      cursor,
      inclusive: true,
    });

    const rows = Array.isArray(page?.messages) ? page.messages : [];
    rows.forEach((msg) => {
      if (!msg?.user) return;
      if (msg?.subtype) return;
      if (!userIds.has(msg.user)) return;
      const decoded = decodeSlackMentions(msg.text, userNameById);
      if (!decoded.trim() || isSystemJoinMessage(decoded)) return;
      out.push({
        userId: msg.user,
        text: decoded,
        timestamp: String(msg.ts || ""),
        threadTs: msg.thread_ts || null,
        reactions: normalizeReactions(msg.reactions),
      });
    });

    cursor = page?.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return out;
}

function buildMockMeetingSummaryLines(employeeName, role, department) {
  return [
    `${employeeName} discussed current workload and team priorities for the coming sprint.`,
    `HR and ${employeeName} aligned on growth expectations for the ${role || "current"} role.`,
    `An action plan was agreed with follow-up checkpoints for ${department || "the team"}.`,
  ];
}

function buildMockHrTranscript(member, employee) {
  const employeeName = member.realName || member.displayName || member.email;
  const role = employee?.role || "team role";
  const department = employee?.department || "team";

  return [
    {
      timestamp: "00:00:00",
      speaker: "HR",
      text: `Hi ${employeeName}, thanks for joining this 1:1 check-in. We want to review your current experience in ${department}.`,
    },
    {
      timestamp: "00:00:20",
      speaker: employeeName,
      text: `Thanks. Overall things are going well, but I want clearer weekly priorities for my ${role} responsibilities.`,
    },
    {
      timestamp: "00:00:45",
      speaker: "HR",
      text: "That makes sense. Are there any blockers or support areas we should address immediately?",
    },
    {
      timestamp: "00:01:10",
      speaker: employeeName,
      text: "A structured planning sync and clearer ownership boundaries would help reduce confusion.",
    },
    {
      timestamp: "00:01:35",
      speaker: "HR",
      text: "Noted. We will capture action items, align with your manager, and set a follow-up date.",
    },
    {
      timestamp: "00:01:55",
      speaker: employeeName,
      text: "That sounds good. I appreciate the support and follow-up plan.",
    },
  ];
}

async function fetchSlackData(bambooEmployees = []) {
  const slack = new WebClient(slackToken);
  const bambooNameByEmail = new Map(
    (Array.isArray(bambooEmployees) ? bambooEmployees : []).map((row) => [
      String(row?.workEmail || row?.email || "").trim().toLowerCase(),
      row?.displayName || [row?.firstName, row?.lastName].filter(Boolean).join(" ") || "",
    ])
  );
  const allMembers = await getAllSlackMembers(slack);
  const selectedMembers = allMembers
    .filter((m) => targetEmails.includes(String(m?.profile?.email || "").trim().toLowerCase()))
    .map((m) => {
      const email = String(m?.profile?.email || "").trim().toLowerCase();
      const bambooName = bambooNameByEmail.get(email);
      const slackName = m.profile?.real_name || m.real_name || m.name || "";
      const normalizedName = bambooName || slackName;

      return {
      userId: m.id,
      name: m.name || "",
        realName: normalizedName,
        displayName: normalizedName,
        email,
      profileImage: m.profile?.image_192 || null,
      };
    });

  const userNameById = new Map(
    allMembers.map((m) => {
      const email = String(m?.profile?.email || "").trim().toLowerCase();
      const bambooName = bambooNameByEmail.get(email);
      return [m.id, bambooName || m.profile?.real_name || m.real_name || m.name || `@${m.id}`];
    })
  );

  const memberMap = new Map(selectedMembers.map((m) => [m.userId, m]));
  const userIds = new Set(selectedMembers.map((m) => m.userId));
  const oldest = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;

  const generalMessages = await fetchChannelMessages(slack, slackGeneral, userIds, oldest, userNameById);
  const randomMessages = await fetchChannelMessages(slack, slackRandom, userIds, oldest, userNameById);

  const enrich = (rows) =>
    rows.map((row) => ({
      ...row,
      realName: memberMap.get(row.userId)?.realName || "Unknown",
    }));

  const general = enrich(generalMessages);
  const random = enrich(randomMessages);
  const hrDiscussions = [...general, ...random].sort(
    (a, b) => Number(String(a.timestamp || "0").split(".")[0]) - Number(String(b.timestamp || "0").split(".")[0])
  );

  const byMember = {};
  hrDiscussions.forEach((m) => {
    byMember[m.realName] = (byMember[m.realName] || 0) + 1;
  });

  const meetings = selectedMembers.map((member) => {
    const employee = (Array.isArray(bambooEmployees) ? bambooEmployees : []).find(
      (row) => String(row?.workEmail || row?.email || "").trim().toLowerCase() === member.email
    );
    const transcript = buildMockHrTranscript(member, employee);
    const summaryLines = buildMockMeetingSummaryLines(
      member.realName || member.displayName || member.email,
      employee?.role || "",
      employee?.department || ""
    );
    return {
      meetingId: `${member.email}:latest`,
      employeeEmail: member.email,
      meeting_brief: {
        previous_meeting: "HR and Engagement Review",
        date: new Date().toISOString().slice(0, 10),
        meeting_objective: "Conduct a structured HR check-in and capture actions for growth and wellbeing.",
        attendees: [
          { name: "HR", role: "HR" },
          { name: member.realName || member.displayName || member.email, role: "Employee" },
        ],
        key_takeaways: summaryLines,
      },
      transcript,
    };
  });

  return {
    slackPayload: {
      general,
      random,
      hr_discussions: hrDiscussions,
      members: selectedMembers,
      summary: {
        totalMessages: hrDiscussions.length,
        messagesByMember: byMember,
        mostActiveChannel: general.length >= random.length ? "general" : "random",
        fetchedAt: new Date().toISOString(),
      },
    },
    meetingsPayload: {
      sourceSystem: "Mock HR meeting transcript seeds",
      fetchedAt: new Date().toISOString(),
      meetings,
    },
  };
}

async function main() {
  ensureConfig();

  const bambooPayload = await fetchBambooEmployees();
  const slackData = await fetchSlackData(bambooPayload?.employees || []);

  const outputDir = path.join(llmRoot, "mock_data");
  await fs.mkdir(outputDir, { recursive: true });

  await fs.writeFile(path.join(outputDir, "bamboohr_data.json"), JSON.stringify(bambooPayload, null, 2), "utf-8");
  await fs.writeFile(path.join(outputDir, "hr_slack_simulation.json"), JSON.stringify(slackData.slackPayload, null, 2), "utf-8");
  await fs.writeFile(path.join(outputDir, "meeting_transcript.json"), JSON.stringify(slackData.meetingsPayload, null, 2), "utf-8");

  const foundEmails = bambooPayload.employees.map((e) => e.workEmail);
  console.log(`Fetched Bamboo employees: ${foundEmails.length}`);
  console.log(`Fetched Slack members: ${slackData.slackPayload.members.length}`);
  console.log(`Wrote llm/mock_data for target emails.`);
  console.log(`Bamboo emails found: ${foundEmails.join(", ") || "none"}`);
}

main().catch((error) => {
  console.error("fetchSelectedSources failed:", error.message);
  process.exit(1);
});
