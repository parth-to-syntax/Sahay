const mongoose = require('mongoose');

const IngestionCursorSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },

    sourceSystem: {
      type: String,
      required: true,
      enum: ['bamboohr', 'slack', 'google_calendar', 'manual', 'other']
    },

    // A stable job identifier, e.g. "directory", "users", "messages".
    jobName: { type: String, required: true },

    // Optional scoping key, e.g. channelId, calendarId, etc.
    scope: { type: String, default: '' },

    // Last successful run timestamps.
    lastRunAt: { type: Date, index: true },
    lastSuccessAt: { type: Date },

    // Failure info (best-effort).
    lastErrorAt: { type: Date },
    lastErrorCode: { type: String },
    lastErrorMessage: { type: String },

    // Optional cursors/hashes for upstream incremental APIs.
    lastCursor: { type: String },
    lastHash: { type: String },

    // Arbitrary last-run stats/metrics.
    lastStats: { type: mongoose.Schema.Types.Mixed },

    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() }
  },
  { collection: 'ingestion_cursors' }
);

IngestionCursorSchema.index(
  { orgId: 1, sourceSystem: 1, jobName: 1, scope: 1 },
  { unique: true }
);

IngestionCursorSchema.index({ orgId: 1, sourceSystem: 1, jobName: 1 });

module.exports = mongoose.model('IngestionCursor', IngestionCursorSchema);
