import { Queue, Worker } from "bullmq";
import Redis from "ioredis";

import { normalizeUnifiedSchema } from "../services/normalization/unifiedSchema.js";
import { fetchAllSourcesParallelWithDelta } from "../services/ingestion/fetchSources.js";
import {
  sentimentService,
  retentionService,
  summarizerService,
  briefService,
  comprehensiveSummaryService,
} from "../services/analysis/groqServices.js";
import { computeDeterministicScoring } from "../services/analysis/scoringEngine.js";
import {
  getNextProfileVersion,
  getLatestProfile,
  saveProfile,
  saveAlerts,
  saveSentimentHistory,
  saveRiskHistory,
  saveRawDataSnapshot,
  getDashboardSummary,
  upsertEmployeeIdentity,
  getSyncState,
  updateSyncState,
  saveMeetingRecord,
  isColdBootCompleted,
  markColdBootCompleted,
} from "../services/storage/stores.js";
import { warmProfileCache, warmDashboardCache } from "../services/cache/cacheService.js";

const QUEUE_INGESTION = "pipeline-ingestion";
const QUEUE_ANALYSIS = "pipeline-analysis";

let connection = null;
let ingestionQueue = null;
let analysisQueue = null;
let ingestionWorker = null;
let analysisWorker = null;
let queueMode = "inline";
const debounceTimers = new Map();

function getScoringMode() {
  const raw = String(process.env.SCORING_MODE || "hybrid").toLowerCase();
  if (["legacy", "shadow", "hybrid"].includes(raw)) {
    return raw;
  }
  return "hybrid";
}

function riskLevelFromScore(score) {
  const value = Number(score || 0);
  if (value >= 76) return "critical";
  if (value >= 51) return "high";
  if (value >= 26) return "medium";
  return "low";
}

function createAlerts(profile, previousProfile, reason, extractionMeta = {}) {
  const alerts = [];
  const now = new Date().toISOString();

  if (profile.analysis.retentionRisk.level === "critical") {
    alerts.push({
      employeeEmail: profile.employeeEmail,
      severity: "critical",
      kind: "critical_risk",
      message: "Retention risk is critical.",
      reason,
      createdAt: now,
    });
  }

  const previousRisk = Number(previousProfile?.analysis?.retentionRisk?.score || 0);
  const currentRisk = Number(profile.analysis.retentionRisk.score || 0);
  if (previousProfile && currentRisk - previousRisk >= 15) {
    alerts.push({
      employeeEmail: profile.employeeEmail,
      severity: "high",
      kind: "risk_increase",
      message: `Risk increased by ${currentRisk - previousRisk} points.`,
      reason,
      createdAt: now,
    });
  }

  const previousSentiment = Number(previousProfile?.analysis?.sentiment?.score || 0);
  const currentSentiment = Number(profile.analysis.sentiment.score || 0);
  if (previousProfile && previousSentiment - currentSentiment >= 20) {
    alerts.push({
      employeeEmail: profile.employeeEmail,
      severity: "high",
      kind: "sentiment_drop",
      message: `Sentiment dropped by ${previousSentiment - currentSentiment} points.`,
      reason,
      createdAt: now,
    });
  }

  if (extractionMeta.sentimentFallbackUsed || extractionMeta.retentionFallbackUsed) {
    alerts.push({
      employeeEmail: profile.employeeEmail,
      severity: "medium",
      kind: "extraction_fallback",
      message: "Model extraction fallback used for latest analysis.",
      reason,
      createdAt: now,
    });
  }

  return alerts;
}

function estimateHealth(sentiment, retentionRisk) {
  const retentionSafety = Math.max(0, 100 - Number(retentionRisk.riskScore || 0));
  return Math.max(0, Math.min(100, Math.round(sentiment.score * 0.6 + retentionSafety * 0.4)));
}

