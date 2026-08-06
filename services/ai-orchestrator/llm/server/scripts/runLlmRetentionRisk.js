import path from "path";
import * as dotenv from "dotenv";
import { analyzeRetentionRiskWithLLM, readJson } from "../services/analysis/llmRetentionRisk.js";

dotenv.config({ override: true });

async function main() {
  const root = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : process.cwd();

  const hrms = readJson(path.join(root, process.env.HRMS_FILE || "bamboohr_data.json"));
  const meet = readJson(path.join(root, process.env.MEET_FILE || "meeting_transcript.json"));
  const slack = readJson(path.join(root, process.env.SLACK_FILE || "hr_slack_simulation.json"));

  const result = await analyzeRetentionRiskWithLLM({ hrms, meet, slack });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("LLM retention analysis failed:", err.message);
  process.exit(1);
});
