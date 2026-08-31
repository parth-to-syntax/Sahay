import { getMongoDb } from "../storage/stores.js";
import { generateEmbedding } from "../embeddings/embeddingService.js";

// Mathematically compute cosine similarity between two vectors
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function searchSimilarChunks(query, filters = {}, options = {}) {
  const topK = Number.parseInt(String(options.topK || process.env.VECTOR_TOP_K || 5), 10);

  // 1. Generate query embedding
  const queryVector = await generateEmbedding(query);
  if (!queryVector) {
    console.warn("[retrievalService] No query vector generated (missing API key?). Falling back to empty.");
    return [];
  }

  const db = getMongoDb();
  if (!db) {
    console.warn("[retrievalService] MongoDB not ready.");
    return [];
  }

  // 2. Metadata filtering using Mongo $match
  const matchFilter = {};
  if (filters.orgId) matchFilter.orgId = filters.orgId;
  if (filters.employeeId) matchFilter.employeeId = filters.employeeId;
  if (filters.documentId) matchFilter.documentId = filters.documentId;
  
  // Ensure we only pull chunks that actually have an embedding
  matchFilter.embedding = { $exists: true, $type: "array", $not: { $size: 0 } };

  // 3. Retrieve candidates
  const candidates = await db.collection("document_chunks").find(matchFilter).toArray();

  if (!candidates || candidates.length === 0) {
    return [];
  }

  // 4. Calculate Cosine Similarity & Rank
  const scored = candidates.map(chunk => {
    const score = cosineSimilarity(queryVector, chunk.embedding);
    // Remove the actual embedding vector from the return payload to save memory downstream
    delete chunk.embedding; 
    return {
      ...chunk,
      score
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // 5. Return Top-K
  return scored.slice(0, topK);
}
