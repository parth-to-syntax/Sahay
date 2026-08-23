const mongoose = require('mongoose');

const ExternalIdentitySchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    // Optional: identity can be stored before it is linked to a canonical Employee
    employeeId: { type: String, index: true },

    sourceSystem: {
      type: String,
      required: true,
      enum: ['slack', 'bamboohr', 'google_calendar']
    },

    externalUserId: { type: String, required: true },

    // join hints
    email: { type: String },
    displayName: { type: String },

    matchMethod: { type: String, enum: ['email_exact', 'manual', 'unlinked'], default: 'unlinked' },
    matchConfidence: { type: Number, min: 0, max: 1, default: 0 },

    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() }
  },
  { collection: 'external_identities' }
);

ExternalIdentitySchema.index({ orgId: 1, sourceSystem: 1, externalUserId: 1 }, { unique: true });
ExternalIdentitySchema.index(
  { orgId: 1, sourceSystem: 1, email: 1 },
  { partialFilterExpression: { email: { $type: 'string' } } }
);

module.exports = mongoose.model('ExternalIdentity', ExternalIdentitySchema);
