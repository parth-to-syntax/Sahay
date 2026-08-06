import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { env } from "./config/env.js";
import {
  initMongo,
  queryProfiles,
  getLatestProfile,
  getDashboardSummary,
  sanitizeFilter,
  listMeetings,
  getMeetingById,
  listEmployees,
  getEmployeeMeetingStats,
  getSyncState,
  getDatabaseMeetingSource,
  upsertEmployeeIdentity,
  listSentimentHistory,
  listRiskHistory,
  getChatSession,
  listChatSessions,
  updateChatSession,
  deleteChatSession,
  createChatSession,
  appendChatMessage,
  listChatMessages,
} from "./services/storage/stores.js";
import { initCache, getJson, warmDashboardCache } from "./services/cache/cacheService.js";
import {
  startPipelineQueues,
  enqueuePipelineRun,
  enqueueDebouncedSlackReanalysis,
  runColdStartBootstrap,
} from "./queues/pipelineQueue.js";
import {
  intentExtractorService,
  chatAssistantService,
} from "./services/analysis/groqServices.js";
import { initGroqDispatcher, getGroqDispatcherInfo } from "./services/analysis/groqDispatcher.js";
import {
  fetchAllSourcesParallelWithDelta,
  listBambooHrIdentityCandidates,
} from "./services/ingestion/fetchSources.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const runPipelineSchema = z.object({
  employeeEmail: z.string().email(),
  reason: z.string().optional(),
  meetingAt: z.string().optional(),
});

const slackWebhookSchema = z.object({
  employeeEmail: z.string().email(),
  message: z.string().default(""),
  timestamp: z.string().optional(),
});

const chatSchema = z.object({
  query: z.string().min(3),
  stream: z.boolean().optional().default(false),
  sessionId: z.string().min(3).max(120).optional(),
});

const createChatSessionSchema = z.object({
  sessionId: z.string().min(3).max(120).optional(),
  status: z.enum(["active", "archived"]).optional(),
  title: z.string().min(1).max(160).optional(),
  userId: z.string().min(1).max(120).optional(),
});

const updateChatSessionSchema = z.object({
  status: z.enum(["active", "archived"]).optional(),
  title: z.string().max(160).optional(),
  userId: z.string().max(120).optional(),
});

const bootstrapSchema = z.object({
  force: z.boolean().optional().default(false),
});

const upcomingBriefSchema = z.object({
  employeeEmail: z.string().email(),
  meetingAt: z.string().optional(),
  participantEmails: z.array(z.string().email()).optional(),
});

const sourceCheckSchema = z.object({
  employeeEmail: z.string().email(),
  historicalMode: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (typeof value === "boolean") return value;
      const normalized = String(value || "").trim().toLowerCase();
      return ["1", "true", "yes", "y", "on"].includes(normalized);
    }),
});

function dedupeProfilesByEmployee(rows = []) {
  const byEmail = new Map();
  rows.forEach((row) => {
    const email = String(row?.employeeEmail || "").toLowerCase();
    if (!email) return;
    if (!byEmail.has(email)) {
      byEmail.set(email, row);
    }
  });
  return Array.from(byEmail.values());
}

const syncBambooHrSchema = z.object({
  reason: z.string().optional(),
  runPipeline: z.boolean().optional().default(false),
  continueOnError: z.boolean().optional().default(true),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  employeeEmails: z.array(z.string().email()).optional(),
});

function normalizeEmailList(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => value.includes("@"))
    )
  );
}

function toSessionTitle(value, maxLength = 80) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "New Chat";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function toTimestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildPastMeetingInsights(rows = [], meetingAt) {
  const upcomingAt = toTimestamp(meetingAt) || Date.now() + 2 * 60 * 60 * 1000;
  const sorted = rows
    .slice()
    .sort((a, b) => toTimestamp(b?.meetingAt || b?.updatedAt) - toTimestamp(a?.meetingAt || a?.updatedAt));

  const past = sorted.filter((row) => {
    const at = toTimestamp(row?.meetingAt || row?.updatedAt);
    return at > 0 && at <= upcomingAt;
  });

  const recentMeetings = past.slice(0, 3).map((row) => ({
    meetingId: row?.meetingId || "",
    meetingAt: row?.meetingAt || row?.updatedAt || null,
    title: row?.title || "1:1 Meeting",
    summary: row?.summary || "",
  }));

  return {
    totalPastMeetings: past.length,
    lastMeetingAt: past[0]?.meetingAt || past[0]?.updatedAt || null,
    recentMeetings,
  };
}

