import 'dotenv/config';
import { initMongo, getMongoDb } from '../services/storage/stores.js';
import { chunkDocument } from '../services/chunking/chunkingService.js';
import { generateEmbeddings } from '../services/embeddings/embeddingService.js';
import { searchSimilarChunks } from '../services/rag/retrievalService.js';
import { chatAssistantService } from '../services/analysis/groqServices.js';

async function main() {
  console.log("=== Starting Local Semantic RAG Test ===\n");

  // 1. Init MongoDB
  // Replace this URI with the correct local Mongo connection if different
  const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
  await initMongo({
    mongoUri: MONGO_URI,
    mongoDbName: process.env.MONGODB_DB_NAME || "sahay_db",
    useMemoryStore: false
  });
  
  const db = getMongoDb();
  if (!db) {
    console.error("Failed to connect to MongoDB. Is it running?");
    process.exit(1);
  }
  
  // Create an isolated org ID and employee ID for testing
  const testOrgId = "rag-test-org";
  const testEmployeeId = "test-emp-001";
  const testDocumentId = "test-doc-001";

  // Cleanup old test chunks
  await db.collection("document_chunks").deleteMany({ orgId: testOrgId });

  // 2. Demo Documents
  const mockText = `
The backend API integration has been completed, but deployment continues to fail because of environment configuration problems.
We need to ensure that the production keys are correctly set in the pipeline.

Redis caching was introduced to reduce API latency. This improved the response time by over 40%.
The dashboard authentication endpoint is still being integrated and is causing blocking issues for the frontend team.
  `.trim();

  console.log("1. Chunking Document...");
  const mockDoc = { orgId: testOrgId, employeeId: testEmployeeId, documentId: testDocumentId, text: mockText };
  
  // Notice we use sentenceOverlap: 1 instead of character overlap
  const chunks = chunkDocument(mockDoc, { chunkSize: 120, sentenceOverlap: 1 });
  console.log(`Generated ${chunks.length} chunks. Here are the boundaries:`);
  chunks.forEach(c => {
    console.log(`\n[Chunk ${c.chunkIndex}] (${c.text.length} chars)`);
    console.log(`"${c.text}"`);
  });

  // 3. Embedding
  console.log("\n2. Generating Embeddings...");
  const chunkTexts = chunks.map(c => c.text);
  const embeddings = await generateEmbeddings(chunkTexts);
  
  if (!embeddings || embeddings.length === 0) {
    console.error("Failed to generate embeddings. Do you have OPENAI_API_KEY set?");
    process.exit(1);
  }

  const chunksWithEmbeddings = chunks.map((c, i) => ({
    ...c,
    embedding: embeddings[i]
  }));

  // 4. Storing in Mongo
  console.log(`\n3. Storing ${chunksWithEmbeddings.length} chunks to local MongoDB (document_chunks)...`);
  await db.collection("document_chunks").insertMany(chunksWithEmbeddings);

  // 5. Querying Semantic Retrieval
  const userQuery = "What technical obstacles are preventing the application from being released?";
  console.log(`\n4. Running Semantic Query: "${userQuery}"`);
  
  const topK = await searchSimilarChunks(userQuery, { orgId: testOrgId }, { topK: 3 });
  
  console.log("\n--- Retrieved Candidate Chunks (Cosine Similarity Ranked) ---");
  topK.forEach((chunk, i) => {
    console.log(`${i+1}. score=${chunk.score.toFixed(4)}`);
    console.log(`   Text: "${chunk.text.substring(0, 100).replace(/\n/g, ' ')}..."`);
  });

  if (topK.length === 0) {
    console.warn("No chunks retrieved. Check your MongoDB or API keys.");
    process.exit(0);
  }

  // 6. Groq Generation
  console.log("\n5. Generating Answer with Groq based on Retrieved Context...");
  
  // We mock a row array since chatAssistantService expects rows 
  // (we are just using it to route to the new RAG path inside)
  const mockRows = [{
    employeeEmail: "test@example.com",
    employeeName: "Test User"
  }];

  const groqResponse = await chatAssistantService({ 
    query: userQuery, 
    rows: mockRows,
    model: "llama3-8b-8192" 
  });

  console.log("\n--- Groq Answer ---");
  console.log(groqResponse.answer);
  console.log("-------------------\n");

  console.log("Done.");
  process.exit(0);
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
