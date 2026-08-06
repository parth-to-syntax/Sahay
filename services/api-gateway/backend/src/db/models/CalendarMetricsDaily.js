const mongoose = require('mongoose');

const CalendarMetricsDailySchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    employeeId: { type: String, required: true, index: true },

    day: { type: Date, required: true, index: true },

    meetingCount: { type: Number, default: 0 },
    meetingMinutes: { type: Number, default: 0 },
    afterHoursMeetingCount: { type: Number, default: 0 },
    backToBackCount: { type: Number, default: 0 },
    declinedCount: { type: Number, default: 0 },

    createdAt: { type: Date, default: () => new Date(), index: true },
    updatedAt: { type: Date, default: () => new Date(), index: true }
  },
  { collection: 'calendar_metrics_daily' }
);

CalendarMetricsDailySchema.index({ orgId: 1, employeeId: 1, day: 1 }, { unique: true });
CalendarMetricsDailySchema.index({ orgId: 1, day: -1 });

module.exports = mongoose.model('CalendarMetricsDaily', CalendarMetricsDailySchema);
