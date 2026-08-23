const mongoose = require('mongoose');

const HrmsEmploymentSnapshotSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    employeeId: { type: String, required: true, index: true },

    asOf: { type: Date, required: true, index: true },
    sourceSystem: { type: String, required: true, index: true },
    sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', index: true },

    status: { type: String },
    jobTitle: { type: String },
    department: { type: String },
    division: { type: String },
    location: { type: String },
    managerName: { type: String },
    managerEmployeeId: { type: String },

    data: { type: mongoose.Schema.Types.Mixed },

    createdAt: { type: Date, default: () => new Date(), index: true }
  },
  { collection: 'hrms_employment_snapshots' }
);

HrmsEmploymentSnapshotSchema.index({ orgId: 1, employeeId: 1, asOf: -1 });
HrmsEmploymentSnapshotSchema.index(
  { orgId: 1, employeeId: 1, asOf: 1, sourceSystem: 1 },
  { unique: true }
);

module.exports = mongoose.model('HrmsEmploymentSnapshot', HrmsEmploymentSnapshotSchema);
