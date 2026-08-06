import fs from "fs";
import * as dotenv from "dotenv";
import Groq from "groq-sdk";
import { analyzeHealthScoreWithLLM } from "./llmHealthScore.js";

dotenv.config({ override: true });

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function getGroqClient() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing. Add it in .env and rerun.");
  }
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

function normalizeRiskScore(rawRiskScore) {
  const numeric = Number(rawRiskScore || 0);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  if (numeric <= 1) {
    return Math.max(0, Math.min(100, Math.round(numeric * 100)));
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function getHoursToMeeting(meetingStartsAt) {
  if (!meetingStartsAt) {
    return null;
  }
  const meetingAt = new Date(meetingStartsAt).getTime();
  if (Number.isNaN(meetingAt)) {
    return null;
  }
  return (meetingAt - Date.now()) / (1000 * 60 * 60);
}

function evaluateBriefTrigger({ meetingStartsAt, manualRequest, previousRiskLevel, currentRiskLevel }) {
  const reasons = [];
  const hoursToMeeting = getHoursToMeeting(meetingStartsAt);

  const meetingSoon = typeof hoursToMeeting === "number" && hoursToMeeting >= 0 && hoursToMeeting <= 24;
  if (meetingSoon) {
    reasons.push("meeting_within_24h");
  }

  if (manualRequest) {
    reasons.push("manual_request");
  }

  const riskChanged =
    Boolean(previousRiskLevel) &&
    Boolean(currentRiskLevel) &&
    String(previousRiskLevel).toLowerCase() !== String(currentRiskLevel).toLowerCase();
  if (riskChanged) {
    reasons.push("risk_level_changed");
  }

  return {
    shouldGenerate: reasons.length > 0,
    reasons,
    hoursToMeeting: typeof hoursToMeeting === "number" ? Number(hoursToMeeting.toFixed(2)) : null,
    previousRiskLevel: previousRiskLevel || null,
    currentRiskLevel: currentRiskLevel || null,
  };
}

function buildPrompt(payload) {
  return `
You are a CHRO meeting preparation assistant.

Generate a pre-meeting brief using the provided data.

Return STRICT JSON only with this schema:
{
  "currentHealthScore": number,
  "healthBand": "critical" | "monitor" | "healthy" | "thriving",
  "whatChangedSinceLastMeeting": [string],
  "openFollowUps": [
    {
      "owner": string,
      "task": string,
      "status": "open" | "in_progress" | "completed"
    }
  ],
  "conversationStarters": [string, string, string],
  "handleCarefully": [string],
  "personalContext": [string],
  "recommendedTone": string,
  "executiveSummary": string
}

Requirements:
- Keep brief actionable and concise for a CHRO.
- Always provide exactly 3 conversation starters.
- Use direct evidence from transcript/slack/hrms context.
- If uncertainty exists, keep follow-up statuses conservative (open/in_progress).
- Recommended tone should reflect risk and trust-building needs.

INPUT JSON:
${JSON.stringify(payload)}
`.trim();
}

function normalizeBrief(raw, healthResult) {
  const parsed = JSON.parse(raw);
  const starters = Array.isArray(parsed.conversationStarters)
    ? parsed.conversationStarters.slice(0, 3)
    : [];

  while (starters.length < 3) {
    starters.push("What support would be most valuable for you over the next two weeks?");
  }

  return {
    currentHealthScore: Number(parsed.currentHealthScore ?? healthResult.healthScore),
    healthBand: parsed.healthBand || healthResult.healthBand,
    whatChangedSinceLastMeeting: Array.isArray(parsed.whatChangedSinceLastMeeting)
      ? parsed.whatChangedSinceLastMeeting
      : [],
    openFollowUps: Array.isArray(parsed.openFollowUps) ? parsed.openFollowUps : [],
    conversationStarters: starters,
    handleCarefully: Array.isArray(parsed.handleCarefully) ? parsed.handleCarefully : [],
    personalContext: Array.isArray(parsed.personalContext) ? parsed.personalContext : [],
    recommendedTone: parsed.recommendedTone || "supportive and direct",
    executiveSummary: parsed.executiveSummary || "Meeting brief generated.",
  };
}

async function analyzeMeetingBriefWithLLM({ hrms, meet, slack }, options = {}) {
  const healthResult = await analyzeHealthScoreWithLLM({ hrms, meet, slack });

  const trigger = evaluateBriefTrigger({
    meetingStartsAt: options.meetingStartsAt,
    manualRequest: Boolean(options.manualRequest),
    previousRiskLevel: options.previousRiskLevel,
    currentRiskLevel: healthResult?.retentionRisk?.riskLevel,
  });

  if (!trigger.shouldGenerate) {
    return {
      generated: false,
      trigger,
      message: "Meeting brief not generated because no trigger condition was met.",
      healthSnapshot: {
        healthScore: healthResult.healthScore,
        healthBand: healthResult.healthBand,
        retentionRiskLevel: healthResult?.retentionRisk?.riskLevel || "unknown",
        retentionRiskScore: normalizeRiskScore(healthResult?.retentionRisk?.riskScore),
      },
      analyzedAt: new Date().toISOString(),
    };
  }

  const promptPayload = {
    trigger,
    options,
    healthResult,
    previousMeetingBrief: meet?.meeting_brief || {},
    transcript: meet?.transcript || [],
    slack,
    hrms,
  };

  const groq = getGroqClient();
  const response = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You produce deterministic HR analysis JSON." },
      { role: "user", content: buildPrompt(promptPayload) },
    ],
  });

  const content = response.choices?.[0]?.message?.content || "{}";
  const brief = normalizeBrief(content, healthResult);

  return {
    generated: true,
    trigger,
    brief,
    healthSnapshot: {
      healthScore: healthResult.healthScore,
      healthBand: healthResult.healthBand,
      retentionRiskLevel: healthResult?.retentionRisk?.riskLevel || "unknown",
      retentionRiskScore: normalizeRiskScore(healthResult?.retentionRisk?.riskScore),
    },
    analyzedAt: new Date().toISOString(),
  };
}

export {
  analyzeMeetingBriefWithLLM,
  evaluateBriefTrigger,
  readJson,
};
