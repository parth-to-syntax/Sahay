import { handleIngestionJob, handleAnalysisJob } from "./pipelineQueue.js";

// Dummy context to pass dependencies (like dataRoot and model)
// In a real Serverless setup, these would be loaded from env inside the handler.
const getContext = () => ({
  dataRoot: process.env.DATA_ROOT || "./mock_data",
  model: process.env.GROQ_MODEL || "llama3-8b-8192"
});

export const ingestionWorkerHandler = async (event) => {
  for (const record of event.Records) {
    try {
      const jobData = JSON.parse(record.body);
      await handleIngestionJob(jobData, getContext());
    } catch (error) {
      console.error("[sqs] Ingestion job failed:", error);
      throw error; // Throwing ensures SQS retries or sends to DLQ
    }
  }
};

export const analysisWorkerHandler = async (event) => {
  for (const record of event.Records) {
    try {
      const jobData = JSON.parse(record.body);
      await handleAnalysisJob(jobData, getContext());
    } catch (error) {
      console.error("[sqs] Analysis job failed:", error);
      throw error;
    }
  }
};
