const mongoose = require('mongoose');

const MeetingTranscriptTurnSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    meetingId: { type: String, required: true, index: true },
    turnIndex: { type: Number, required: true, index: true },
    text: { type: String, required: true },
    speaker: { type: String, default: null }
  },
  { collection: 'meeting_transcript_turns' }
);

MeetingTranscriptTurnSchema.index(
  { orgId: 1, meetingId: 1, turnIndex: 1 },
  {
    unique: true,
    partialFilterExpression: { meetingId: { $type: 'string' }, turnIndex: { $type: 'int' } },
    name: 'uq_transcript_turn'
  }
);
MeetingTranscriptTurnSchema.index({ orgId: 1, meetingId: 1, turnIndex: 1 }, { name: 'ix_transcript_order' });

module.exports = mongoose.model('MeetingTranscriptTurn', MeetingTranscriptTurnSchema);