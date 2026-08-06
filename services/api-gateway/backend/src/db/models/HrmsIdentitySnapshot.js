const mongoose = require('mongoose');

const HrmsIdentitySnapshotSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    employeeId: { type: String, required: true, index: true },

    asOf: { type: Date, required: true, index: true },
    sourceSystem: { type: String, required: true, index: true },
    sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', index: true },

    // Common identity fields (optional, used for fast filters)
    fullName: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    workEmail: { type: String, index: true },
    personalEmail: { type: String },
    phone: { type: String },

    data: { type: mongoose.Schema.Types.Mixed },

    createdAt: { type: Date, default: () => new Date(), index: true }
  },
  { collection: 'hrms_identity_snapshots' }
);

HrmsIdentitySnapshotSchema.index({ orgId: 1, employeeId: 1, asOf: -1 });
HrmsIdentitySnapshotSchema.index(
  { orgId: 1, employeeId: 1, asOf: 1, sourceSystem: 1 },
  { unique: true }
);

module.exports = mongoose.model('HrmsIdentitySnapshot', HrmsIdentitySnapshotSchema);