function inferHttpStatusFromError(error) {
  const direct = Number(error?.statusCode || error?.status || error?.response?.status);
  if (Number.isFinite(direct) && direct >= 400 && direct <= 599) {
    return direct;
  }

  const message = String(error?.message || "");
  const match = message.match(/\b(4\d\d|5\d\d)\b/);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (/rate[_ -]?limit|too many requests|rate limit/i.test(message)) {
    return 429;
  }

  return 400;
}

async function buildParticipantBriefInsight({ employeeEmail, meetingAt }) {
  const email = String(employeeEmail || "").trim().toLowerCase();
  if (!email) {
    return null;
  }

  const run = await enqueuePipelineRun({
    employeeEmail: email,
    reason: "upcoming-brief",
    dataRoot: env.DATA_ROOT,
    model: env.GROQ_MODEL,
    meetingAt: meetingAt || null,
  });

  const [latest, meetings] = await Promise.all([
    getLatestProfile(email),
    listMeetings({ employeeEmail: email, limit: 30 }),
  ]);

  const pastMeetingInsights = buildPastMeetingInsights(meetings, meetingAt);

  if (!latest) {
    return {
      employeeEmail: email,
      status: "queued",
      jobId: run.id,
      brief: null,
      relationshipStatus: null,
      profileAnalysis: null,
      pastMeetingInsights,
    };
  }

  const analysis = latest.analysis || {};
  return {
    employeeEmail: email,
    status: "ready",
    jobId: run.id,
    brief: analysis.brief || null,
    relationshipStatus: analysis.relationshipStatus || analysis?.brief?.relationshipStatus || null,
    profileAnalysis: {
      healthScore: Number(analysis?.health?.score || 0),
      healthBand: analysis?.health?.band || "",
      sentimentScore: Number(analysis?.sentiment?.score || 0),
      sentimentTrend: analysis?.sentiment?.trend || "",
      riskLevel: analysis?.retentionRisk?.level || "",
      riskScore: Number(analysis?.retentionRisk?.score || 0),
    },
    pastMeetingInsights,
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "chro-ai-orchestrator",
    at: new Date().toISOString(),
    groqDispatcher: getGroqDispatcherInfo(),
  });
});

app.get("/ingestion/source-check", async (req, res) => {
  try {
    const parsed = sourceCheckSchema.parse(req.query || {});
    const employeeEmail = String(parsed.employeeEmail || "").toLowerCase();
    const historicalMode = Boolean(parsed.historicalMode);

    const cursorsBefore = await getSyncState(employeeEmail);
    const databaseCandidate = await getDatabaseMeetingSource(employeeEmail);
    const sources = await fetchAllSourcesParallelWithDelta({
      dataRoot: env.DATA_ROOT,
      employeeEmail,
      cursors: cursorsBefore,
      historicalMode,
      injectedSlackEvent: null,
    });

    const meet = sources?.meet || {};
    const transcript = Array.isArray(meet?.transcript) ? meet.transcript : [];
    const slackCount = Object.values(sources?.slack || {}).reduce((total, value) => {
      if (!Array.isArray(value)) return total;
      return (
        total +
        value.reduce((count, item) => {
          return String(item?.text || "").trim() ? count + 1 : count;
        }, 0)
      );
    }, 0);

    return res.json({
      ok: true,
      data: {
        employeeEmail,
        historicalMode,
        dataRoot: env.DATA_ROOT,
        source: {
          type: meet?.source || "fallback",
          sourceSystem: meet?.sourceSystem || "mock",
          documentType: meet?.documentType || null,
          documentId: meet?.documentId || null,
        },
        databaseCandidate: {
          found: Boolean(databaseCandidate),
          sourceSystem: databaseCandidate?.sourceSystem || null,
          documentType: databaseCandidate?.documentType || null,
          documentId: databaseCandidate?.documentId || null,
          transcriptCount: Array.isArray(databaseCandidate?.transcript) ? databaseCandidate.transcript.length : 0,
        },
        transcript: {
          count: transcript.length,
          sample: transcript.slice(0, 2),
        },
        deltas: {
          slackMessages: slackCount,
          meetingTurns: transcript.length,
        },
        cursors: {
          before: cursorsBefore,
          after: sources?.cursors || {},
        },
        fetchedAt: sources?.fetchedAt || new Date().toISOString(),
      },
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "source check failed" });
  }
});

