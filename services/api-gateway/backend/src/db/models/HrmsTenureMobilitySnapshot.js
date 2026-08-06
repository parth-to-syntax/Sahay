const mongoose = require('mongoose');

const HrmsTenureMobilitySnapshotSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    employeeId: { type: String, required: true, index: true },

    asOf: { type: Date, required: true, index: true },
    sourceSystem: { type: String, required: true, index: true },
    sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', index: true },

    hireDate: { type: Date },
    startDate: { type: Date },

    data: { type: mongoose.Schema.Types.Mixed },

    createdAt: { type: Date, default: () => new Date(), index: true }
  },
  { collection: 'hrms_tenure_mobility_snapshots' }
);

HrmsTenureMobilitySnapshotSchema.index({ orgId: 1, employeeId: 1, asOf: -1 });
HrmsTenureMobilitySnapshotSchema.index(
  { orgId: 1, employeeId: 1, asOf: 1, sourceSystem: 1 },
  { unique: true }
);

module.exports = mongoose.model('HrmsTenureMobilitySnapshot', HrmsTenureMobilitySnapshotSchema);