function buildMeetingRecord({ profile, rawSources, summary }) {
  const brief = rawSources?.meet?.meeting_brief || {};
  const date = brief?.date || new Date().toISOString().slice(0, 10);
  const meetingId = `${profile.employeeEmail}:${date}`;

  return {
    meetingId,
    employeeEmail: profile.employeeEmail,
    title: brief.previous_meeting || "1:1 Meeting",
    meetingAt: date,
    participants: Array.isArray(brief.attendees)
      ? brief.attendees.map((item) => ({ name: item.name || "Unknown", role: item.role || "Unknown" }))
      : [],
    transcript: Array.isArray(rawSources?.meet?.transcript) ? rawSources.meet.transcript : [],
    transcriptLines: Array.isArray(rawSources?.meet?.transcript)
      ? rawSources.meet.transcript.map((item) => `${item.speaker || "Unknown"}: ${item.text || item.message || ""}`)
      : [],
    summary: summary?.summary || "No summary",
    chunkSummaries: summary?.chunks || [],
    updatedAt: new Date().toISOString(),
  };
}

function countSlackDeltaMessages(slack = {}) {
  return Object.values(slack).reduce((acc, value) => {
    if (!Array.isArray(value)) {
      return acc;
    }

    return (
      acc +
      value.reduce((innerAcc, item) => {
        const text = String(item?.text || "").trim();
        return innerAcc + (text ? 1 : 0);
      }, 0)
    );
  }, 0);
}

function hasDeltaData(rawSources) {
  const slackCount = countSlackDeltaMessages(rawSources?.slack || {});

  const meetingCount = Array.isArray(rawSources?.meet?.transcript)
    ? rawSources.meet.transcript.reduce((acc, item) => {
      const text = String(item?.text || item?.message || "").trim();
      return acc + (text ? 1 : 0);
    }, 0)
    : 0;
  return slackCount > 0 || meetingCount > 0;
}

