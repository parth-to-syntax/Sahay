const mongoose = require('mongoose');

const SurveyResponseSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    employeeId: { type: String, index: true },

    respondedAt: { type: Date, default: () => new Date(), index: true },

    surveyType: { type: String, required: true, index: true },
    category: { type: String, index: true },

    score: { type: Number },
    comment: { type: String },

    sourceSystem: { type: String },
    sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', index: true },

    raw: { type: mongoose.Schema.Types.Mixed }
  },
  { collection: 'survey_responses' }
);

SurveyResponseSchema.index({ orgId: 1, employeeId: 1, respondedAt: -1 });
SurveyResponseSchema.index({ orgId: 1, surveyType: 1, respondedAt: -1 });

module.exports = mongoose.model('SurveyResponse', SurveyResponseSchema);
