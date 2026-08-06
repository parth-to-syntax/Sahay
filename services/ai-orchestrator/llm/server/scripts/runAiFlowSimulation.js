import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
import { runAiFlowSimulation } from "../services/simulation/aiFlowSimulator.js";

dotenv.config({ override: true });

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function normalizeMode(mode) {
  const normalized = String(mode || "mock").toLowerCase();
  return normalized === "llm" ? "llm" : "mock";
}

async function main() {
  const workspaceRoot = process.cwd();
  const dataRoot = process.env.DATA_ROOT
    ? path.resolve(process.env.DATA_ROOT)
    : path.join(workspaceRoot, "mock_data");

  const hrmsPath = path.join(dataRoot, process.env.HRMS_FILE || "bamboohr_data.json");
  const meetPath = path.join(dataRoot, process.env.MEET_FILE || "meeting_transcript.json");
  const slackPath = path.join(dataRoot, process.env.SLACK_FILE || "hr_slack_simulation.json");

  const hrms = readJson(hrmsPath);
  const meet = readJson(meetPath);
  const slack = readJson(slackPath);

  let mode = normalizeMode(process.env.AI_SIM_MODE);
  if (mode === "llm" && !process.env.GROQ_API_KEY) {
    console.warn("AI_SIM_MODE=llm requested but GROQ_API_KEY is missing; falling back to mock mode.");
    mode = "mock";
  }
  const now = process.env.AI_SIM_NOW ? new Date(process.env.AI_SIM_NOW) : new Date();

  const simulationResult = await runAiFlowSimulation({
    mode,
    hrms,
    meet,
    slack,
    now,
  });

  const outputPath = process.env.AI_SIM_OUTPUT
    ? path.resolve(process.env.AI_SIM_OUTPUT)
    : path.join(workspaceRoot, "server", "output", "ai_flow_simulation.json");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(simulationResult, null, 2), "utf-8");

  const latest = simulationResult.latestProfile;

  console.log("AI flow simulation completed.");
  console.log(`Mode: ${simulationResult.mode}`);
  console.log(`Employee: ${simulationResult.identity.displayName} (${simulationResult.identity.email})`);
  console.log(`Profile version: v${latest.profileVersion}`);
  console.log(`Health score: ${latest.profile.healthScore} (${latest.profile.healthBand})`);
  console.log(
    `Retention risk: ${latest.profile.retentionRisk.riskScore} (${latest.profile.retentionRisk.riskLevel})`
  );
  console.log(`Timeline events: ${simulationResult.timeline.length}`);
  console.log(`Alerts generated: ${simulationResult.alerts.length}`);
  console.log(`Output saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error("AI flow simulation failed:", error.message);
  process.exit(1);
});