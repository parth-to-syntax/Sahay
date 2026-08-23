const mongoose = require('mongoose');

const HrmsAttendanceLeaveSnapshotSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    employeeId: { type: String, required: true, index: true },

    asOf: { type: Date, required: true, index: true },
    sourceSystem: { type: String, required: true, index: true },
    sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', index: true },

    ptoBalanceHours: { type: Number },
    sickBalanceHours: { type: Number },

    data: { type: mongoose.Schema.Types.Mixed },

    createdAt: { type: Date, default: () => new Date(), index: true }
  },
  { collection: 'hrms_attendance_leave_snapshots' }
);

HrmsAttendanceLeaveSnapshotSchema.index({ orgId: 1, employeeId: 1, asOf: -1 });
HrmsAttendanceLeaveSnapshotSchema.index(
  { orgId: 1, employeeId: 1, asOf: 1, sourceSystem: 1 },
  { unique: true }
);

module.exports = mongoose.model('HrmsAttendanceLeaveSnapshot', HrmsAttendanceLeaveSnapshotSchema);
