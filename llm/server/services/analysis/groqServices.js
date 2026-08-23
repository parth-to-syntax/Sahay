import Groq from "groq-sdk";
import { dispatchGroqJson } from "./groqDispatcher.js";

import { analyzeRetentionRiskWithLLM } from "./llmRetentionRisk.js";
import { analyzeMeetingBriefWithLLM } from "./llmMeetingBrief.js";

const TEMPERATURES = {
  sentiment: 0.1,
  retention: 0,
  summarizer: 0.2,
  brief: 0.15,
  intent: 0,
  chat: 0.3,
};

function getGroq() {
  if (!process.env.GROQ_API_KEY) {
    return null;
  }
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

function sentimentHeuristic(text) {
  const lower = String(text || "").toLowerCase();
  const negative = ["burnout", "overloaded", "undervalued", "conflict", "stress", "frustration"];
  const positive = ["appreciate", "support", "progress", "confidence", "clear"];

  const n = negative.reduce((acc, token) => (lower.includes(token) ? acc + 1 : acc), 0);
  const p = positive.reduce((acc, token) => (lower.includes(token) ? acc + 1 : acc), 0);
  const score = Math.max(0, Math.min(100, Math.round(70 + p * 6 - n * 8)));

  return {
    score,
    trend: n > p ? "down" : p > n ? "up" : "flat",
    emotions: n > p ? ["frustration", "fatigue"] : ["neutral"],
    evidence: `positive=${p}; negative=${n}`,
  };
}

function sentimentFallback(unified) {
  const fallback = sentimentHeuristic(unified?.mergedContextText || "");
  const lower = String(unified?.mergedContextText || "").toLowerCase();
  const valenceSignals = [];

  ["burnout", "stress", "conflict", "undervalued", "overloaded"].forEach((token) => {
    if (lower.includes(token)) valenceSignals.push(`negative:${token}`);
  });
  ["support", "progress", "appreciate", "confidence"].forEach((token) => {
    if (lower.includes(token)) valenceSignals.push(`positive:${token}`);
  });

  return {
    ...fallback,
    valenceSignals,
    uncertainty: 0.7,
    keyEvidence: [fallback.evidence],
    schemaValid: false,
    fallbackUsed: true,
  };
}

function isSentimentSchemaValid(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const hasScore = Number.isFinite(Number(payload.score));
  const hasTrend = ["up", "down", "flat"].includes(String(payload.trend || "").toLowerCase());
  const hasEmotions = Array.isArray(payload.emotions);
  return hasScore && hasTrend && hasEmotions;
}

function retentionFallbackFromSources(rawSources = {}) {
  const merged = [
    ...(rawSources?.meet?.transcript || []).map((item) => String(item.text || item.message || "")),
    ...(rawSources?.slack?.hr_discussions || []).map((item) => String(item.text || "")),
  ]
    .join("\n")
    .toLowerCase();

  const criticalTokens = ["reassess my options", "linkedin", "other opportunities", "internal transfer"];
  const highTokens = ["passed over for promotion", "manager conflict", "workload", "unsustainable"];

  const criticalHits = criticalTokens.filter((token) => merged.includes(token)).length;
  const highHits = highTokens.filter((token) => merged.includes(token)).length;
  const riskScore = Math.min(100, criticalHits * 35 + highHits * 18);

  let level = "low";
  if (riskScore >= 76) {
    level = "critical";
  } else if (riskScore >= 51) {
    level = "high";
  } else if (riskScore >= 26) {
    level = "medium";
  }

  return {
    riskScore,
    riskLevel: level,
    signals: [],
    summary: "Rule-based retention risk fallback.",
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    signalStrength: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    schemaValid: false,
    fallbackUsed: true,
    analyzedAt: new Date().toISOString(),
  };
}

async function runGroqJson({ model, temperature, system, user }) {
  if (!getGroq()) {
    return null;
  }
  try {
    return await dispatchGroqJson({ model, temperature, system, user });
  } catch (error) {
    // Keep pipeline operational under provider throttling or transient network failures.
    console.warn("[groq] request failed, using fallback:", error?.message || "unknown error");
    return null;
  }
}

async function sentimentService({ unified, model }) {
  const fallback = sentimentFallback(unified);

  const payload = await runGroqJson({
    model,
    temperature: TEMPERATURES.sentiment,
    system: "You are a CHRO sentiment analysis service. Return deterministic JSON.",
    user: `Analyze sentiment from this context and return JSON with fields score(0-100), trend(up|down|flat), emotions(string[]), evidence(string).\n\n${unified.mergedContextText}`,
  });

  if (!payload) {
    return fallback;
  }

  const schemaValid = isSentimentSchemaValid(payload);
  const safeScore = Number(payload.score ?? fallback.score);
  const safeEvidence = payload.evidence || fallback.evidence;
  const baseValence = Array.isArray(payload.valenceSignals) ? payload.valenceSignals : [];
  const valenceSignals = baseValence.length ? baseValence : fallback.valenceSignals;

  return {
    score: Number.isFinite(safeScore) ? Math.max(0, Math.min(100, safeScore)) : fallback.score,
    trend: payload.trend || fallback.trend,
    emotions: Array.isArray(payload.emotions) ? payload.emotions : fallback.emotions,
    evidence: safeEvidence,
    valenceSignals,
    uncertainty: Math.max(0, Math.min(1, Number(payload.uncertainty ?? (schemaValid ? 0.2 : 0.55)))),
    keyEvidence: Array.isArray(payload.keyEvidence) ? payload.keyEvidence : [safeEvidence],
    schemaValid,
    fallbackUsed: !schemaValid,
  };
}

async function retentionService({ rawSources }) {
  if (process.env.GROQ_API_KEY) {
    try {
      return await analyzeRetentionRiskWithLLM({
        hrms: rawSources.hrms,
        meet: rawSources.meet,
        slack: rawSources.slack,
      });
    } catch {
      return retentionFallbackFromSources(rawSources);
    }
  }

  return retentionFallbackFromSources(rawSources);
}

async function summarizerService({ unified, model }) {
  const lines = unified.activity.meetingTranscript.map((item) => `${item.speaker}: ${item.text}`);
  if (lines.length === 0) {
    return {
      chunks: [],
      summary: "No transcript available.",
    };
  }

  const chunkSize = 10;
  const chunks = [];
  for (let i = 0; i < lines.length; i += chunkSize) {
    chunks.push(lines.slice(i, i + chunkSize));
  }

  const maxGroqChunksRaw = Number.parseInt(String(process.env.GROQ_SUMMARY_MAX_CHUNKS || "3"), 10);
  const maxGroqChunks = Number.isFinite(maxGroqChunksRaw)
    ? Math.max(1, Math.min(maxGroqChunksRaw, 20))
    : 3;

  const groq = getGroq();
  if (!groq) {
    return {
      chunks: chunks.map((chunk, index) => ({
        index,
        text: chunk.join(" "),
        summary: chunk.slice(0, 2).join(" "),
      })),
      summary: "Transcript summarized with fallback mode.",
    };
  }

  const summarized = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const text = chunks[index].join("\n");
    let response = null;
    if (index < maxGroqChunks) {
      response = await runGroqJson({
        model,
        temperature: TEMPERATURES.summarizer,
        system: "You summarize meeting transcript chunks for CHRO use.",
        user: `Summarize this transcript chunk in <=2 bullets. Return JSON {summary: string}.\n\n${text}`,
      });
    }

    summarized.push({
      index,
      text,
      summary: response?.summary || chunks[index].slice(0, 2).join(" "),
    });
  }

  return {
    chunks: summarized,
    summary: summarized.map((item) => item.summary).join(" "),
  };
}

