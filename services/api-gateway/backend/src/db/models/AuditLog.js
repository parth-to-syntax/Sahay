const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },

    actor: { type: String },
    action: { type: String, required: true, index: true },
    targetType: { type: String },
    targetId: { type: String },

    metadata: { type: mongoose.Schema.Types.Mixed },

    createdAt: { type: Date, default: () => new Date(), index: true }
  },
  { collection: 'audit_logs' }
);

AuditLogSchema.index({ orgId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
