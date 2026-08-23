const mongoose = require('mongoose');

const DocumentParticipantSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },

    documentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, ref: 'Document' },
    employeeId: { type: String, required: true, index: true },

    matchMethod: { type: String, enum: ['email_exact', 'hrms_key', 'name_fuzzy'], required: true },
    matchConfidence: { type: Number, min: 0, max: 1, default: 1 }
  },
  { collection: 'document_participants' }
);

DocumentParticipantSchema.index({ orgId: 1, documentId: 1, employeeId: 1 }, { unique: true });

module.exports = mongoose.model('DocumentParticipant', DocumentParticipantSchema);