function shouldUseHistoricalReplay(reason = "") {
  const normalized = String(reason || "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "cold-start") return true;
  return normalized.startsWith("manual") || normalized.includes("sync") || normalized.includes("backfill") || normalized.includes("upcoming-brief");
}

function truncateText(value, maxLen = 140) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function toNumericTs(value, fallback = 0) {
  const normalized = String(value || "").split(".")[0];
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function collectSlackSnippets(rawSources = {}, limit = 3) {
  const rows = Array.isArray(rawSources?.slack?.hr_discussions)
    ? rawSources.slack.hr_discussions
        .slice()
        .sort((a, b) => toNumericTs(a?.timestamp || a?.ts) - toNumericTs(b?.timestamp || b?.ts))
    : [];

  const snippets = rows
    .map((row) => truncateText(row?.text || "", 120))
    .filter(Boolean)
    .slice(-Math.max(1, limit));

  return Array.from(new Set(snippets));
}

const EXIT_INTENT_PATTERNS = [
  /\bwant to leave\b/i,
  /\bleave this company\b/i,
  /\bnot satisfied\b/i,
  /\bquit\b/i,
  /\bresign\b/i,
  /\blooking for (other )?opportunit(?:y|ies)\b/i,
  /\bjob search\b/i,
  /\blinkedin\b/i,
];

function detectExitIntentSignals({ unified = {}, rawSources = {}, retentionRisk = {} } = {}) {
  const textParts = [
    String(unified?.mergedContextText || ""),
    String(retentionRisk?.summary || ""),
    ...collectSlackSnippets(rawSources, 10),
  ];

  const evidence = textParts.join("\n");
  if (!evidence.trim()) {
    return [];
  }

  return EXIT_INTENT_PATTERNS
    .filter((pattern) => pattern.test(evidence))
    .map((pattern) => pattern.source.replace(/\\b|\\/g, ""));
}

function applyExitIntentGuardrails({ sentiment = {}, retentionRisk = {}, unified = {}, rawSources = {} } = {}) {
  const matchedSignals = detectExitIntentSignals({ unified, rawSources, retentionRisk });
  if (!matchedSignals.length) {
    return { sentiment, retentionRisk, matchedSignals };
  }

  const nextSentiment = { ...sentiment };
  const currentSentimentScore = Number(nextSentiment?.score || 0);
  nextSentiment.score = Math.min(currentSentimentScore, 35);
  nextSentiment.trend = "down";

  const currentEmotions = Array.isArray(nextSentiment?.emotions) ? nextSentiment.emotions : [];
  nextSentiment.emotions = Array.from(new Set(["concern", "frustration", ...currentEmotions])).slice(0, 5);

  const guardrailEvidence = `Exit-intent language detected (${matchedSignals.slice(0, 3).join(", ")}).`;
  const existingEvidence = String(nextSentiment?.evidence || "").trim();
  nextSentiment.evidence = existingEvidence
    ? `${guardrailEvidence} ${existingEvidence}`
    : guardrailEvidence;

  const existingKeyEvidence = Array.isArray(nextSentiment?.keyEvidence) ? nextSentiment.keyEvidence : [];
  nextSentiment.keyEvidence = [guardrailEvidence, ...existingKeyEvidence].slice(0, 5);

  const existingValence = Array.isArray(nextSentiment?.valenceSignals) ? nextSentiment.valenceSignals : [];
  nextSentiment.valenceSignals = Array.from(new Set(["negative:exit-intent", ...existingValence]));
  nextSentiment.uncertainty = Number.isFinite(Number(nextSentiment?.uncertainty))
    ? Math.min(Number(nextSentiment.uncertainty), 0.25)
    : 0.25;

  const nextRetentionRisk = { ...retentionRisk };
  const currentRiskScore = Number(nextRetentionRisk?.riskScore || 0);
  nextRetentionRisk.riskScore = Math.max(currentRiskScore, 76);
  nextRetentionRisk.riskLevel = "critical";
  nextRetentionRisk.summary = [
    `Exit-intent language detected in latest context (${matchedSignals.slice(0, 3).join(", ")}).`,
    String(nextRetentionRisk?.summary || "").trim(),
  ]
    .filter(Boolean)
    .join(" ");

  const existingSignals = Array.isArray(nextRetentionRisk?.signals) ? nextRetentionRisk.signals : [];
  const hasExitSignal = existingSignals.some((signal) => String(signal?.name || "").toLowerCase() === "exit-intent-detected");
  if (!hasExitSignal) {
    nextRetentionRisk.signals = [
      {
        name: "exit-intent-detected",
        severity: "critical",
        evidence: matchedSignals.slice(0, 3),
      },
      ...existingSignals,
    ];
  }

  return { sentiment: nextSentiment, retentionRisk: nextRetentionRisk, matchedSignals };
}

function buildObservations({ sentiment = {}, retentionRisk = {}, previousProfile = null, rawSources = {} } = {}) {
  const observations = [];
  const currentSentiment = Number(sentiment?.score || 0);
  const previousSentiment = Number(previousProfile?.analysis?.sentiment?.score);
  const hasPrevious = Number.isFinite(previousSentiment);
  const deltaSentiment = hasPrevious ? Math.round((currentSentiment - previousSentiment) * 100) / 100 : 0;

  if (hasPrevious) {
    observations.push(
      `Sentiment moved ${deltaSentiment >= 0 ? "+" : ""}${deltaSentiment} points vs prior analysis (${Math.round(previousSentiment)} -> ${Math.round(currentSentiment)}).`
    );
  } else {
    observations.push(`Current sentiment is ${Math.round(currentSentiment)}/100 from the latest analysis window.`);
  }

  const slackCount = countSlackDeltaMessages(rawSources?.slack || {});
  const keyEvidence = Array.isArray(sentiment?.keyEvidence)
    ? sentiment.keyEvidence.map((item) => truncateText(item, 120)).filter(Boolean)
    : [];
  const slackSnippets = collectSlackSnippets(rawSources, 3);

  if (slackCount > 0) {
    const evidenceLine = keyEvidence.length
      ? `Key sentiment evidence: ${keyEvidence.slice(0, 2).join(" | ")}.`
      : sentiment?.evidence
        ? `Model evidence: ${truncateText(sentiment.evidence, 180)}.`
        : "";
    const snippetLine = slackSnippets.length
      ? `Recent Slack excerpts: ${slackSnippets.map((item) => `"${item}"`).join(" | ")}.`
      : "";

    observations.push(
      `Slack impact considered from ${slackCount} message${slackCount === 1 ? "" : "s"}. ${evidenceLine} ${snippetLine}`
        .replace(/\s+/g, " ")
        .trim()
    );
  } else {
    observations.push("No new Slack text was available in this analysis window; sentiment relied on other available context.");
  }

  if (retentionRisk?.summary) {
    observations.push(`Risk context: ${truncateText(retentionRisk.summary, 180)}`);
  }

  return observations.filter(Boolean).slice(0, 5);
}

function pickIdentityCandidate(rawSources, employeeEmail) {
  const candidates = Array.isArray(rawSources?.identityCandidates) ? rawSources.identityCandidates : [];
  if (!candidates.length) {
    return null;
  }

  const targetEmail = String(employeeEmail || "").toLowerCase();
  if (!targetEmail) {
    return candidates[0];
  }

  return (
    candidates.find((item) => String(item?.employeeEmail || "").toLowerCase() === targetEmail) || candidates[0]
  );
}

async function runAnalysisPipeline({ unified, rawSources, employeeEmail: requestedEmployeeEmail, reason, model, meetingAt }) {
  const employeeEmail = String(requestedEmployeeEmail || unified?.employee?.email || "").toLowerCase();
  if (!employeeEmail) {
    throw new Error("missing employee email for analysis pipeline");
  }
  const previousProfile = await getLatestProfile(employeeEmail);
  const previousRiskLevel = previousProfile?.analysis?.retentionRisk?.level || null;
  const scoringMode = getScoringMode();

  const [sentimentResult, retentionRiskResult, summary] = await Promise.all([
    sentimentService({ unified, model }),
    retentionService({ rawSources }),
    summarizerService({ unified, model }),
  ]);

  const {
    sentiment,
    retentionRisk,
  } = applyExitIntentGuardrails({
    sentiment: sentimentResult,
    retentionRisk: retentionRiskResult,
    unified,
    rawSources,
  });

  const enrichedBrief = await briefService({
    rawSources,
    previousRiskLevel,
    unified,
    sentiment,
    retentionRisk,
    summary,
    meetingAt,
  });

  const deterministic = computeDeterministicScoring({
    unified,
    sentiment,
    retentionRisk,
    previousProfile,
  });

  const legacyHealthScore = estimateHealth(sentiment, retentionRisk);
  const servedHealthScore = scoringMode === "hybrid" ? deterministic.components.healthScore : legacyHealthScore;
  const servedRiskScore = scoringMode === "hybrid"
    ? deterministic.retentionRiskScore
    : Number(retentionRisk.riskScore || 0);
  const servedRiskLevel = scoringMode === "hybrid"
    ? riskLevelFromScore(servedRiskScore)
    : retentionRisk.riskLevel || "low";

  const version = await getNextProfileVersion(employeeEmail);
  const comprehensive = comprehensiveSummaryService({ unified, sentiment, retentionRisk, summary });
  const observations = buildObservations({
    sentiment,
    retentionRisk,
    previousProfile,
    rawSources,
  });

  const profile = {
    employeeEmail,
    employeeName: unified.employee.displayName,
    version,
    reason,
    analyzedAt: new Date().toISOString(),
    sourceStats: unified.sourceStats,
    analysis: {
      scoringVersion: deterministic.scoringVersion,
      components: deterministic.components,
      temporal: deterministic.temporal,
      extractionMeta: deterministic.extractionMeta,
      health: {
        score: Number(servedHealthScore || 0),
        band:
          scoringMode === "hybrid"
            ? deterministic.healthBand
            : servedHealthScore <= 40
              ? "critical"
              : servedHealthScore <= 60
                ? "monitor"
                : servedHealthScore <= 80
                  ? "healthy"
                  : "thriving",
      },
      sentiment: {
        score: Number(sentiment.score || 0),
        trend: sentiment.trend || "flat",
        emotions: sentiment.emotions || [],
        evidence: sentiment.evidence || "",
        keyEvidence: Array.isArray(sentiment.keyEvidence) ? sentiment.keyEvidence : [],
        valenceSignals: Array.isArray(sentiment.valenceSignals) ? sentiment.valenceSignals : [],
        uncertainty: Number.isFinite(Number(sentiment.uncertainty)) ? Number(sentiment.uncertainty) : null,
      },
      retentionRisk: {
        score: Number(servedRiskScore || 0),
        level: servedRiskLevel,
        signals: retentionRisk.signals || [],
        summary: retentionRisk.summary || "",
      },
      summary,
      observations,
      brief: enrichedBrief?.brief || {},
      relationshipStatus: comprehensive.behavioralAnalysis.relationshipStatus,
      comprehensive,
      searchText: unified.mergedContextText,
    },
  };

  const alerts = createAlerts(profile, previousProfile, reason, deterministic.extractionMeta);

  await saveProfile(profile);
  await saveSentimentHistory({
    employeeEmail,
    profileVersion: version,
    analyzedAt: profile.analyzedAt,
    score: Number(sentiment.score || 0),
    smoothedScore: Number(deterministic.components.sentimentSmoothed || 0),
    trend: sentiment.trend || "flat",
    fallbackUsed: Boolean(deterministic.extractionMeta.sentimentFallbackUsed),
    schemaValid: deterministic.extractionMeta.sentimentSchemaValid !== false,
  });
  await saveRiskHistory({
    employeeEmail,
    profileVersion: version,
    analyzedAt: profile.analyzedAt,
    score: Number(servedRiskScore || 0),
    riskLogit: Number(deterministic.components.riskLogit || 0),
    level: servedRiskLevel,
    criticalCount: Number(retentionRisk.criticalCount || 0),
    highCount: Number(retentionRisk.highCount || 0),
    mediumCount: Number(retentionRisk.mediumCount || 0),
    signalStrength: retentionRisk.signalStrength || { critical: 0, high: 0, medium: 0, low: 0 },
    fallbackUsed: Boolean(deterministic.extractionMeta.retentionFallbackUsed),
    schemaValid: deterministic.extractionMeta.retentionSchemaValid !== false,
  });
  await upsertEmployeeIdentity({
    employeeEmail,
    employeeId: unified?.employee?.employeeId || null,
    displayName: unified?.employee?.displayName || profile.employeeName || "Unknown",
    role: unified?.employee?.role || "Unknown",
    department: unified?.employee?.department || "Unknown",
    source: "bamboohr",
  });
  await saveAlerts(alerts);
  await saveMeetingRecord(buildMeetingRecord({ profile, rawSources, summary }));

  await warmProfileCache(profile);
  const dashboard = await getDashboardSummary();
  await warmDashboardCache(dashboard);

  return {
    profile,
    alerts,
    dashboard,
  };
}

async function runInlinePipeline({ dataRoot, employeeEmail, reason, model, meetingAt, injectedSlackEvent = null }) {
  const syncState = await getSyncState(employeeEmail);
  const historicalMode = shouldUseHistoricalReplay(reason);
  let rawSources = await fetchAllSourcesParallelWithDelta({
    dataRoot,
    employeeEmail,
    cursors: syncState,
    historicalMode,
    injectedSlackEvent,
  });

  if (!historicalMode && !hasDeltaData(rawSources)) {
    const replaySources = await fetchAllSourcesParallelWithDelta({
      dataRoot,
      employeeEmail,
      cursors: syncState,
      historicalMode: true,
      injectedSlackEvent,
    });
    if (!hasDeltaData(replaySources)) {
      await updateSyncState(employeeEmail, rawSources.cursors);
      return {
        skipped: true,
        reason: "No delta data available.",
        employeeEmail,
      };
    }
    rawSources = replaySources;
  }

  const identity = pickIdentityCandidate(rawSources, employeeEmail);
  if (identity) {
    await upsertEmployeeIdentity(identity);
  }
  await updateSyncState(employeeEmail, rawSources.cursors);

  const unified = normalizeUnifiedSchema(rawSources);
  await saveRawDataSnapshot({
    employeeEmail: String(employeeEmail).toLowerCase(),
    reason,
    fetchedAt: rawSources.fetchedAt,
    cursors: rawSources.cursors || {},
    payload: rawSources,
  });
  return runAnalysisPipeline({ unified, rawSources, employeeEmail, reason, model, meetingAt });
}

async function startPipelineQueues({ redisUrl, dataRoot, model, mode = "auto" }) {
  const forceInline = mode === "inline";

  if (!forceInline) {
    try {
      connection = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
        enableReadyCheck: false,
        retryStrategy: () => null,
      });
      connection.on("error", () => {
        // Suppress noisy unhandled event logs when Redis is down.
      });
      await connection.connect();
      await connection.ping();

      ingestionQueue = new Queue(QUEUE_INGESTION, { connection });
      analysisQueue = new Queue(QUEUE_ANALYSIS, { connection });

      ingestionWorker = new Worker(
        QUEUE_INGESTION,
        async (job) => {
          const employeeEmail = String(job.data.employeeEmail || "").toLowerCase();
          const reason = job.data.reason || "manual";

          const syncState = await getSyncState(employeeEmail);
          const historicalMode = shouldUseHistoricalReplay(reason) || Boolean(job.data.historicalMode);
          let rawSources = await fetchAllSourcesParallelWithDelta({
            dataRoot,
            employeeEmail,
            cursors: syncState,
            historicalMode,
            injectedSlackEvent: job.data.injectedSlackEvent || null,
          });

          if (!historicalMode && !hasDeltaData(rawSources)) {
            const replaySources = await fetchAllSourcesParallelWithDelta({
              dataRoot,
              employeeEmail,
              cursors: syncState,
              historicalMode: true,
              injectedSlackEvent: job.data.injectedSlackEvent || null,
            });

            if (!hasDeltaData(replaySources)) {
              await updateSyncState(employeeEmail, rawSources.cursors);
              return {
                employeeEmail,
                reason,
                skipped: true,
                skipReason: "No delta data available.",
              };
            }

            rawSources = replaySources;
          }

          const identity = pickIdentityCandidate(rawSources, employeeEmail);
          if (identity) {
            await upsertEmployeeIdentity(identity);
          }
          await updateSyncState(employeeEmail, rawSources.cursors);

          const unified = normalizeUnifiedSchema(rawSources);

          await saveRawDataSnapshot({
            employeeEmail,
            reason,
            fetchedAt: rawSources.fetchedAt,
            cursors: rawSources.cursors || {},
            payload: rawSources,
          });

          await analysisQueue.add(
            "analyze-profile",
            {
              unified,
              rawSources,
              employeeEmail,
              reason,
              meetingAt: job.data.meetingAt || null,
            },
            { removeOnComplete: true, removeOnFail: 100 }
          );

          return {
            employeeEmail,
            reason,
          };
        },
        { connection }
      );

      analysisWorker = new Worker(
        QUEUE_ANALYSIS,
        async (job) => {
          return runAnalysisPipeline({
            unified: job.data.unified,
            rawSources: job.data.rawSources,
            employeeEmail: job.data.employeeEmail,
            reason: job.data.reason,
            model,
            meetingAt: job.data.meetingAt || null,
          });
        },
        { connection }
      );

      ingestionWorker.on("failed", (job, error) => {
        console.error("[queue] ingestion job failed", job?.id, error.message);
      });

      analysisWorker.on("failed", (job, error) => {
        console.error("[queue] analysis job failed", job?.id, error.message);
      });

      queueMode = "bullmq";
    } catch (error) {
      if (connection) {
        try {
          connection.disconnect();
        } catch {
          // no-op
        }
      }
      console.warn("[queue] BullMQ unavailable, using inline fallback:", error.message);
      queueMode = "inline";
    }
  } else {
    queueMode = "inline";
  }

  return {
    queues: {
      ingestionQueue,
      analysisQueue,
    },
    queueMode,
    runInlinePipeline: (payload) => runInlinePipeline({ dataRoot, model, ...payload }),
  };
}

