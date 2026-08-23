import path from "path";
import * as dotenv from "dotenv";
import { analyzeMeetingBriefWithLLM, readJson } from "../services/analysis/llmMeetingBrief.js";

dotenv.config({ override: true });

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

async function main() {
  const root = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : process.cwd();

  const hrms = readJson(path.join(root, process.env.HRMS_FILE || "bamboohr_data.json"));
  const meet = readJson(path.join(root, process.env.MEET_FILE || "meeting_transcript.json"));
  const slack = readJson(path.join(root, process.env.SLACK_FILE || "hr_slack_simulation.json"));

  const options = {
    meetingStartsAt: process.env.NEXT_MEETING_AT || null,
    manualRequest: parseBoolean(process.env.BRIEF_MANUAL_REQUEST, true),
    previousRiskLevel: process.env.PREVIOUS_RISK_LEVEL || null,
    previousHealthScore: parseOptionalNumber(process.env.PREVIOUS_HEALTH_SCORE),
  };

  const result = await analyzeMeetingBriefWithLLM({ hrms, meet, slack }, options);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("LLM meeting brief generation failed:", err.message);
  process.exit(1);
});