app.get("/employees", async (_req, res) => {
  try {
    const rows = await listEmployees();
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const stats = await getEmployeeMeetingStats(row.employeeEmail);
        return {
          ...row,
          totalMeetings: stats.totalMeetings,
          lastMeetingAt: stats.lastMeetingAt || row.lastMeetingAt || row.updatedAt || null,
        };
      })
    );
    return res.json({ count: enriched.length, data: enriched });
  } catch (error) {
    return res.status(500).json({ error: error.message || "failed to list employees" });
  }
});

app.post("/bootstrap/init", async (req, res) => {
  try {
    bootstrapSchema.parse(req.body || {});
    const output = await runColdStartBootstrap({
      dataRoot: env.DATA_ROOT,
      model: env.GROQ_MODEL,
    });
    return res.status(202).json(output);
  } catch (error) {
    return res.status(400).json({ error: error.message || "bootstrap failed" });
  }
});

app.post("/pipeline/run", async (req, res) => {
  try {
    const parsed = runPipelineSchema.parse(req.body || {});
    const job = await enqueuePipelineRun({
      employeeEmail: parsed.employeeEmail,
      reason: parsed.reason || "manual",
      dataRoot: env.DATA_ROOT,
      model: env.GROQ_MODEL,
      meetingAt: parsed.meetingAt || null,
    });
    res.status(202).json({ accepted: true, jobId: job.id });
  } catch (error) {
    const status = inferHttpStatusFromError(error);
    res.status(status).json({
      error: {
        message: error?.message || "invalid request",
        code: status === 429 ? "UPSTREAM_RATE_LIMIT" : "PIPELINE_RUN_FAILED",
      },
    });
  }
});

app.post("/pipeline/sync-bamboohr", async (req, res) => {
  try {
    const parsed = syncBambooHrSchema.parse(req.body || {});
    const reason = parsed.reason || "bamboohr-sync-all";
    const filterSet = new Set(normalizeEmailList(parsed.employeeEmails || []));

    const allCandidates = await listBambooHrIdentityCandidates({ dataRoot: env.DATA_ROOT });
    let candidates = Array.isArray(allCandidates) ? allCandidates : [];

    if (filterSet.size > 0) {
      candidates = candidates.filter((row) => filterSet.has(String(row?.employeeEmail || "").toLowerCase()));
    }

    if (parsed.limit) {
      candidates = candidates.slice(0, parsed.limit);
    }

    const results = [];
    for (const identity of candidates) {
      const employeeEmail = String(identity?.employeeEmail || "").toLowerCase();
      if (!employeeEmail) {
        continue;
      }

      try {
        if (parsed.runPipeline) {
          const job = await enqueuePipelineRun({
            employeeEmail,
            reason,
            dataRoot: env.DATA_ROOT,
            model: env.GROQ_MODEL,
            meetingAt: null,
          });

          results.push({
            employeeEmail,
            status: "accepted",
            mode: job?.mode || env.QUEUE_MODE,
            jobId: job?.id || null,
          });
        } else {
          await upsertEmployeeIdentity(identity);
          results.push({
            employeeEmail,
            status: "updated",
            mode: "identity-only",
            jobId: null,
          });
        }
      } catch (error) {
        results.push({
          employeeEmail,
          status: "error",
          error: error?.message || "sync failed",
        });

        if (!parsed.continueOnError) {
          throw error;
        }
      }
    }

    const acceptedCount = results.filter((item) => item.status === "accepted" || item.status === "updated").length;
    const errorCount = results.filter((item) => item.status === "error").length;

    return res.status(202).json({
      accepted: true,
      reason,
      runPipeline: parsed.runPipeline,
      totalCandidates: candidates.length,
      acceptedCount,
      errorCount,
      data: results,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "bulk bamboohr sync failed" });
  }
});

app.post("/webhooks/slack", async (req, res) => {
  try {
    const parsed = slackWebhookSchema.parse(req.body || {});

    const job = await enqueueDebouncedSlackReanalysis({
      employeeEmail: parsed.employeeEmail,
      message: parsed.message,
      debounceMs: env.SLACK_DEBOUNCE_MS,
      dataRoot: env.DATA_ROOT,
      model: env.GROQ_MODEL,
    });

    res.status(202).json({
      accepted: true,
      debounceMs: env.SLACK_DEBOUNCE_MS,
      jobId: job.id,
      reason: "New Slack message queued for debounced batch reanalysis",
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "invalid webhook payload" });
  }
});