async function enqueuePipelineRun({ employeeEmail, reason, dataRoot, model, meetingAt = null }) {
  if (queueMode === "inline") {
    const result = await runInlinePipeline({
      dataRoot,
      employeeEmail,
      reason: reason || "manual",
      model,
      meetingAt,
    });
    return {
      id: `inline-${Date.now()}`,
      mode: "inline",
      result,
    };
  }

  return ingestionQueue.add(
    "fetch-normalize",
    {
      employeeEmail,
      reason: reason || "manual",
      historicalMode: shouldUseHistoricalReplay(reason),
      meetingAt,
    },
    {
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

async function enqueueDebouncedSlackReanalysis({ employeeEmail, message, debounceMs, dataRoot, model }) {
  if (queueMode === "inline") {
    const key = String(employeeEmail || "").toLowerCase();
    const existing = debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(async () => {
      try {
        await runInlinePipeline({
          dataRoot,
          employeeEmail,
          reason: "slack-webhook",
          model,
          injectedSlackEvent: message
            ? {
                text: message,
                timestamp: Math.floor(Date.now() / 1000),
                realName: "Webhook User",
              }
            : null,
        });
      } catch (error) {
        console.error("[queue] inline debounced run failed", error.message);
      }
    }, debounceMs);

    debounceTimers.set(key, timeout);

    return {
      id: `inline-debounce-${key}`,
      mode: "inline",
    };
  }

  const jobId = `slack-reanalysis:${String(employeeEmail || "").toLowerCase()}`;
  const existing = await ingestionQueue.getJob(jobId);
  if (existing) {
    await existing.remove();
  }

  return ingestionQueue.add(
    "fetch-normalize",
    {
      employeeEmail,
      reason: "slack-webhook",
      webhookMessage: message || "",
      injectedSlackEvent: message
        ? {
            text: message,
            timestamp: Math.floor(Date.now() / 1000),
            realName: "Webhook User",
          }
        : null,
    },
    {
      delay: debounceMs,
      jobId,
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

async function runColdStartBootstrap({ dataRoot, model }) {
  const alreadyBooted = await isColdBootCompleted();
  if (alreadyBooted) {
    return {
      skipped: true,
      reason: "Cold boot already completed",
    };
  }

  const sources = await fetchAllSourcesParallelWithDelta({
    dataRoot,
    employeeEmail: null,
    historicalMode: true,
    cursors: {},
  });

  const requireSlackMatch = String(process.env.BOOTSTRAP_REQUIRE_SLACK_MATCH || "true").toLowerCase() !== "false";
  const maxEmployees = Math.max(1, Number.parseInt(String(process.env.BOOTSTRAP_EMPLOYEE_LIMIT || "5"), 10) || 5);

  const identitiesAll = Array.isArray(sources.identityCandidates) ? sources.identityCandidates : [];
  const identities = identitiesAll
    .filter((identity) => !requireSlackMatch || identity?.hasSlackMember)
    .slice(0, maxEmployees);
  const results = [];

  for (const identity of identities) {
    if (!identity?.employeeEmail) {
      continue;
    }
    await upsertEmployeeIdentity(identity);
    const run = await enqueuePipelineRun({
      employeeEmail: identity.employeeEmail,
      reason: "cold-start",
      dataRoot,
      model,
    });
    results.push({ employeeEmail: identity.employeeEmail, jobId: run?.id || null });
  }

  await markColdBootCompleted({
    initializedEmployees: results.length,
    at: new Date().toISOString(),
  });

  return {
    skipped: false,
    initializedEmployees: results.length,
    jobs: results,
  };
}

export {
  startPipelineQueues,
  enqueuePipelineRun,
  enqueueDebouncedSlackReanalysis,
  runColdStartBootstrap,
  queueMode,
};
