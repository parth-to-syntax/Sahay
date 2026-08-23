import fs from "fs";
import * as dotenv from "dotenv";
import Groq from "groq-sdk";

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

  const slackLines = extractSlackEntries(slack)
    .map((m) => `[${m.timestamp || "NA"}] ${m.speaker}: ${m.text || ""}`)
    .join("\n");

  return {
    employee: hrms?.employee || hrms?.profile || {},
    performance: hrms?.performance || {},
    leave: hrms?.leave || hrms?.time_off || {},
    transcript: transcriptLines,
    slack: slackLines
  };
}

function buildPrompt(context) {
  return `
You are an HR risk intelligence engine.
Task: Detect retention risk signals from multi-source employee context.

Return STRICT JSON only with this schema:
{
  "riskScore": number,
  "riskLevel": "low" | "medium" | "high" | "critical",
  "signals": [
    {
      "tier": "critical" | "high" | "medium" | "low",
      "signal": string,
      "evidence": string,
      "source": "slack" | "transcript" | "hrms",
      "confidence": number
    }
  ],
  "summary": string
}

Signal taxonomy:
critical:
- mentioned other companies or opportunities
- asked about internal transfers
- referenced LinkedIn or job search
- expressed feeling undervalued repeatedly
- declined meetings with CHRO

high:
- promotion passed over without explanation
- workload complaints over 3+ weeks
- manager conflict mentioned
- sentiment dropped 20+ points in 30 days
- reduced Slack activity by 50%+

medium:
- work life balance concerns
- unclear career path mentioned
- team dynamics issues raised
- leave days unusually high
- skipped team channels

low:
- minor frustrations expressed
- slight sentiment dip
- single complaint resolved

Scoring guidance:
- More severe + repeated + recent signals => higher riskScore.
- Use exact short quotes as evidence.
- If weak/no risk, return low score and minimal signals.

INPUT JSON:
${JSON.stringify(context)}
`.trim();
}

function defaultRetentionFallback() {
  return {
    riskScore: 15,
    riskLevel: "low",
    signals: [],
    summary: "Fallback retention analysis used due to model parsing error.",
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

function safeParseJson(raw) {
  if (raw && typeof raw === "object") {
    return raw;
  }

  const text = String(raw || "").trim();
  if (!text) {
    throw new Error("Empty JSON payload");
  }

  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(text.slice(first, last + 1));
    }
    throw new Error("Invalid JSON payload");
  }
}

function deriveSignalStrength(signals = []) {
  const strength = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  if (!Array.isArray(signals)) {
    return strength;
  }

  signals.forEach((item) => {
    const tier = String(item?.tier || "low").toLowerCase();
    if (strength[tier] !== undefined) {
      strength[tier] += 1;
    }
  });

  return strength;
}

function normalizeSignal(signal) {
  return {
    tier: ["critical", "high", "medium", "low"].includes(signal?.tier) ? signal.tier : "low",
    signal: String(signal?.signal || "").trim(),
    evidence: String(signal?.evidence || "").trim(),
    source: ["slack", "transcript", "hrms"].includes(signal?.source) ? signal.source : "slack",
    confidence: Math.max(0, Math.min(1, Number(signal?.confidence || 0))),
  };
}

function resolveRiskLevel(score, modelLevel) {
  if (["low", "medium", "high", "critical"].includes(modelLevel)) {
    return modelLevel;
  }
  if (score >= 76) return "critical";
  if (score >= 51) return "high";
  if (score >= 26) return "medium";
  return "low";
}

function normalizeResult(raw) {
  const parsed = safeParseJson(raw);
  const signals = Array.isArray(parsed.signals) ? parsed.signals.map(normalizeSignal) : [];
  const signalStrength = deriveSignalStrength(signals);
  const score = Math.max(0, Math.min(100, Number(parsed.riskScore || 0)));
  const schemaValid =
    Number.isFinite(Number(parsed.riskScore)) &&
    ["low", "medium", "high", "critical"].includes(parsed.riskLevel) &&
    Array.isArray(parsed.signals) &&
    typeof parsed.summary === "string";

  return {
    riskScore: score,
    riskLevel: resolveRiskLevel(score, parsed.riskLevel),
    signals,
    summary: String(parsed.summary || "No summary"),
    criticalCount: signalStrength.critical,
    highCount: signalStrength.high,
    mediumCount: signalStrength.medium,
    signalStrength,
    schemaValid,
    fallbackUsed: false,
    analyzedAt: new Date().toISOString(),
  };
}

async function analyzeRetentionRiskWithLLM({ hrms, meet, slack }) {
  try {
    const groq = getGroqClient();
    const context = buildUnifiedContext({ hrms, meet, slack });
    const prompt = buildPrompt(context);

    const response = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You produce deterministic HR analysis JSON." },
        { role: "user", content: prompt }
      ]
    });

    const content = response.choices?.[0]?.message?.content || "{}";
    return normalizeResult(content);
  } catch {
    return defaultRetentionFallback();
  }
}

export {
  analyzeRetentionRiskWithLLM,
  readJson
};