function extractLastInteraction(rawSources = {}) {
  const items = Array.isArray(rawSources?.slack?.hr_discussions) ? rawSources.slack.hr_discussions : [];
  if (items.length === 0) {
    return "No recent Slack interaction available.";
  }
  const sorted = items
    .slice()
    .sort((a, b) => Number(String(a.timestamp || a.ts || 0).split(".")[0]) - Number(String(b.timestamp || b.ts || 0).split(".")[0]));
  const latest = sorted[sorted.length - 1];
  return `${latest.realName || latest.userId || "Unknown"}: ${latest.text || ""}`;
}

function relationshipStatusFromSignals({ sentimentScore, riskLevel }) {
  if (riskLevel === "critical") {
    return "At-risk relationship; immediate trust rebuilding and concrete commitments required.";
  }
  if (riskLevel === "high") {
    return "Strained relationship; alignment and follow-through needed to stabilize confidence.";
  }
  if (sentimentScore < 55) {
    return "Cautious relationship; maintain supportive, direct communication.";
  }
  return "Generally stable relationship with room for growth-focused dialogue.";
}

async function briefService({ rawSources, previousRiskLevel, unified, sentiment, retentionRisk, summary, meetingAt }) {
  const lastInteraction = extractLastInteraction(rawSources);
  const lastMeetingTakeaways = Array.isArray(rawSources?.meet?.meeting_brief?.key_takeaways)
    ? rawSources.meet.meeting_brief.key_takeaways.slice(0, 4)
    : [];

  const generalContext = {
    employeeName: unified?.employee?.displayName || "Unknown",
    role: unified?.employee?.role || "Unknown",
    department: unified?.employee?.department || "Unknown",
  };

  const relationshipStatus = relationshipStatusFromSignals({
    sentimentScore: Number(sentiment?.score || 0),
    riskLevel: retentionRisk?.riskLevel || "low",
  });

  if (process.env.GROQ_API_KEY) {
    try {
      const generated = await analyzeMeetingBriefWithLLM(
        {
          hrms: rawSources.hrms,
          meet: rawSources.meet,
          slack: rawSources.slack,
        },
        {
          manualRequest: true,
          meetingStartsAt: meetingAt || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          previousRiskLevel,
        }
      );

      return {
        ...generated,
        brief: {
          ...(generated.brief || {}),
          generalContext,
          lastInteractionContext: lastInteraction,
          lastMeetingTakeaways,
          relationshipStatus,
        },
      };
    } catch (error) {
      console.warn("[groq] brief generation failed, using fallback:", error?.message || "unknown error");
    }
  }

  return {
    generated: true,
    trigger: {
      shouldGenerate: true,
      reasons: ["manual_request"],
      hoursToMeeting: 2,
    },
    brief: {
      currentHealthScore: 45,
      healthBand: "monitor",
      whatChangedSinceLastMeeting: ["Incremental data synced and analysis refreshed."],
      openFollowUps: [],
      conversationStarters: [
        "What has felt most sustainable since our last check-in?",
        "Which blockers should we remove first this week?",
        "What support do you need from leadership before the next sprint?",
      ],
      handleCarefully: ["Career-path uncertainty", "Workload and expectation mismatch"],
      personalContext: [`Manager: ${unified?.employee?.manager || "Unknown"}`],
      recommendedTone: retentionRisk?.riskLevel === "critical" ? "empathetic, calm, highly specific" : "supportive and direct",
      executiveSummary: summary?.summary || "Contextual brief generated in fallback mode.",
      generalContext,
      lastInteractionContext: lastInteraction,
      lastMeetingTakeaways,
      relationshipStatus,
      meetingAt: meetingAt || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    },
    analyzedAt: new Date().toISOString(),
  };
}

