const mongoose = require('mongoose');

const EmployeeSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },

    employeeId: { type: String, required: true, index: true },

    // HRMS identity
    workEmail: { type: String, index: true },
    fullName: { type: String },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },

    // Optional: stable upstream ids
    bamboohrEmployeeId: { type: String, index: true },

    // Incremental ingestion helpers
    bamboohrDirectoryHash: { type: String },
    bamboohrLastSeenAt: { type: Date },

    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() }
  },
  { collection: 'employees' }
);

EmployeeSchema.index({ orgId: 1, employeeId: 1 }, { unique: true });
EmployeeSchema.index(
  { orgId: 1, workEmail: 1 },
  {
    unique: true,
    partialFilterExpression: { workEmail: { $type: 'string' } }
  }
);

module.exports = mongoose.model('Employee', EmployeeSchema);
