const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },

    documentType: {
      type: String,
      required: true,
      enum: [
        'hrms_snapshot',
        'hrms_profile',
        'slack_message',
        'slack_channel_snapshot',
        'slack_user_snapshot',
        'email_message',
        'calendar_event',
        'calendar_snapshot',
        'transcript',
        'meeting_transcript',
        'meeting_notes',
        'survey_response',
        'spreadsheet',
        'zoom_recording_audio'
      ]
    },
    sourceSystem: { type: String, required: true, index: true },

    externalId: { type: String },
    sourceUri: { type: String },

    contentHash: { type: String, index: true },

    ingestedAt: { type: Date, default: () => new Date(), index: true },
    sensitivity: { type: String, enum: ['standard', 'sensitive'], default: 'standard' },

    // Data payload. For MVP, we persist raw upstream JSON plus a small normalized content field.
    content: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
    raw: { type: mongoose.Schema.Types.Mixed }
  },
  { collection: 'documents' }
);

DocumentSchema.index({ orgId: 1, sourceSystem: 1, externalId: 1 }, { unique: true, sparse: true });
DocumentSchema.index({ orgId: 1, documentType: 1, ingestedAt: -1 });

module.exports = mongoose.model('Document', DocumentSchema);
