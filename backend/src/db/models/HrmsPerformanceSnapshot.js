const mongoose = require('mongoose');

const HrmsPerformanceSnapshotSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    employeeId: { type: String, required: true, index: true },

    asOf: { type: Date, required: true, index: true },
    sourceSystem: { type: String, required: true, index: true },
    sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', index: true },

    rating: { type: String },
    lastReviewDate: { type: Date },

    data: { type: mongoose.Schema.Types.Mixed },

    createdAt: { type: Date, default: () => new Date(), index: true }
  },
  { collection: 'hrms_performance_snapshots' }
);

HrmsPerformanceSnapshotSchema.index({ orgId: 1, employeeId: 1, asOf: -1 });
HrmsPerformanceSnapshotSchema.index(
  { orgId: 1, employeeId: 1, asOf: 1, sourceSystem: 1 },
  { unique: true }
);

module.exports = mongoose.model('HrmsPerformanceSnapshot', HrmsPerformanceSnapshotSchema);
