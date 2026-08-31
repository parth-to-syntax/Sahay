import OpenAI from "openai";

let openaiClient = null;

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

export async function generateEmbedding(text) {
  const client = getOpenAI();
  if (!client) {
    console.warn("[embeddingService] OPENAI_API_KEY is missing. Skipping embedding.");
    return null;
  }
  if (!text || typeof text !== "string" || text.trim() === "") {
    return null;
  }

  try {
    const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
    const response = await client.embeddings.create({
      model,
      input: text.trim(),
      encoding_format: "float",
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("[embeddingService] Error generating embedding:", error?.message);
    return null;
  }
}

export async function generateEmbeddings(texts) {
  const client = getOpenAI();
  if (!client || !texts || texts.length === 0) {
    return [];
  }

  const validTexts = texts.map(t => String(t || "").trim()).filter(t => t.length > 0);
  if (validTexts.length === 0) return [];

  try {
    const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
    const response = await client.embeddings.create({
      model,
      input: validTexts,
      encoding_format: "float",
    });
    return response.data.map(d => d.embedding);
  } catch (error) {
    console.error("[embeddingService] Error generating embeddings:", error?.message);
    return [];
  }
}