app.get("/dashboard", async (_req, res) => {
  try {
    const cached = await getJson("dashboard");
    if (cached) {
      return res.json({ source: "cache", data: cached });
    }

    const summary = await getDashboardSummary();
    await warmDashboardCache(summary);
    return res.json({ source: "store", data: summary });
  } catch (error) {
    return res.status(500).json({ error: error.message || "failed to load dashboard" });
  }
});

app.get("/employees/:email/profile", async (req, res) => {
  try {
    const email = String(req.params.email || "").toLowerCase();
    const stats = await getEmployeeMeetingStats(email);

    const withStats = (doc) => {
      const existingMeta = doc?.meta && typeof doc.meta === "object" ? doc.meta : {};
      const meetingCount = Number(stats.totalMeetings || existingMeta.meetingCount || doc?.meetingCount || 0);
      const lastMeetingAt = stats.lastMeetingAt || existingMeta.lastMeetingAt || doc?.lastMeetingAt || null;

      return {
        ...doc,
        meta: {
          ...existingMeta,
          meetingCount,
          lastMeetingAt,
        },
        meetingCount,
        lastMeetingAt,
      };
    };

    const cached = await getJson(`profile:${email}`);
    if (cached) {
      return res.json({ source: "cache", data: withStats(cached) });
    }

    const latest = await getLatestProfile(email);
    if (!latest) {
      return res.status(404).json({ error: "profile not found" });
    }

    return res.json({ source: "store", data: withStats(latest) });
  } catch (error) {
    return res.status(500).json({ error: error.message || "failed to load profile" });
  }
});

app.get("/employees/:email/history", async (req, res) => {
  try {
    const email = String(req.params.email || "").toLowerCase();
    const parsedLimit = Number.parseInt(String(req.query.limit || 30), 10);
    const safeLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 180)) : 30;

    const [sentimentHistory, riskHistory] = await Promise.all([
      listSentimentHistory(email, { limit: safeLimit }),
      listRiskHistory(email, { limit: safeLimit }),
    ]);

    const sentimentFirst = sentimentHistory[0];
    const sentimentLast = sentimentHistory[sentimentHistory.length - 1];
    const riskFirst = riskHistory[0];
    const riskLast = riskHistory[riskHistory.length - 1];

    const summary = {
      latestSentimentScore: Number(sentimentLast?.score ?? 0),
      latestRiskScore: Number(riskLast?.score ?? 0),
      sentimentDelta:
        sentimentHistory.length > 1
          ? Number(sentimentLast?.score ?? 0) - Number(sentimentFirst?.score ?? 0)
          : 0,
      riskDelta: riskHistory.length > 1 ? Number(riskLast?.score ?? 0) - Number(riskFirst?.score ?? 0) : 0,
    };

    return res.json({
      employeeEmail: email,
      limit: safeLimit,
      sentimentHistory,
      riskHistory,
      summary,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "failed to load history" });
  }
});

