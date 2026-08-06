import fs from "fs";
import * as dotenv from "dotenv";
import Groq from "groq-sdk";
import { analyzeRetentionRiskWithLLM } from "./llmRetentionRisk.js";

dotenv.config({ override: true });

const WEIGHTS = {
  sentiment: 0.3,
  retentionSafety: 0.4,
  engagement: 0.2,
  hrmsIndicators: 0.1,
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function getGroqClient() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing. Add it in .env and rerun.");
  }
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

function extractSlackEntries(slack = {}) {
  const entries = [];

  if (Array.isArray(slack.messages)) {
    slack.messages.forEach((message) => {
      if (message?.text) {
        entries.push({
          text: String(message.text),
          timestamp: message.ts || message.timestamp || null,
          speaker: message.user || message.user_name || message.realName || "Unknown",
        });
      }
    });
    return entries;
  }

  Object.values(slack).forEach((value) => {
    if (!Array.isArray(value)) {
      return;
    }
    value.forEach((message) => {
      if (message?.text) {
        entries.push({
          text: String(message.text),
          timestamp: message.ts || message.timestamp || null,
          speaker: message.user || message.user_name || message.realName || "Unknown",
        });
      }
    });
  });

  return entries;
}

function buildUnifiedContext({ hrms, meet, slack }) {
  const transcriptLines = (meet?.transcript || [])
    .map((t) => `[${t.timestamp || t.ts || "NA"}] ${t.speaker || "Unknown"}: ${t.message || t.text || ""}`)
    .join("\n");

  const slackEntries = extractSlackEntries(slack);
  const slackLines = slackEntries
    .map((m) => `[${m.timestamp || "NA"}] ${m.speaker}: ${m.text || ""}`)
    .join("\n");

  return {
    employee: hrms?.employee || hrms?.profile || {},
    job: hrms?.job || {},
    compensation: hrms?.compensation || {},
    performance: hrms?.performance || {},
    leave: hrms?.leave || hrms?.time_off || hrms?.timeOff || {},
    transcript: transcriptLines,
    slack: slackLines,
    activityMeta: {
      slackMessageCount: slackEntries.length,
      transcriptTurnCount: Array.isArray(meet?.transcript) ? meet.transcript.length : 0,
    },
  };
}

function buildComponentPrompt(context) {
  return `
You are an HR intelligence scoring engine.

Task:
Given this employee context, output component scores from 0 to 100 where higher is healthier for the employee.

Return STRICT JSON only in this schema:
{
  "sentimentScore": number,
  "engagementScore": number,
  "hrmsIndicatorScore": number,
  "evidence": {
    "sentiment": string,
    "engagement": string,
    "hrmsIndicators": string
  }
}

Definitions:
- sentimentScore: emotional tone and stress trend from Slack + transcript.
- engagementScore: participation level, responsiveness, attendance/interaction cues.
- hrmsIndicatorScore: stability from review quality, leave patterns, tenure context, goal progress, compensation trend.

Rules:
- Use the provided context only.
- High stress, burnout, conflict, career uncertainty should reduce scores.
- Keep evidence short and specific.
- Scores must be integers 0-100.

INPUT JSON:
${JSON.stringify(context)}
`.trim();
}

function clampScore(value) {
  const num = Number(value);
  if (Number.isNaN(num)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeRiskScore(rawRiskScore) {
  const numeric = Number(rawRiskScore || 0);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  if (numeric <= 1) {
    return clampScore(numeric * 100);
  }
  return clampScore(numeric);
}

function getHealthBand(score) {
  if (score <= 40) {
    return "critical";
  }
  if (score <= 60) {
    return "monitor";
  }
  if (score <= 80) {
    return "healthy";
  }
  return "thriving";
}

async function analyzeHealthScoreWithLLM({ hrms, meet, slack }) {
  const groq = getGroqClient();
  const context = buildUnifiedContext({ hrms, meet, slack });

  const componentResponse = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You produce deterministic HR analysis JSON." },
      { role: "user", content: buildComponentPrompt(context) },
    ],
  });

  const rawComponents = JSON.parse(componentResponse.choices?.[0]?.message?.content || "{}");

  const sentimentScore = clampScore(rawComponents.sentimentScore);
  const engagementScore = clampScore(rawComponents.engagementScore);
  const hrmsIndicatorScore = clampScore(rawComponents.hrmsIndicatorScore);

  const retentionRisk = await analyzeRetentionRiskWithLLM({ hrms, meet, slack });
  const retentionRiskScore = normalizeRiskScore(retentionRisk.riskScore);
  const retentionSafetyScore = clampScore(100 - retentionRiskScore);

  const weightedTotal =
    sentimentScore * WEIGHTS.sentiment +
    retentionSafetyScore * WEIGHTS.retentionSafety +
    engagementScore * WEIGHTS.engagement +
    hrmsIndicatorScore * WEIGHTS.hrmsIndicators;

  const healthScore = clampScore(weightedTotal);

  return {
    healthScore,
    healthBand: getHealthBand(healthScore),
    componentScores: {
      sentimentScore,
      retentionRiskScore,
      retentionSafetyScore,
      engagementScore,
      hrmsIndicatorScore,
    },
    weightedBreakdown: {
      sentiment: Number((sentimentScore * WEIGHTS.sentiment).toFixed(2)),
      retentionSafety: Number((retentionSafetyScore * WEIGHTS.retentionSafety).toFixed(2)),
      engagement: Number((engagementScore * WEIGHTS.engagement).toFixed(2)),
      hrmsIndicators: Number((hrmsIndicatorScore * WEIGHTS.hrmsIndicators).toFixed(2)),
    },
    evidence: {
      sentiment: rawComponents?.evidence?.sentiment || "",
      engagement: rawComponents?.evidence?.engagement || "",
      hrmsIndicators: rawComponents?.evidence?.hrmsIndicators || "",
    },
    retentionRisk,
    analyzedAt: new Date().toISOString(),
  };
}

export {
  analyzeHealthScoreWithLLM,
  readJson,
};
