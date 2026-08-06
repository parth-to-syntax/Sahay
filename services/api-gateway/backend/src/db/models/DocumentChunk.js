const mongoose = require('mongoose');

const DocumentChunkSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, ref: 'Document' },

    // Optional: the employee this chunk is primarily about (e.g., 1:1 transcript chunks)
    employeeId: { type: String, index: true },

    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },

    tokenCount: { type: Number },

    // For audio/transcripts
    startMs: { type: Number },
    endMs: { type: Number },

    // Embeddings are stored out-of-band; keep a pointer here.
    embeddingVectorId: { type: String, index: true },

    sensitivity: { type: String, enum: ['standard', 'sensitive'], default: 'standard' },

    createdAt: { type: Date, default: () => new Date(), index: true }
  },
  { collection: 'document_chunks' }
);

DocumentChunkSchema.index({ orgId: 1, documentId: 1, chunkIndex: 1 }, { unique: true });
DocumentChunkSchema.index({ orgId: 1, employeeId: 1, createdAt: -1 });

module.exports = mongoose.model('DocumentChunk', DocumentChunkSchema);