app.get("/meetings", async (req, res) => {
  try {
    const email = req.query.employeeEmail ? String(req.query.employeeEmail).toLowerCase() : undefined;
    const query = req.query.q ? String(req.query.q) : "";
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const rows = await listMeetings({ employeeEmail: email, query, limit });
    return res.json({
      count: rows.length,
      data: rows.map((row) => ({
        meetingId: row.meetingId,
        title: row.title,
        meetingAt: row.meetingAt,
        employeeEmail: row.employeeEmail,
        participants: row.participants || [],
        summary: row.summary || "",
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "failed to load meetings" });
  }
});

app.get("/meetings/:id/transcript", async (req, res) => {
  try {
    const meeting = await getMeetingById(String(req.params.id || ""));
    if (!meeting) {
      return res.status(404).json({ error: "meeting not found" });
    }

    const q = req.query.q ? String(req.query.q).toLowerCase() : "";
    const transcript = Array.isArray(meeting.transcript) ? meeting.transcript : [];
    const filteredTranscript = q
      ? transcript.filter((line) => String(line.text || line.message || "").toLowerCase().includes(q))
      : transcript;

    return res.json({
      meetingId: meeting.meetingId,
      title: meeting.title,
      meetingAt: meeting.meetingAt,
      participants: meeting.participants || [],
      summary: meeting.summary || "",
      transcript: filteredTranscript,
      transcriptCount: filteredTranscript.length,
      totalTranscriptCount: transcript.length,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "failed to load transcript" });
  }
});

app.post("/briefs/upcoming", async (req, res) => {
  try {
    const parsed = upcomingBriefSchema.parse(req.body || {});
    const primaryEmail = parsed.employeeEmail.toLowerCase();
    const participantEmails = normalizeEmailList([primaryEmail, ...(parsed.participantEmails || [])]);

    const participantInsights = (
      await Promise.all(
        participantEmails.map((email) =>
          buildParticipantBriefInsight({
            employeeEmail: email,
            meetingAt: parsed.meetingAt || null,
          })
        )
      )
    ).filter(Boolean);

    const primary = participantInsights.find((item) => item.employeeEmail === primaryEmail) || null;
    if (!primary || primary.status !== "ready" || !primary.brief) {
      return res.status(202).json({
        accepted: true,
        jobId: primary?.jobId || null,
        employeeEmail: primaryEmail,
        message: "brief generation queued",
        participantInsights,
      });
    }

    return res.status(202).json({
      accepted: true,
      jobId: primary.jobId,
      employeeEmail: primaryEmail,
      brief: primary.brief,
      relationshipStatus: primary.relationshipStatus,
      pastMeetingInsights: primary.pastMeetingInsights,
      profileAnalysis: primary.profileAnalysis,
      participantInsights,
      guidance: {
        conversationStarters: primary?.brief?.conversationStarters || [],
        recommendedTone: primary?.brief?.recommendedTone || "supportive and direct",
      },
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "failed to generate upcoming brief" });
  }
});

app.post("/chat/sessions", async (req, res) => {
  try {
    const parsed = createChatSessionSchema.parse(req.body || {});
    const sessionId = String(parsed.sessionId || randomUUID());
    const session = await createChatSession({
      sessionId,
      status: parsed.status || "active",
    });

    if (parsed.title || parsed.userId) {
      await updateChatSession(sessionId, {
        title: parsed.title,
        userId: parsed.userId,
        status: parsed.status,
      });
    }

    const resolved = await getChatSession(sessionId);

    return res.status(201).json({
      ok: true,
      data: {
        sessionId: resolved?.sessionId || session?.sessionId || sessionId,
        status: resolved?.status || session?.status || "active",
        title: resolved?.title || null,
        userId: resolved?.userId || null,
        startedAt: resolved?.startedAt || session?.startedAt || new Date().toISOString(),
        lastMessageAt: resolved?.lastMessageAt || session?.lastMessageAt || new Date().toISOString(),
      },
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "failed to create chat session" });
  }
});

app.get("/chat/sessions", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
    const status = req.query.status ? String(req.query.status).toLowerCase() : undefined;
    const rows = await listChatSessions({ limit, status });

    return res.json({
      count: rows.length,
      data: rows.map((row) => ({
        sessionId: row.sessionId,
        title: row.title || null,
        status: row.status || "active",
        startedAt: row.startedAt || null,
        lastMessageAt: row.lastMessageAt || null,
        userId: row.userId || null,
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "failed to list chat sessions" });
  }
});

app.patch("/chat/sessions/:sessionId", async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const parsed = updateChatSessionSchema.parse(req.body || {});
    const session = await updateChatSession(sessionId, parsed);

    if (!session) {
      return res.status(404).json({ error: "chat session not found" });
    }

    return res.json({
      ok: true,
      data: {
        sessionId: session.sessionId,
        title: session.title || null,
        status: session.status || "active",
        startedAt: session.startedAt || null,
        lastMessageAt: session.lastMessageAt || null,
        userId: session.userId || null,
      },
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "failed to update chat session" });
  }
});

app.delete("/chat/sessions/:sessionId", async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const deleted = await deleteChatSession(sessionId);
    if (!deleted) {
      return res.status(404).json({ error: "chat session not found" });
    }

    return res.json({
      ok: true,
      data: {
        sessionId: deleted.sessionId,
        deleted: true,
        deletedMessageCount: Number(deleted.deletedMessageCount || 0),
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "failed to delete chat session" });
  }
});

app.get("/chat/sessions/:sessionId/history", async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const limit = Math.max(1, Math.min(Number(req.query.limit || 120), 500));
    const session = await getChatSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "chat session not found" });
    }

    const rows = await listChatMessages(sessionId, { limit });
    return res.json({
      sessionId,
      count: rows.length,
      data: rows.map((row) => ({
        sessionId: row.sessionId,
        messageIndex: Number(row.messageIndex || 0),
        role: row.role || "assistant",
        content: row.content || "",
        metadata: row.metadata || {},
        createdAt: row.createdAt || null,
      })),
      session: {
        status: session.status || "active",
        startedAt: session.startedAt || null,
        lastMessageAt: session.lastMessageAt || null,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "failed to load chat history" });
  }
});

