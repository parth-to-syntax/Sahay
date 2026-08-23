/* eslint-disable no-console */

const { loadConfig } = require('../shared/config');
const { connectMongo, mongoStatus } = require('../db/mongo');

loadConfig();

function getArg(name, defaultValue) {
  const idx = process.argv.findIndex((a) => String(a).toLowerCase() === String(name).toLowerCase());
  if (idx === -1) return defaultValue;
  const next = process.argv[idx + 1];
  if (next === undefined) return defaultValue;
  return String(next);
}

function utcMidnight(date = new Date()) {
  const yyyyMmDd = date.toISOString().slice(0, 10);
  return new Date(`${yyyyMmDd}T00:00:00.000Z`);
}

async function main() {
  const orgId = getArg('--orgId', process.env.DEFAULT_ORG_ID || 'demo');
  const orgName = getArg('--name', 'Demo Organization');
  const surveyType = getArg('--surveyType', 'engagement');
  const auditCount = Number.parseInt(getArg('--auditCount', '10'), 10);

  const stBefore = mongoStatus();
  const conn = await connectMongo();
  const stAfter = mongoStatus();

  if (!conn?.connected) {
    throw new Error(`MongoDB not connected (${conn?.reason || 'UNKNOWN'})`);
  }

  console.log('[db:seed-demo] connected', {
    name: stAfter.name,
    host: stAfter.host,
    state: stAfter.state,
    uriSet: stBefore.uriSet || stAfter.uriSet
  });

  const Organization = require('../db/models/Organization');
  const Employee = require('../db/models/Employee');
  const SurveyResponse = require('../db/models/SurveyResponse');
  const AuditLog = require('../db/models/AuditLog');

  await Organization.updateOne(
    { orgId },
    {
      $setOnInsert: { orgId, createdAt: new Date() },
      $set: { name: orgName }
    },
    { upsert: true }
  );

  const employees = await Employee.find({ orgId }, { employeeId: 1, fullName: 1 }).lean();
  const respondedAt = utcMidnight(new Date());

  let surveyUpserts = 0;
  for (const e of employees) {
    const employeeId = String(e?.employeeId || '').trim();
    if (!employeeId) continue;

    // eslint-disable-next-line no-await-in-loop
    const res = await SurveyResponse.updateOne(
      { orgId, employeeId, surveyType, respondedAt },
      {
        $setOnInsert: {
          orgId,
          employeeId,
          surveyType,
          respondedAt,
          sourceSystem: 'seed'
        },
        $set: {
          // keep it stable/idempotent unless you explicitly change the script
          category: 'overall',
          score: 4,
          comment: 'Seeded demo survey response',
          raw: { seeded: true }
        }
      },
      { upsert: true }
    );

    if (res?.upsertedCount) surveyUpserts += 1;
  }

  let auditUpserts = 0;
  const count = Number.isFinite(auditCount) ? Math.max(0, Math.min(auditCount, 200)) : 10;
  for (let i = 0; i < count; i += 1) {
    const targetId = `seed:${respondedAt.toISOString().slice(0, 10)}:${i}`;
    // eslint-disable-next-line no-await-in-loop
    const res = await AuditLog.updateOne(
      { orgId, action: 'seed_demo', targetType: 'system', targetId },
      {
        $setOnInsert: {
          orgId,
          actor: 'seed-script',
          action: 'seed_demo',
          targetType: 'system',
          targetId,
          createdAt: respondedAt
        },
        $set: {
          metadata: { seeded: true }
        }
      },
      { upsert: true }
    );

    if (res?.upsertedCount) auditUpserts += 1;
  }

  console.log('[db:seed-demo] done', {
    orgId,
    orgName,
    employeesSeen: employees.length,
    surveyUpserts,
    auditUpserts
  });

  process.exit(0);
}

main().catch((err) => {
  console.error('[db:seed-demo] failed:', err?.message || err);
  process.exit(1);
});
