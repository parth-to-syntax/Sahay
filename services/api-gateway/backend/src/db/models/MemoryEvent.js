const mongoose = require('mongoose');

const MemoryEventSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    employeeId: { type: String, required: true, index: true },

    eventType: {
      type: String,
      required: true,
      enum: [
        'meeting_summary',
        'action_item',
        'commitment',
        'topic_mention',
        'concern_signal',
        'sentiment_signal',
        'profile_change',
        'workload_signal'
      ]
    },

    eventTime: { type: Date, required: true, index: true },
    summary: { type: String },
    payload: { type: mongoose.Schema.Types.Mixed },

    sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', index: true },
    sourceChunkId: { type: String },
    sourceExcerpt: { type: String },

    confidence: { type: Number, min: 0, max: 1, default: 0.5 },
    sensitivity: { type: String, enum: ['standard', 'sensitive'], default: 'standard' },

    createdAt: { type: Date, default: () => new Date() }
  },
  { collection: 'memory_events' }
);

MemoryEventSchema.index({ orgId: 1, employeeId: 1, eventTime: -1 });

module.exports = mongoose.model('MemoryEvent', MemoryEventSchema);