app.post("/chat/query", async (req, res) => {
  try {
    const parsed = chatSchema.parse(req.body || {});
    const sessionId = String(parsed.sessionId || randomUUID());

    await createChatSession({ sessionId, status: "active" });
    const session = await getChatSession(sessionId);
    if (!session?.title) {
      await updateChatSession(sessionId, { title: toSessionTitle(parsed.query) });
    }

    await appendChatMessage({
      sessionId,
      role: "user",
      content: parsed.query,
      metadata: { source: "chat-query" },
    });

    const rawFilter = await intentExtractorService({
      query: parsed.query,
      model: env.GROQ_MODEL,
    });

    const validatedFilter = sanitizeFilter(rawFilter);
    const rows = await queryProfiles(rawFilter);
    const uniqueRows = dedupeProfilesByEmployee(rows);

    const response = await chatAssistantService({
      query: parsed.query,
      rows: uniqueRows,
      model: env.GROQ_MODEL,
    });

    await appendChatMessage({
      sessionId,
      role: "assistant",
      content: String(response.answer || "No response generated."),
      metadata: {
        count: uniqueRows.length,
        filters: validatedFilter,
        transcriptCards: Array.isArray(response.transcriptCards) ? response.transcriptCards : [],
      },
    });

    if (parsed.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const tokens = String(response.answer || "").split(" ");
      for (let index = 0; index < tokens.length; index += 1) {
        const chunk = tokens[index];
        res.write(`event: token\n`);
        res.write(`data: ${JSON.stringify({ token: chunk, index })}\n\n`);
      }

      res.write("event: session\n");
      res.write(`data: ${JSON.stringify({ sessionId })}\n\n`);
      res.write("event: cards\n");
      res.write(`data: ${JSON.stringify({ transcriptCards: response.transcriptCards })}\n\n`);
      res.write("event: end\n");
      res.write("data: {}\n\n");
      res.end();
      return;
    }

    return res.json({
      sessionId,
      query: parsed.query,
      filter: validatedFilter,
      count: uniqueRows.length,
      answer: response.answer,
      transcriptCards: response.transcriptCards,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "chat request failed" });
  }
});

async function start() {
  const groqDispatchInfo = await initGroqDispatcher({
    redisUrl: env.REDIS_URL,
    mode: env.GROQ_DISPATCH_MODE,
    requestsPerMinute: env.GROQ_REQUESTS_PER_MINUTE,
    windowMs: env.GROQ_RATE_WINDOW_MS,
  });

  const mongoInfo = await initMongo({
    mongoUri: env.MONGO_URI,
    mongoDbName: env.MONGO_DB,
    useMemoryStore: env.USE_MEMORY_STORE,
  });

  const cacheInfo = await initCache({
    redisUrl: env.REDIS_URL,
    useMemoryCache: env.USE_MEMORY_CACHE,
  });

  const queueInfo = await startPipelineQueues({
    redisUrl: env.REDIS_URL,
    dataRoot: env.DATA_ROOT,
    model: env.GROQ_MODEL,
    mode: env.QUEUE_MODE,
  });

  const shouldBoot = String(process.env.COLD_BOOT_ON_START || "true").toLowerCase() === "true";
  if (shouldBoot) {
    const boot = await runColdStartBootstrap({
      dataRoot: env.DATA_ROOT,
      model: env.GROQ_MODEL,
    });
    console.log("[server] cold boot:", boot);
  }

  app.listen(env.PORT, () => {
    console.log(`[server] listening on :${env.PORT}`);
    console.log(`[server] mongo mode: ${mongoInfo.mode}`);
    console.log(`[server] cache mode: ${cacheInfo.mode}`);
    console.log(`[server] data root: ${env.DATA_ROOT}`);
    console.log(`[server] queue mode: ${queueInfo.queueMode}`);
    console.log(`[server] groq dispatch mode: ${groqDispatchInfo.mode}`);
    console.log(`[server] groq rpm limit: ${groqDispatchInfo.rpmLimit} (reserve ${Math.max(0, 30 - groqDispatchInfo.rpmLimit)} for demo)`);
  });
}

start().catch((error) => {
  console.error("[server] startup failed", error.message);
  process.exit(1);
});