function comprehensiveSummaryService({ unified, sentiment, retentionRisk, summary }) {
  return {
    employeeOverview: `${unified.employee.displayName} (${unified.employee.role}, ${unified.employee.department})`,
    behavioralAnalysis: {
      sentimentScore: Number(sentiment.score || 0),
      sentimentTrend: sentiment.trend || "flat",
      retentionRiskLevel: retentionRisk.riskLevel || "low",
      retentionRiskScore: Number(retentionRisk.riskScore || 0),
      relationshipStatus: relationshipStatusFromSignals({
        sentimentScore: Number(sentiment.score || 0),
        riskLevel: retentionRisk.riskLevel || "low",
      }),
    },
    narrativeSummary: summary?.summary || "No summary available.",
    generatedAt: new Date().toISOString(),
  };
}

function intentFallback(query) {
  const lower = String(query || "").toLowerCase();
  const out = { limit: 5 };

  if (lower.includes("critical")) {
    out.riskLevel = "critical";
  } else if (lower.includes("high")) {
    out.riskLevel = "high";
  }

  const emailMatch = lower.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (emailMatch) {
    out.employeeEmail = emailMatch[0];
  }

  const scoreMatch = lower.match(/health\s*(?:>|above|over)\s*(\d{1,3})/i);
  if (scoreMatch) {
    out.minHealthScore = Number(scoreMatch[1]);
  }

  return out;
}

async function intentExtractorService({ query, model }) {
  const payload = await runGroqJson({
    model,
    temperature: TEMPERATURES.intent,
    system: "Extract MongoDB-safe filter JSON only.",
    user: `Convert user query into JSON filter with optional fields: employeeEmail, riskLevel(low|medium|high|critical), minHealthScore, maxHealthScore, keyword, limit.\nQuery: ${query}`,
  });

  return payload || intentFallback(query);
}

function buildTranscriptCards(rows) {
  return rows
    .map((row) => ({
      employeeEmail: row.employeeEmail,
      employeeName: row.employeeName,
      summary: row?.analysis?.summary?.summary || "No summary",
      collapsed: true,
      chunks: row?.analysis?.summary?.chunks || [],
    }))
    .slice(0, 5);
}

async function chatAssistantService({ query, rows, model }) {
  const cards = buildTranscriptCards(rows);
  const context = rows
    .map(
      (row) =>
        `${row.employeeName} (${row.employeeEmail}) risk=${row?.analysis?.retentionRisk?.level} health=${row?.analysis?.health?.score}`
    )
    .join("\n");

  const fallback = {
    answer: `Found ${rows.length} matching profile(s). Top signals and transcript cards are attached.`,
    transcriptCards: cards,
  };

  const payload = await runGroqJson({
    model,
    temperature: TEMPERATURES.chat,
    system: "You are a CHRO chat assistant. Return JSON {answer:string}.",
    user: `User query: ${query}\n\nResults:\n${context}\n\nProvide concise guidance.`,
  });

  return {
    answer: payload?.answer || fallback.answer,
    transcriptCards: cards,
  };
}

export {
  sentimentService,
  retentionService,
  summarizerService,
  briefService,
  comprehensiveSummaryService,
  intentExtractorService,
  chatAssistantService,
};
