/* eslint-disable no-console */

const { loadConfig } = require('../shared/config');
const { connectMongo, mongoStatus } = require('../db/mongo');

loadConfig();

async function initModel(model, name) {
  // init() builds indexes; createCollection ensures collection exists.
  // Both are safe to call multiple times.
  await model.createCollection();
  await model.init();
  console.log(`[db:init] ok: ${name}`);
}

async function main() {
  const stBefore = mongoStatus();
  const conn = await connectMongo();
  const stAfter = mongoStatus();

  if (!conn?.connected) {
    throw new Error(`MongoDB not connected (${conn?.reason || 'UNKNOWN'})`);
  }

  console.log('[db:init] connected', {
    name: stAfter.name,
    host: stAfter.host,
    state: stAfter.state,
    uriSet: stBefore.uriSet || stAfter.uriSet
  });

  // Load models
  const Organization = require('../db/models/Organization');
  const Employee = require('../db/models/Employee');
  const ExternalIdentity = require('../db/models/ExternalIdentity');
  const Document = require('../db/models/Document');
  const DocumentParticipant = require('../db/models/DocumentParticipant');
  const MemoryEvent = require('../db/models/MemoryEvent');

  const HrmsIdentitySnapshot = require('../db/models/HrmsIdentitySnapshot');
  const HrmsEmploymentSnapshot = require('../db/models/HrmsEmploymentSnapshot');
  const HrmsCompensationSnapshot = require('../db/models/HrmsCompensationSnapshot');
  const HrmsPerformanceSnapshot = require('../db/models/HrmsPerformanceSnapshot');
  const HrmsAttendanceLeaveSnapshot = require('../db/models/HrmsAttendanceLeaveSnapshot');
  const HrmsTenureMobilitySnapshot = require('../db/models/HrmsTenureMobilitySnapshot');
  const HrmsOffboardingSnapshot = require('../db/models/HrmsOffboardingSnapshot');

  const DocumentChunk = require('../db/models/DocumentChunk');
  const CalendarMetricsDaily = require('../db/models/CalendarMetricsDaily');
  const SurveyResponse = require('../db/models/SurveyResponse');
  const AuditLog = require('../db/models/AuditLog');
  const IngestionCursor = require('../db/models/IngestionCursor');

  const models = [
    ['organizations', Organization],
    ['employees', Employee],
    ['external_identities', ExternalIdentity],
    ['documents', Document],
    ['document_participants', DocumentParticipant],
    ['memory_events', MemoryEvent],

    ['hrms_identity_snapshots', HrmsIdentitySnapshot],
    ['hrms_employment_snapshots', HrmsEmploymentSnapshot],
    ['hrms_compensation_snapshots', HrmsCompensationSnapshot],
    ['hrms_performance_snapshots', HrmsPerformanceSnapshot],
    ['hrms_attendance_leave_snapshots', HrmsAttendanceLeaveSnapshot],
    ['hrms_tenure_mobility_snapshots', HrmsTenureMobilitySnapshot],
    ['hrms_offboarding_snapshots', HrmsOffboardingSnapshot],

    ['document_chunks', DocumentChunk],
    ['calendar_metrics_daily', CalendarMetricsDaily],
    ['survey_responses', SurveyResponse],
    ['audit_logs', AuditLog],
    ['ingestion_cursors', IngestionCursor]
  ];

  for (const [name, model] of models) {
    // eslint-disable-next-line no-await-in-loop
    await initModel(model, name);
  }

  console.log('[db:init] done');
  process.exit(0);
}

main().catch((err) => {
  console.error('[db:init] failed:', err?.message || err);
  process.exit(1);
});
