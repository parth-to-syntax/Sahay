const express = require('express');
const crypto = require('crypto');

const { connectMongo } = require('../db/mongo');
const { getOrgId, getAsOf } = require('../shared/org');
const { normalizeEmail } = require('../shared/pii');
const { HttpError } = require('../shared/errors');

const { getEmployeeDirectory, getEmployeeById } = require('../connectors/bamboohr/bamboohrClient');
const {
  usersList,
  conversationsList,
  conversationsHistory,
  conversationsReplies
} = require('../connectors/slack/slackClient');
const { getOAuth2Client } = require('../connectors/google/googleClient');
const { readTokens } = require('../shared/googleTokenStore');
const { listEvents } = require('../connectors/google/googleCalendar');
const { fetchTranscripts } = require('../connectors/fireflies/firefliesClient');

const Organization = require('../db/models/Organization');
const Document = require('../db/models/Document');
const DocumentParticipant = require('../db/models/DocumentParticipant');
const DocumentChunk = require('../db/models/DocumentChunk');
const Employee = require('../db/models/Employee');
const ExternalIdentity = require('../db/models/ExternalIdentity');
const Meeting = require('../db/models/meeting');
const MeetingTranscriptTurn = require('../db/models/MeetingTranscriptTurn');

const HrmsIdentitySnapshot = require('../db/models/HrmsIdentitySnapshot');
const HrmsEmploymentSnapshot = require('../db/models/HrmsEmploymentSnapshot');
const HrmsCompensationSnapshot = require('../db/models/HrmsCompensationSnapshot');
const HrmsPerformanceSnapshot = require('../db/models/HrmsPerformanceSnapshot');
const HrmsAttendanceLeaveSnapshot = require('../db/models/HrmsAttendanceLeaveSnapshot');
const HrmsTenureMobilitySnapshot = require('../db/models/HrmsTenureMobilitySnapshot');
const HrmsOffboardingSnapshot = require('../db/models/HrmsOffboardingSnapshot');

const CalendarMetricsDaily = require('../db/models/CalendarMetricsDaily');
const IngestionCursor = require('../db/models/IngestionCursor');

const router = express.Router();

async function ensureMongoConnected() {
  const result = await connectMongo();
  if (!result?.connected) {
    const reason = result?.reason || 'MONGO_NOT_CONNECTED';
    throw new HttpError(503, `MongoDB not connected (${reason})`, 'MONGO_NOT_CONNECTED');
  }
}

async function ensureOrganization(orgId) {
  const now = new Date();
  await Organization.updateOne(
    { orgId },
    {
      $setOnInsert: { orgId, createdAt: now },
      $set: { name: `Org ${orgId}` }
    },
    { upsert: true }
  );
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
}

function parseEmailCsv(rawValue) {
  if (!rawValue) return [];
  return String(rawValue)
    .split(',')
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
}

function parseFirefliesDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const epochMs = numeric > 9999999999 ? numeric : numeric * 1000;
    const parsed = new Date(epochMs);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function collectFirefliesParticipantEmails(transcript) {
  const participants = Array.isArray(transcript?.participants) ? transcript.participants : [];
  const emails = [];

  for (const participant of participants) {
    if (typeof participant === 'string') {
      const candidate = normalizeEmail(participant);
      if (candidate.includes('@')) emails.push(candidate);
      continue;
    }

    if (participant && typeof participant === 'object') {
      const email = normalizeEmail(participant.email || participant.value || participant.name || '');
      if (email.includes('@')) emails.push(email);
    }
  }

  const hostEmail = normalizeEmail(transcript?.host_email);
  const organizerEmail = normalizeEmail(transcript?.organizer_email);
  if (hostEmail) emails.push(hostEmail);
  if (organizerEmail) emails.push(organizerEmail);

  return Array.from(new Set(emails));
}

function buildTranscriptSummary(sentences) {
  const lines = Array.isArray(sentences)
    ? sentences
        .map((row) => String(row?.text || '').trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  if (!lines.length) return null;
  return lines.join(' ').slice(0, 600);
}

function toTranscriptTurns(sentences) {
  if (!Array.isArray(sentences)) return [];
  return sentences
    .map((row, index) => ({
      turnIndex: index,
      speaker: String(row?.speaker_name || '').trim() || null,
      text: String(row?.text || '').trim(),
    }))
    .filter((row) => row.text);
}

function stableStringify(value) {
  const t = typeof value;
  if (value === null) return 'null';
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean') return String(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (t === 'object') {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
      const v = value[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`);
    }
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function hashObject(obj) {
  return sha256Hex(stableStringify(obj));
}

function clampInt(value, { min = 0, max = 100000, fallback = 0 } = {}) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function slackTsNowMinusDays(days) {
  const d = Number.isFinite(days) ? days : 7;
  const ms = Math.max(0, d) * 86400000;
  const t = (Date.now() - ms) / 1000;
  return String(t.toFixed(6));
}

function maxSlackTs(messages) {
  let max = null;
  for (const m of messages) {
    const ts = m?.ts;
    if (!ts) continue;
    const n = Number.parseFloat(String(ts));
    if (!Number.isFinite(n)) continue;
    if (max === null || n > max) max = n;
  }
  return max === null ? null : String(max.toFixed(6));
}

async function upsertIngestionCursorSuccess({ orgId, sourceSystem, jobName, scope = '', hash, cursor, stats }) {
  const now = new Date();
  const set = {
    lastRunAt: now,
    lastSuccessAt: now,
    lastHash: hash,
    lastStats: stats,
    updatedAt: now
  };
  if (cursor !== undefined) {
    set.lastCursor = cursor;
  }
  await IngestionCursor.updateOne(
    { orgId, sourceSystem, jobName, scope },
    {
      $setOnInsert: { orgId, sourceSystem, jobName, scope, createdAt: now },
      $set: set,
      $unset: { lastErrorAt: 1, lastErrorCode: 1, lastErrorMessage: 1 }
    },
    { upsert: true }
  );
}

async function upsertIngestionCursorError({ orgId, sourceSystem, jobName, scope = '', err }) {
  const now = new Date();
  const code = err?.code || err?.errorCode || err?.name;
  const message = err?.message ? String(err.message).slice(0, 400) : 'Ingestion failed';
  await IngestionCursor.updateOne(
    { orgId, sourceSystem, jobName, scope },
    {
      $setOnInsert: { orgId, sourceSystem, jobName, scope, createdAt: now },
      $set: {
        lastErrorAt: now,
        lastErrorCode: code ? String(code).slice(0, 60) : undefined,
        lastErrorMessage: message,
        updatedAt: now
      }
    },
    { upsert: true }
  );
}

function extractBambooEmployees(directoryPayload) {
  if (!directoryPayload) return [];
  if (Array.isArray(directoryPayload)) return directoryPayload;

  // Common Bamboo shapes
  if (Array.isArray(directoryPayload.employees)) return directoryPayload.employees;
  if (Array.isArray(directoryPayload.employees?.employee)) return directoryPayload.employees.employee;
  if (Array.isArray(directoryPayload.directory)) return directoryPayload.directory;

  return [];
}

function toUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function minutesBetween(start, end) {
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 60000);
}

function getEventStartEnd(event) {
  const startRaw = event?.start?.dateTime || event?.start?.date;
  const endRaw = event?.end?.dateTime || event?.end?.date;
  if (!startRaw || !endRaw) return null;
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  // Ignore all-day events (date only) for metrics
  const isAllDay = Boolean(event?.start?.date && !event?.start?.dateTime);
  if (isAllDay) return null;
  return { start, end };
}

async function upsertCalendarMetricsDaily({ orgId, employeeId, day, increments }) {
  const existing = await CalendarMetricsDaily.findOne({ orgId, employeeId, day });
  const next = {
    meetingCount: (existing?.meetingCount || 0) + (increments.meetingCount || 0),
    meetingMinutes: (existing?.meetingMinutes || 0) + (increments.meetingMinutes || 0),
    afterHoursMeetingCount:
      (existing?.afterHoursMeetingCount || 0) + (increments.afterHoursMeetingCount || 0),
    backToBackCount: (existing?.backToBackCount || 0) + (increments.backToBackCount || 0),
    declinedCount: (existing?.declinedCount || 0) + (increments.declinedCount || 0),
    updatedAt: new Date()
  };

  await CalendarMetricsDaily.updateOne(
    { orgId, employeeId, day },
    {
      $setOnInsert: { orgId, employeeId, day, createdAt: new Date() },
      $set: next
    },
    { upsert: true }
  );
}

// GET /api/ingest/cursors?sourceSystem=slack&jobName=users&scope=
router.get('/cursors', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    await ensureOrganization(orgId);
    const sourceSystem = req.query.sourceSystem ? String(req.query.sourceSystem).trim() : undefined;
    const jobName = req.query.jobName ? String(req.query.jobName).trim() : undefined;
    const scope = req.query.scope !== undefined ? String(req.query.scope) : undefined;

    const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : 100;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    const filter = { orgId };
    if (sourceSystem) filter.sourceSystem = sourceSystem;
    if (jobName) filter.jobName = jobName;
    if (scope !== undefined) filter.scope = scope;

    const cursors = await IngestionCursor.find(filter, {
      _id: 0,
      orgId: 1,
      sourceSystem: 1,
      jobName: 1,
      scope: 1,
      lastRunAt: 1,
      lastSuccessAt: 1,
      lastErrorAt: 1,
      lastErrorCode: 1,
      lastErrorMessage: 1,
      lastCursor: 1,
      lastHash: 1,
      lastStats: 1,
      createdAt: 1,
      updatedAt: 1
    })
      .sort({ updatedAt: -1, lastRunAt: -1, sourceSystem: 1, jobName: 1, scope: 1 })
      .limit(limit)
      .lean();

    res.json({ ok: true, orgId, count: cursors.length, cursors });
  } catch (err) {
    next(err);
  }
});

// POST /api/ingest/slack/channels?snapshotAt=YYYY-MM-DD&incremental=true
router.post('/slack/channels', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    await ensureOrganization(orgId);

    const asOf = getAsOf(req);
    const incremental = parseBool(req.query.incremental, true);
    const jobName = 'channels';

    const types = req.query.types ? String(req.query.types) : 'public_channel,private_channel';
    const limit = clampInt(req.query.limit !== undefined ? req.query.limit : 200, {
      min: 1,
      max: 500,
      fallback: 200
    });

    const cursorBefore = incremental
      ? await IngestionCursor.findOne({ orgId, sourceSystem: 'slack', jobName, scope: '' }).lean()
      : null;

    const channels = [];
    let cursor = undefined;
    let page = 0;

    while (page < 30) {
      // eslint-disable-next-line no-await-in-loop
      const resp = await conversationsList({ types, limit, cursor });
      const pageChannels = ensureArray(resp?.channels);
      channels.push(...pageChannels);
      cursor = resp?.response_metadata?.next_cursor;
      cursor = cursor && String(cursor).trim() !== '' ? String(cursor).trim() : null;
      page += 1;
      if (!cursor) break;
    }

    const channelsSortedForHash = [...channels].sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
    const channelsHash = hashObject({ channels: channelsSortedForHash });

    if (incremental && cursorBefore?.lastHash && String(cursorBefore.lastHash) === String(channelsHash)) {
      const existingDoc = await Document.findOne(
        { orgId, sourceSystem: 'slack', externalId: 'slack:conversations:list' },
        { _id: 1 }
      ).lean();

      await upsertIngestionCursorSuccess({
        orgId,
        sourceSystem: 'slack',
        jobName,
        hash: channelsHash,
        stats: {
          snapshotAt: asOf.toISOString(),
          channelsSeen: channels.length,
          reason: 'hash_unchanged'
        }
      });

      return res.json({
        ok: true,
        data: {
          orgId,
          snapshotAt: asOf.toISOString(),
          channelsSeen: channels.length,
          channelsDocumentId: existingDoc?._id
        }
      });
    }

    const channelsDoc = await Document.findOneAndUpdate(
      { orgId, sourceSystem: 'slack', externalId: 'slack:conversations:list' },
      {
        $setOnInsert: {
          orgId,
          documentType: 'slack_channel_snapshot',
          sourceSystem: 'slack',
          externalId: 'slack:conversations:list'
        },
        $set: {
          ingestedAt: new Date(),
          sensitivity: 'standard',
          contentHash: channelsHash,
          metadata: { snapshotAt: asOf.toISOString(), channelCount: channels.length, incremental, types },
          raw: { ok: true, channels }
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await upsertIngestionCursorSuccess({
      orgId,
      sourceSystem: 'slack',
      jobName,
      hash: channelsHash,
      stats: {
        snapshotAt: asOf.toISOString(),
        channelsSeen: channels.length
      }
    });

    res.json({
      ok: true,
      data: {
        orgId,
        snapshotAt: asOf.toISOString(),
        channelsSeen: channels.length,
        channelsDocumentId: channelsDoc._id,
        channelIds: channels.map((c) => c?.id).filter(Boolean)
      }
    });
  } catch (err) {
    try {
      const orgId = getOrgId(req);
      await upsertIngestionCursorError({ orgId, sourceSystem: 'slack', jobName: 'channels', err });
    } catch (_) {
      // ignore
    }
    next(err);
  }
});

// POST /api/ingest/slack/channels/:channelId/messages?incremental=true&daysBack=7&includeReplies=false
router.post('/slack/channels/:channelId/messages', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    await ensureOrganization(orgId);

    const channelId = String(req.params.channelId || '').trim();
    if (!channelId) throw new HttpError(400, 'Missing channelId', 'BAD_REQUEST');

    const incremental = parseBool(req.query.incremental, true);
    const includeReplies = parseBool(req.query.includeReplies, false);
    const daysBack = clampInt(req.query.daysBack !== undefined ? req.query.daysBack : 7, {
      min: 0,
      max: 365,
      fallback: 7
    });

    const jobName = 'channel_messages';
    const scope = channelId;

    const cursorBefore = incremental
      ? await IngestionCursor.findOne({ orgId, sourceSystem: 'slack', jobName, scope }).lean()
      : null;

    const oldest = req.query.oldest
      ? String(req.query.oldest)
      : incremental && cursorBefore?.lastCursor
        ? String(cursorBefore.lastCursor)
        : slackTsNowMinusDays(daysBack);

    const historyMessages = [];
    let cursor = undefined;
    let page = 0;

    while (page < 50) {
      // eslint-disable-next-line no-await-in-loop
      const resp = await conversationsHistory(channelId, { limit: 200, cursor, oldest, inclusive: false });
      historyMessages.push(...ensureArray(resp?.messages));
      cursor = resp?.response_metadata?.next_cursor;
      cursor = cursor && String(cursor).trim() !== '' ? String(cursor).trim() : null;
      page += 1;
      if (!cursor) break;
    }

    const replyMessages = [];
    if (includeReplies) {
      const threads = historyMessages
        .filter((m) => Number(m?.reply_count || 0) > 0)
        .map((m) => String(m?.thread_ts || m?.ts || '').trim())
        .filter((ts) => ts !== '');

      const uniqThreads = Array.from(new Set(threads)).slice(0, 50);
      for (const threadTs of uniqThreads) {
        let rCursor = undefined;
        let rPage = 0;
        while (rPage < 20) {
          // eslint-disable-next-line no-await-in-loop
          const resp = await conversationsReplies(channelId, threadTs, {
            limit: 200,
            cursor: rCursor,
            oldest,
            inclusive: false
          });
          replyMessages.push(...ensureArray(resp?.messages));
          rCursor = resp?.response_metadata?.next_cursor;
          rCursor = rCursor && String(rCursor).trim() !== '' ? String(rCursor).trim() : null;
          rPage += 1;
          if (!rCursor) break;
        }
      }
    }

    // Merge and de-dup by ts.
    const all = [...historyMessages, ...replyMessages];
    const seenTs = new Set();
    const messages = [];
    for (const m of all) {
      const ts = String(m?.ts || '').trim();
      if (!ts || seenTs.has(ts)) continue;
      seenTs.add(ts);
      messages.push(m);
    }

    const watermarkTs = maxSlackTs(messages) || String(cursorBefore?.lastCursor || oldest);

    const docOps = [];
    const externalIds = [];
    for (const m of messages) {
      const ts = String(m?.ts || '').trim();
      if (!ts) continue;
      const externalId = `slack:message:${channelId}:${ts}`;
      externalIds.push(externalId);

      const text = typeof m?.text === 'string' ? m.text : '';

      docOps.push({
        updateOne: {
          filter: { orgId, sourceSystem: 'slack', externalId },
          update: {
            $setOnInsert: {
              orgId,
              documentType: 'slack_message',
              sourceSystem: 'slack',
              externalId
            },
            $set: {
              ingestedAt: new Date(),
              sensitivity: 'standard',
              content: text || undefined,
              metadata: {
                channelId,
                ts,
                user: m?.user,
                bot_id: m?.bot_id,
                subtype: m?.subtype,
                thread_ts: m?.thread_ts,
                reply_count: m?.reply_count
              },
              raw: m
            }
          },
          upsert: true
        }
      });
    }

    if (docOps.length) await Document.bulkWrite(docOps, { ordered: false });

    // Link participants where Slack identity is already linked to an employee.
    const linkedSlack = await ExternalIdentity.find(
      { orgId, sourceSystem: 'slack', employeeId: { $type: 'string' } },
      { externalUserId: 1, employeeId: 1 }
    ).lean();
    const slackUserToEmployeeId = new Map(
      linkedSlack
        .map((x) => [String(x.externalUserId || ''), String(x.employeeId || '')])
        .filter(([k, v]) => k && v)
    );

    const participantsOps = [];
    if (externalIds.length && slackUserToEmployeeId.size) {
      const docs = await Document.find(
        { orgId, sourceSystem: 'slack', externalId: { $in: externalIds } },
        { _id: 1, metadata: 1 }
      ).lean();

      for (const d of docs) {
        const slackUserId = String(d?.metadata?.user || '').trim();
        const employeeId = slackUserToEmployeeId.get(slackUserId);
        if (!employeeId) continue;
        participantsOps.push({
          updateOne: {
            filter: { orgId, documentId: d._id, employeeId },
            update: {
              $setOnInsert: {
                orgId,
                documentId: d._id,
                employeeId,
                matchMethod: 'hrms_key',
                matchConfidence: 1
              }
            },
            upsert: true
          }
        });
      }
    }

    if (participantsOps.length) await DocumentParticipant.bulkWrite(participantsOps, { ordered: false });

    await upsertIngestionCursorSuccess({
      orgId,
      sourceSystem: 'slack',
      jobName,
      scope,
      cursor: watermarkTs,
      stats: {
        channelId,
        oldest,
        watermarkTs,
        messagesSeen: messages.length,
        historyMessages: historyMessages.length,
        replyMessages: replyMessages.length,
        documentsUpserted: docOps.length,
        participantsUpserted: participantsOps.length,
        includeReplies
      }
    });

    res.json({
      ok: true,
      data: {
        orgId,
        channelId,
        oldest,
        watermarkTs,
        messagesSeen: messages.length,
        documentsUpserted: docOps.length,
        participantsUpserted: participantsOps.length,
        includeReplies
      }
    });
  } catch (err) {
    try {
      const orgId = getOrgId(req);
      const channelId = String(req.params.channelId || '').trim();
      await upsertIngestionCursorError({
        orgId,
        sourceSystem: 'slack',
        jobName: 'channel_messages',
        scope: channelId,
        err
      });
    } catch (_) {
      // ignore
    }
    next(err);
  }
});

// POST /api/ingest/bamboohr/directory?snapshotAt=YYYY-MM-DD
router.post('/bamboohr/directory', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    await ensureOrganization(orgId);
    const asOf = getAsOf(req);
    const incremental = parseBool(req.query.incremental, true);
    const jobName = 'directory';

    const cursorBefore = incremental
      ? await IngestionCursor.findOne({ orgId, sourceSystem: 'bamboohr', jobName, scope: '' }).lean()
      : null;

    const directory = await getEmployeeDirectory();
    const employees = extractBambooEmployees(directory);

    // Build a stable hash for the whole payload (mainly for cursor visibility).
    const employeesSortedForHash = [...employees].sort((a, b) => {
      const aId = String(a?.id || a?.employeeId || '');
      const bId = String(b?.id || b?.employeeId || '');
      return aId.localeCompare(bId);
    });
    const directoryHash = hashObject({ employees: employeesSortedForHash });

    if (incremental && cursorBefore?.lastHash && String(cursorBefore.lastHash) === String(directoryHash)) {
      const existingDoc = await Document.findOne(
        { orgId, sourceSystem: 'bamboohr', externalId: 'bamboohr:employees:directory' },
        { _id: 1 }
      ).lean();

      const hasEmail = employees.reduce((acc, e) => {
        const email = normalizeEmail(e?.workEmail || e?.email || e?.workEmailAddress || '');
        return acc + (email ? 1 : 0);
      }, 0);

      await upsertIngestionCursorSuccess({
        orgId,
        sourceSystem: 'bamboohr',
        jobName,
        hash: directoryHash,
        stats: {
          snapshotAt: asOf.toISOString(),
          employeesSeen: employees.length,
          employeesUpserted: 0,
          employeesSkippedUnchanged: employees.length,
          identitySnapshotsUpserted: 0,
          employmentSnapshotsUpserted: 0,
          reason: 'hash_unchanged'
        }
      });

      return res.json({
        ok: true,
        data: {
          orgId,
          snapshotAt: asOf.toISOString(),
          employeesSeen: employees.length,
          employeesUpserted: 0,
          employeesSkippedUnchanged: employees.length,
          identitySnapshotsUpserted: 0,
          employmentSnapshotsUpserted: 0,
          identityCountByField: { hasEmail },
          directoryDocumentId: existingDoc?._id
        }
      });
    }

    const directoryDoc = await Document.findOneAndUpdate(
      { orgId, sourceSystem: 'bamboohr', externalId: 'bamboohr:employees:directory' },
      {
        $setOnInsert: {
          orgId,
          documentType: 'hrms_snapshot',
          sourceSystem: 'bamboohr',
          externalId: 'bamboohr:employees:directory'
        },
        $set: {
          ingestedAt: new Date(),
          sensitivity: 'sensitive',
          contentHash: directoryHash,
          metadata: {
            snapshotAt: asOf.toISOString(),
            employeeCount: employees.length,
            incremental
          },
          raw: directory
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const bambooIds = Array.from(
      new Set(
        employees
          .map((e) => String(e?.id || e?.employeeId || '').trim())
          .filter((id) => id !== '')
      )
    );

    const existingEmployees = bambooIds.length
      ? await Employee.find(
          { orgId, employeeId: { $in: bambooIds } },
          { employeeId: 1, bamboohrDirectoryHash: 1 }
        ).lean()
      : [];
    const existingHashByEmployeeId = new Map(
      existingEmployees.map((e) => [String(e.employeeId), String(e.bamboohrDirectoryHash || '')])
    );

    const employeeOps = [];
    const identityOps = [];
    const employmentOps = [];
    const externalIdentityOps = [];
    const identityCountByField = { hasEmail: 0 };

    let skippedUnchangedEmployees = 0;

    for (const e of employees) {
      const bamboohrEmployeeId = String(e?.id || e?.employeeId || '').trim();
      if (!bamboohrEmployeeId) continue;

      const employeeId = bamboohrEmployeeId;
      const entryHash = hashObject(e);
      const existingHash = existingHashByEmployeeId.get(employeeId);
      if (incremental && existingHash && existingHash === entryHash) {
        skippedUnchangedEmployees += 1;
        continue;
      }

      const workEmail = normalizeEmail(e?.workEmail || e?.email || e?.workEmailAddress || '');
      const fullName = String(e?.displayName || e?.fullName || e?.name || '').trim();

      if (workEmail) identityCountByField.hasEmail += 1;

      employeeOps.push({
        updateOne: {
          filter: { orgId, employeeId },
          update: {
            $setOnInsert: { orgId, employeeId, createdAt: new Date() },
            $set: {
              bamboohrEmployeeId,
              workEmail: workEmail || undefined,
              fullName: fullName || undefined,
              bamboohrDirectoryHash: entryHash,
              bamboohrLastSeenAt: new Date(),
              updatedAt: new Date(),
              status: 'active'
            }
          },
          upsert: true
        }
      });

      identityOps.push({
        updateOne: {
          filter: { orgId, employeeId, asOf, sourceSystem: 'bamboohr' },
          update: {
            $setOnInsert: { orgId, employeeId, asOf, sourceSystem: 'bamboohr', createdAt: new Date() },
            $set: {
              sourceDocumentId: directoryDoc._id,
              fullName: fullName || undefined,
              workEmail: workEmail || undefined,
              data: e
            }
          },
          upsert: true
        }
      });

      employmentOps.push({
        updateOne: {
          filter: { orgId, employeeId, asOf, sourceSystem: 'bamboohr' },
          update: {
            $setOnInsert: { orgId, employeeId, asOf, sourceSystem: 'bamboohr', createdAt: new Date() },
            $set: {
              sourceDocumentId: directoryDoc._id,
              jobTitle: e?.jobTitle,
              department: e?.department,
              division: e?.division,
              location: e?.location,
              managerName: e?.supervisor || e?.manager || e?.supervisorName,
              data: e
            }
          },
          upsert: true
        }
      });

      // External identity (BambooHR employee is canonical, so we link it immediately)
      externalIdentityOps.push({
        updateOne: {
          filter: { orgId, sourceSystem: 'bamboohr', externalUserId: bamboohrEmployeeId },
          update: {
            $setOnInsert: {
              orgId,
              sourceSystem: 'bamboohr',
              externalUserId: bamboohrEmployeeId,
              createdAt: new Date()
            },
            $set: {
              employeeId,
              email: workEmail || undefined,
              displayName: fullName || undefined,
              matchMethod: workEmail ? 'email_exact' : 'manual',
              matchConfidence: workEmail ? 1 : 0.5,
              updatedAt: new Date()
            }
          },
          upsert: true
        }
      });
    }

    if (employeeOps.length) await Employee.bulkWrite(employeeOps, { ordered: false });
    if (identityOps.length) await HrmsIdentitySnapshot.bulkWrite(identityOps, { ordered: false });
    if (employmentOps.length) await HrmsEmploymentSnapshot.bulkWrite(employmentOps, { ordered: false });
    if (externalIdentityOps.length) await ExternalIdentity.bulkWrite(externalIdentityOps, { ordered: false });

    await upsertIngestionCursorSuccess({
      orgId,
      sourceSystem: 'bamboohr',
      jobName,
      hash: directoryHash,
      stats: {
        snapshotAt: asOf.toISOString(),
        employeesSeen: employees.length,
        employeesUpserted: employeeOps.length,
        employeesSkippedUnchanged: skippedUnchangedEmployees,
        identitySnapshotsUpserted: identityOps.length,
        employmentSnapshotsUpserted: employmentOps.length
      }
    });

    res.json({
      ok: true,
      data: {
        orgId,
        snapshotAt: asOf.toISOString(),
        employeesSeen: employees.length,
        employeesUpserted: employeeOps.length,
        employeesSkippedUnchanged: skippedUnchangedEmployees,
        identitySnapshotsUpserted: identityOps.length,
        employmentSnapshotsUpserted: employmentOps.length,
        identityCountByField,
        directoryDocumentId: directoryDoc._id
      }
    });
  } catch (err) {
    try {
      const orgId = getOrgId(req);
      await upsertIngestionCursorError({ orgId, sourceSystem: 'bamboohr', jobName: 'directory', err });
    } catch (_) {
      // ignore
    }
    next(err);
  }
});

// POST /api/ingest/bamboohr/employees/:id?fields=field1,field2&snapshotAt=YYYY-MM-DD
router.post('/bamboohr/employees/:id', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    await ensureOrganization(orgId);
    const asOf = getAsOf(req);

    const bamboohrEmployeeId = String(req.params.id || '').trim();
    if (!bamboohrEmployeeId) {
      throw new HttpError(400, 'Missing BambooHR employee id', 'VALIDATION_ERROR');
    }

    const fields = req.query.fields;
    const profile = await getEmployeeById(bamboohrEmployeeId, fields);

    const employeeId = bamboohrEmployeeId;
    const workEmail = normalizeEmail(profile?.workEmail || profile?.email || '');
    const firstName = String(profile?.firstName || '').trim();
    const lastName = String(profile?.lastName || '').trim();
    const fullName = String(profile?.displayName || `${firstName} ${lastName}`.trim()).trim();

    const profileExternalId = `bamboohr:employee:${bamboohrEmployeeId}:${asOf.toISOString()}`;
    const profileDoc = await Document.findOneAndUpdate(
      { orgId, sourceSystem: 'bamboohr', externalId: profileExternalId },
      {
        $setOnInsert: {
          orgId,
          documentType: 'hrms_profile',
          sourceSystem: 'bamboohr',
          externalId: profileExternalId
        },
        $set: {
          ingestedAt: new Date(),
          sensitivity: 'sensitive',
          metadata: { snapshotAt: asOf.toISOString(), bamboohrEmployeeId },
          raw: profile
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await Employee.updateOne(
      { orgId, employeeId },
      {
        $setOnInsert: { orgId, employeeId, createdAt: new Date() },
        $set: {
          bamboohrEmployeeId,
          workEmail: workEmail || undefined,
          fullName: fullName || undefined,
          updatedAt: new Date(),
          status: 'active'
        }
      },
      { upsert: true }
    );

    await ExternalIdentity.updateOne(
      { orgId, sourceSystem: 'bamboohr', externalUserId: bamboohrEmployeeId },
      {
        $setOnInsert: { orgId, sourceSystem: 'bamboohr', externalUserId: bamboohrEmployeeId, createdAt: new Date() },
        $set: {
          employeeId,
          email: workEmail || undefined,
          displayName: fullName || undefined,
          matchMethod: workEmail ? 'email_exact' : 'manual',
          matchConfidence: workEmail ? 1 : 0.5,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    const upserts = [];

    upserts.push(
      HrmsIdentitySnapshot.updateOne(
        { orgId, employeeId, asOf, sourceSystem: 'bamboohr' },
        {
          $setOnInsert: { orgId, employeeId, asOf, sourceSystem: 'bamboohr', createdAt: new Date() },
          $set: {
            sourceDocumentId: profileDoc._id,
            fullName: fullName || undefined,
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            workEmail: workEmail || undefined,
            phone: profile?.workPhone || profile?.mobilePhone,
            data: profile
          }
        },
        { upsert: true }
      )
    );

    upserts.push(
      HrmsEmploymentSnapshot.updateOne(
        { orgId, employeeId, asOf, sourceSystem: 'bamboohr' },
        {
          $setOnInsert: { orgId, employeeId, asOf, sourceSystem: 'bamboohr', createdAt: new Date() },
          $set: {
            sourceDocumentId: profileDoc._id,
            status: profile?.status,
            jobTitle: profile?.jobTitle,
            department: profile?.department,
            division: profile?.division,
            location: profile?.location,
            managerName: profile?.supervisor,
            data: profile
          }
        },
        { upsert: true }
      )
    );

    upserts.push(
      HrmsTenureMobilitySnapshot.updateOne(
        { orgId, employeeId, asOf, sourceSystem: 'bamboohr' },
        {
          $setOnInsert: { orgId, employeeId, asOf, sourceSystem: 'bamboohr', createdAt: new Date() },
          $set: {
            sourceDocumentId: profileDoc._id,
            hireDate: profile?.hireDate ? new Date(profile.hireDate) : undefined,
            startDate: profile?.startDate ? new Date(profile.startDate) : undefined,
            data: profile
          }
        },
        { upsert: true }
      )
    );

    // These domains may not be present in BambooHR detail payload depending on tenant; we still store the raw profile in `data`.
    upserts.push(
      HrmsCompensationSnapshot.updateOne(
        { orgId, employeeId, asOf, sourceSystem: 'bamboohr' },
        {
          $setOnInsert: { orgId, employeeId, asOf, sourceSystem: 'bamboohr', createdAt: new Date() },
          $set: { sourceDocumentId: profileDoc._id, data: profile }
        },
        { upsert: true }
      )
    );

    upserts.push(
      HrmsPerformanceSnapshot.updateOne(
        { orgId, employeeId, asOf, sourceSystem: 'bamboohr' },
        {
          $setOnInsert: { orgId, employeeId, asOf, sourceSystem: 'bamboohr', createdAt: new Date() },
          $set: { sourceDocumentId: profileDoc._id, data: profile }
        },
        { upsert: true }
      )
    );

    upserts.push(
      HrmsAttendanceLeaveSnapshot.updateOne(
        { orgId, employeeId, asOf, sourceSystem: 'bamboohr' },
        {
          $setOnInsert: { orgId, employeeId, asOf, sourceSystem: 'bamboohr', createdAt: new Date() },
          $set: { sourceDocumentId: profileDoc._id, data: profile }
        },
        { upsert: true }
      )
    );

    upserts.push(
      HrmsOffboardingSnapshot.updateOne(
        { orgId, employeeId, asOf, sourceSystem: 'bamboohr' },
        {
          $setOnInsert: { orgId, employeeId, asOf, sourceSystem: 'bamboohr', createdAt: new Date() },
          $set: {
            sourceDocumentId: profileDoc._id,
            terminationDate: profile?.terminationDate ? new Date(profile.terminationDate) : undefined,
            terminationReason: profile?.terminationReason,
            data: profile
          }
        },
        { upsert: true }
      )
    );

    await Promise.all(upserts);

    res.json({
      ok: true,
      data: {
        orgId,
        employeeId,
        bamboohrEmployeeId,
        snapshotAt: asOf.toISOString(),
        hrmsProfileDocumentId: profileDoc._id
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ingest/slack/users?snapshotAt=YYYY-MM-DD
router.post('/slack/users', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    await ensureOrganization(orgId);
    const asOf = getAsOf(req);
    const incremental = parseBool(req.query.incremental, true);
    const jobName = 'users';

    const cursorBefore = incremental
      ? await IngestionCursor.findOne({ orgId, sourceSystem: 'slack', jobName, scope: '' }).lean()
      : null;

    const users = [];
    let cursor = undefined;
    let page = 0;

    while (page < 20) {
      const resp = await usersList({ limit: 200, cursor });
      const members = ensureArray(resp?.members);
      users.push(...members);
      cursor = resp?.response_metadata?.next_cursor;
      cursor = cursor && String(cursor).trim() !== '' ? String(cursor).trim() : null;
      page += 1;
      if (!cursor) break;
    }

    const usersSortedForHash = [...users].sort((a, b) => {
      const aId = String(a?.id || '');
      const bId = String(b?.id || '');
      return aId.localeCompare(bId);
    });
    const usersHash = hashObject({ members: usersSortedForHash });

    if (incremental && cursorBefore?.lastHash && String(cursorBefore.lastHash) === String(usersHash)) {
      const existingDoc = await Document.findOne(
        { orgId, sourceSystem: 'slack', externalId: 'slack:users:list' },
        { _id: 1 }
      ).lean();

      await upsertIngestionCursorSuccess({
        orgId,
        sourceSystem: 'slack',
        jobName,
        hash: usersHash,
        stats: {
          snapshotAt: asOf.toISOString(),
          slackUsersSeen: users.length,
          identitiesUpserted: 0,
          identitiesCreated: 0,
          identitiesUpdated: 0,
          identitiesSkippedUnchanged: users.length,
          linkedCount: 0,
          unlinkedCount: 0,
          reason: 'hash_unchanged'
        }
      });

      return res.json({
        ok: true,
        data: {
          orgId,
          snapshotAt: asOf.toISOString(),
          slackUsersSeen: users.length,
          identitiesUpserted: 0,
          identitiesCreated: 0,
          identitiesUpdated: 0,
          identitiesSkippedUnchanged: users.length,
          linkedCount: 0,
          unlinkedCount: 0,
          slackUsersDocumentId: existingDoc?._id
        }
      });
    }

    const usersDoc = await Document.findOneAndUpdate(
      { orgId, sourceSystem: 'slack', externalId: 'slack:users:list' },
      {
        $setOnInsert: {
          orgId,
          documentType: 'slack_user_snapshot',
          sourceSystem: 'slack',
          externalId: 'slack:users:list'
        },
        $set: {
          ingestedAt: new Date(),
          sensitivity: 'standard',
          contentHash: usersHash,
          metadata: { snapshotAt: asOf.toISOString(), userCount: users.length, incremental },
          raw: { ok: true, members: users }
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    let linkedCount = 0;
    let unlinkedCount = 0;

    let identitiesCreated = 0;
    let identitiesUpdated = 0;
    let identitiesSkippedUnchanged = 0;

    const identityOps = [];

    // Preload email->employeeId for current org (to avoid per-user queries)
    const employees = await Employee.find(
      { orgId, workEmail: { $type: 'string' } },
      { employeeId: 1, workEmail: 1 }
    ).lean();
    const emailToEmployeeId = new Map();
    for (const e of employees) {
      const email = normalizeEmail(e?.workEmail);
      if (email) emailToEmployeeId.set(email, e.employeeId);
    }

    const slackUserIds = users
      .map((u) => String(u?.id || '').trim())
      .filter((id) => id !== '');

    const existingIdentities = slackUserIds.length
      ? await ExternalIdentity.find(
          { orgId, sourceSystem: 'slack', externalUserId: { $in: slackUserIds } },
          { externalUserId: 1, employeeId: 1, email: 1, displayName: 1, matchMethod: 1, matchConfidence: 1 }
        ).lean()
      : [];
    const existingByExternalUserId = new Map(
      existingIdentities.map((x) => [String(x.externalUserId), x])
    );

    for (const u of users) {
      const slackUserId = String(u?.id || '').trim();
      if (!slackUserId) continue;

      const email = normalizeEmail(u?.profile?.email || '');
      const displayName = String(u?.profile?.real_name || u?.profile?.display_name || u?.name || '').trim();

      let employeeId = null;
      let matchMethod = 'unlinked';
      let matchConfidence = 0;

      if (email) {
        const matchedEmployeeId = emailToEmployeeId.get(email);
        if (matchedEmployeeId) {
          employeeId = matchedEmployeeId;
          matchMethod = 'email_exact';
          matchConfidence = 1;
          linkedCount += 1;
        } else {
          unlinkedCount += 1;
        }
      } else {
        unlinkedCount += 1;
      }

      const existing = existingByExternalUserId.get(slackUserId);
      const desired = {
        employeeId: employeeId || undefined,
        email: email || undefined,
        displayName: displayName || undefined,
        matchMethod,
        matchConfidence
      };

      const isUnchanged =
        Boolean(existing) &&
        String(existing.employeeId || '') === String(desired.employeeId || '') &&
        String(existing.email || '') === String(desired.email || '') &&
        String(existing.displayName || '') === String(desired.displayName || '') &&
        String(existing.matchMethod || '') === String(desired.matchMethod || '') &&
        Number(existing.matchConfidence || 0) === Number(desired.matchConfidence || 0);

      if (incremental && isUnchanged) {
        identitiesSkippedUnchanged += 1;
        continue;
      }

      if (!existing) identitiesCreated += 1;
      else identitiesUpdated += 1;

      identityOps.push({
        updateOne: {
          filter: { orgId, sourceSystem: 'slack', externalUserId: slackUserId },
          update: {
            $setOnInsert: { orgId, sourceSystem: 'slack', externalUserId: slackUserId, createdAt: new Date() },
            $set: {
              ...desired,
              updatedAt: new Date()
            }
          },
          upsert: true
        }
      });
    }

    if (identityOps.length) await ExternalIdentity.bulkWrite(identityOps, { ordered: false });

    await upsertIngestionCursorSuccess({
      orgId,
      sourceSystem: 'slack',
      jobName,
      hash: usersHash,
      stats: {
        snapshotAt: asOf.toISOString(),
        slackUsersSeen: users.length,
        identitiesUpserted: identityOps.length,
        identitiesCreated,
        identitiesUpdated,
        identitiesSkippedUnchanged,
        linkedCount,
        unlinkedCount
      }
    });

    res.json({
      ok: true,
      data: {
        orgId,
        snapshotAt: asOf.toISOString(),
        slackUsersSeen: users.length,
        identitiesUpserted: identityOps.length,
        identitiesCreated,
        identitiesUpdated,
        identitiesSkippedUnchanged,
        linkedCount,
        unlinkedCount,
        slackUsersDocumentId: usersDoc._id
      }
    });
  } catch (err) {
    try {
      const orgId = getOrgId(req);
      await upsertIngestionCursorError({ orgId, sourceSystem: 'slack', jobName: 'users', err });
    } catch (_) {
      // ignore
    }
    next(err);
  }
});

// POST /api/ingest/calendar/events?calendarId=primary&pastDays=14&futureDays=7
router.post('/calendar/events', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    await ensureOrganization(orgId);
    const calendarId = String(req.query.calendarId || 'primary');
    const pastDays = Number.parseInt(String(req.query.pastDays || '14'), 10);
    const futureDays = Number.parseInt(String(req.query.futureDays || '7'), 10);

    const tokens = await readTokens();
    if (!tokens) {
      throw new HttpError(400, 'Google tokens not found. Complete OAuth first via /api/calendar/google/oauth/start', 'GOOGLE_TOKENS_MISSING');
    }

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(tokens);

    const now = new Date();
    const timeMin = new Date(now.getTime() - (Number.isFinite(pastDays) ? pastDays : 14) * 86400000);
    const timeMax = new Date(now.getTime() + (Number.isFinite(futureDays) ? futureDays : 7) * 86400000);

    const payload = await listEvents(oauth2Client, {
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 250
    });

    const items = ensureArray(payload?.items);

    // Preload email->employeeId map for current org
    const employees = await Employee.find({ orgId, workEmail: { $type: 'string' } }, { employeeId: 1, workEmail: 1 }).lean();
    const emailToEmployeeId = new Map();
    for (const e of employees) {
      const email = normalizeEmail(e?.workEmail);
      if (email) emailToEmployeeId.set(email, e.employeeId);
    }

    const docOps = [];
    const docsByExternal = new Map();

    for (const ev of items) {
      const eventId = String(ev?.id || '').trim();
      if (!eventId) continue;
      const externalId = `google_calendar:${calendarId}:${eventId}`;

      docOps.push({
        updateOne: {
          filter: { orgId, sourceSystem: 'google_calendar', externalId },
          update: {
            $setOnInsert: {
              orgId,
              documentType: 'calendar_event',
              sourceSystem: 'google_calendar',
              externalId,
              createdAt: new Date()
            },
            $set: {
              ingestedAt: new Date(),
              sensitivity: 'standard',
              content: ev?.summary,
              metadata: {
                calendarId,
                summary: ev?.summary,
                status: ev?.status,
                start: ev?.start,
                end: ev?.end,
                organizer: ev?.organizer,
                attendeesCount: ensureArray(ev?.attendees).length
              },
              raw: ev
            }
          },
          upsert: true
        }
      });
      docsByExternal.set(externalId, ev);
    }

    if (docOps.length) await Document.bulkWrite(docOps, { ordered: false });

    // Fetch the documents we just upserted (so we can attach participants)
    const externalIds = Array.from(docsByExternal.keys());
    const storedDocs = await Document.find({ orgId, sourceSystem: 'google_calendar', externalId: { $in: externalIds } }).lean();
    const docIdByExternalId = new Map(storedDocs.map((d) => [d.externalId, d._id]));

    const participantOps = [];
    const eventsByEmployeeDay = new Map(); // key: employeeId|dayIso -> intervals

    for (const externalId of externalIds) {
      const docId = docIdByExternalId.get(externalId);
      const ev = docsByExternal.get(externalId);
      if (!docId || !ev) continue;

      const attendees = ensureArray(ev?.attendees);
      const timing = getEventStartEnd(ev);

      for (const a of attendees) {
        const email = normalizeEmail(a?.email || '');
        if (!email) continue;
        const employeeId = emailToEmployeeId.get(email);
        if (!employeeId) continue;

        participantOps.push({
          updateOne: {
            filter: { orgId, documentId: docId, employeeId },
            update: {
              $setOnInsert: {
                orgId,
                documentId: docId,
                employeeId,
                matchMethod: 'email_exact',
                matchConfidence: 1
              }
            },
            upsert: true
          }
        });

        if (timing) {
          const day = toUtcDay(timing.start);
          const key = `${employeeId}|${day.toISOString()}`;
          const arr = eventsByEmployeeDay.get(key) || [];
          arr.push({
            start: timing.start,
            end: timing.end,
            declined: String(a?.responseStatus || '').toLowerCase() === 'declined'
          });
          eventsByEmployeeDay.set(key, arr);
        }
      }
    }

    if (participantOps.length) await DocumentParticipant.bulkWrite(participantOps, { ordered: false });

    // Compute daily metrics (simple UTC-based MVP)
    for (const [key, intervals] of eventsByEmployeeDay.entries()) {
      const [employeeId, dayIso] = key.split('|');
      const day = new Date(dayIso);

      intervals.sort((a, b) => a.start.getTime() - b.start.getTime());

      let meetingCount = 0;
      let meetingMinutes = 0;
      let afterHoursMeetingCount = 0;
      let declinedCount = 0;
      let backToBackCount = 0;

      for (let i = 0; i < intervals.length; i += 1) {
        const it = intervals[i];
        meetingCount += 1;
        meetingMinutes += minutesBetween(it.start, it.end);
        if (it.declined) declinedCount += 1;

        const hr = it.start.getUTCHours();
        if (hr < 7 || hr >= 18) afterHoursMeetingCount += 1;

        const prev = i > 0 ? intervals[i - 1] : null;
        if (prev) {
          const gapMs = it.start.getTime() - prev.end.getTime();
          if (gapMs >= 0 && gapMs <= 5 * 60000) backToBackCount += 1;
        }
      }

      await upsertCalendarMetricsDaily({
        orgId,
        employeeId,
        day,
        increments: { meetingCount, meetingMinutes, afterHoursMeetingCount, declinedCount, backToBackCount }
      });
    }

    res.json({
      ok: true,
      data: {
        orgId,
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        eventsSeen: items.length,
        eventsStored: docOps.length,
        participantsStored: participantOps.length,
        metricsDaysUpdated: eventsByEmployeeDay.size
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ingest/fireflies/transcripts?limit=100&skip=0&fromDate=...&toDate=...&syncHrToCalendar=true
router.post('/fireflies/transcripts', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    await ensureOrganization(orgId);

    const limit = clampInt(req.query.limit !== undefined ? req.query.limit : req.body?.limit, {
      min: 1,
      max: 250,
      fallback: 100,
    });
    const skip = clampInt(req.query.skip !== undefined ? req.query.skip : req.body?.skip, {
      min: 0,
      max: 100000,
      fallback: 0,
    });
    const fromDate = req.query.fromDate || req.body?.fromDate;
    const toDate = req.query.toDate || req.body?.toDate;
    const syncHrToCalendar = parseBool(
      req.query.syncHrToCalendar !== undefined ? req.query.syncHrToCalendar : req.body?.syncHrToCalendar,
      true
    );
    const includeTranscriptInMeeting = parseBool(
      req.query.includeTranscriptInMeeting !== undefined
        ? req.query.includeTranscriptInMeeting
        : req.body?.includeTranscriptInMeeting,
      true
    );

    const calendarId = String(req.query.calendarId || req.body?.calendarId || 'primary').trim() || 'primary';

    const configuredHrEmails = parseEmailCsv(process.env.HR_PARTICIPANT_EMAILS);
    const requestHrEmails = parseEmailCsv(req.query.hrEmails || req.body?.hrEmails);
    const hrEmailSet = new Set([...configuredHrEmails, ...requestHrEmails]);

    const employees = await Employee.find({ orgId, workEmail: { $type: 'string' } }, { workEmail: 1 }).lean();
    const employeeEmailSet = new Set(
      employees
        .map((row) => normalizeEmail(row?.workEmail))
        .filter(Boolean)
    );

    const { transcripts } = await fetchTranscripts({ limit, skip, fromDate, toDate });

    const meetingOps = [];
    const transcriptOps = [];
    const transcriptCleanupOps = [];
    const syntheticCalendarOps = [];

    let hrInvolvedCount = 0;
    let nonHrCount = 0;

    for (const transcript of transcripts) {
      const id = String(transcript?.id || '').trim();
      if (!id) continue;

      const meetingId = `fireflies:${id}`;
      const participants = collectFirefliesParticipantEmails(transcript);
      const employeeParticipants = participants.filter(
        (email) => employeeEmailSet.has(email) && !hrEmailSet.has(email)
      );
      const anyEmployeeParticipants = participants.filter((email) => employeeEmailSet.has(email));
      const employeeEmail = employeeParticipants[0] || anyEmployeeParticipants[0] || participants[0] || 'unknown@unknown.local';

      const hrInvolved = participants.some((email) => hrEmailSet.has(email));
      if (hrInvolved) hrInvolvedCount += 1;
      else nonHrCount += 1;

      const meetingAt = parseFirefliesDate(transcript?.date) || new Date();
      const turns = toTranscriptTurns(transcript?.sentences);
      const summary = buildTranscriptSummary(transcript?.sentences);

      meetingOps.push({
        updateOne: {
          filter: { orgId, meetingId },
          update: {
            $setOnInsert: { orgId, meetingId, createdAt: new Date() },
            $set: {
              sourceSystem: 'fireflies',
              employeeEmail,
              meetingAt,
              title: String(transcript?.title || '').trim() || 'Meeting',
              summary,
              participants,
              hrInvolved,
              visibleInCalendar: hrInvolved,
              transcript: includeTranscriptInMeeting ? turns : null,
            },
          },
          upsert: true,
        },
      });

      if (turns.length) {
        for (const turn of turns) {
          transcriptOps.push({
            updateOne: {
              filter: { orgId, meetingId, turnIndex: turn.turnIndex },
              update: {
                $setOnInsert: { orgId, meetingId, turnIndex: turn.turnIndex },
                $set: {
                  speaker: turn.speaker,
                  text: turn.text,
                },
              },
              upsert: true,
            },
          });
        }

        transcriptCleanupOps.push(
          MeetingTranscriptTurn.deleteMany({ orgId, meetingId, turnIndex: { $gte: turns.length } })
        );
      }

      if (syncHrToCalendar && hrInvolved) {
        const externalId = `google_calendar:${calendarId}:fireflies:${id}`;
        syntheticCalendarOps.push({
          updateOne: {
            filter: { orgId, sourceSystem: 'google_calendar', externalId },
            update: {
              $setOnInsert: {
                orgId,
                documentType: 'calendar_event',
                sourceSystem: 'google_calendar',
                externalId,
                createdAt: new Date(),
              },
              $set: {
                ingestedAt: new Date(),
                sensitivity: 'standard',
                content: String(transcript?.title || '').trim() || 'Meeting',
                metadata: {
                  calendarId,
                  summary: String(transcript?.title || '').trim() || 'Meeting',
                  description: summary,
                  status: 'confirmed',
                  start: { dateTime: meetingAt.toISOString() },
                  end: {
                    dateTime: new Date(
                      meetingAt.getTime() + Math.max(5, Number(transcript?.duration || 0)) * 60000
                    ).toISOString(),
                  },
                  organizer: { email: participants.find((email) => hrEmailSet.has(email)) || null },
                  attendees: participants.map((email) => ({ email })),
                  attendeesCount: participants.length,
                  syncedFrom: 'fireflies',
                  firefliesTranscriptId: id,
                },
                raw: {
                  id,
                  summary: transcript?.title || null,
                  description: summary,
                  start: { dateTime: meetingAt.toISOString() },
                  end: {
                    dateTime: new Date(
                      meetingAt.getTime() + Math.max(5, Number(transcript?.duration || 0)) * 60000
                    ).toISOString(),
                  },
                  organizer: { email: participants.find((email) => hrEmailSet.has(email)) || null },
                  attendees: participants.map((email) => ({ email })),
                },
              },
            },
            upsert: true,
          },
        });
      }
    }

    if (meetingOps.length) await Meeting.bulkWrite(meetingOps, { ordered: false });
    if (transcriptOps.length) await MeetingTranscriptTurn.bulkWrite(transcriptOps, { ordered: false });
    if (transcriptCleanupOps.length) await Promise.all(transcriptCleanupOps);
    if (syntheticCalendarOps.length) await Document.bulkWrite(syntheticCalendarOps, { ordered: false });

    const transcriptHash = hashObject({
      ids: transcripts.map((row) => String(row?.id || '')).filter(Boolean).sort(),
      fromDate: fromDate || null,
      toDate: toDate || null,
    });

    await upsertIngestionCursorSuccess({
      orgId,
      sourceSystem: 'fireflies',
      jobName: 'transcripts',
      hash: transcriptHash,
      cursor: String(skip + transcripts.length),
      stats: {
        transcriptsSeen: transcripts.length,
        meetingsUpserted: meetingOps.length,
        transcriptTurnsUpserted: transcriptOps.length,
        syntheticCalendarEventsUpserted: syntheticCalendarOps.length,
        hrInvolvedCount,
        nonHrCount,
      },
    });

    res.json({
      ok: true,
      data: {
        orgId,
        transcriptsSeen: transcripts.length,
        meetingsUpserted: meetingOps.length,
        transcriptTurnsUpserted: transcriptOps.length,
        syntheticCalendarEventsUpserted: syntheticCalendarOps.length,
        hrInvolvedCount,
        nonHrCount,
        syncHrToCalendar,
        hrEmailCount: hrEmailSet.size,
      },
      warnings: hrEmailSet.size ? [] : ['No HR emails configured. Set HR_PARTICIPANT_EMAILS or pass hrEmails query/body.'],
    });
  } catch (err) {
    try {
      const orgId = getOrgId(req);
      await upsertIngestionCursorError({ orgId, sourceSystem: 'fireflies', jobName: 'transcripts', err });
    } catch (_) {
      // ignore cursor update failures
    }
    next(err);
  }
});

// POST /api/ingest/documents  (generic ingestion + optional chunks)
router.post('/documents', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    const {
      documentType,
      sourceSystem,
      externalId,
      sourceUri,
      content,
      metadata,
      raw,
      sensitivity,
      chunks
    } = req.body || {};

    if (!documentType || !sourceSystem) {
      throw new HttpError(400, 'documentType and sourceSystem are required', 'VALIDATION_ERROR');
    }

    let doc;
    if (externalId) {
      doc = await Document.findOneAndUpdate(
        { orgId, sourceSystem, externalId: String(externalId) },
        {
          $setOnInsert: {
            orgId,
            sourceSystem,
            externalId: String(externalId)
          },
          $set: {
            documentType,
            sourceUri,
            content,
            metadata,
            raw,
            sensitivity: sensitivity || 'standard',
            ingestedAt: new Date()
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } else {
      doc = await Document.create({
        orgId,
        documentType,
        sourceSystem,
        externalId,
        sourceUri,
        content,
        metadata,
        raw,
        sensitivity: sensitivity || 'standard',
        ingestedAt: new Date()
      });
    }

    const chunkArr = ensureArray(chunks);
    const chunkOps = [];
    for (const c of chunkArr) {
      if (!c || typeof c !== 'object') continue;
      const chunkIndex = Number.parseInt(String(c.chunkIndex), 10);
      if (!Number.isFinite(chunkIndex)) continue;
      const text = String(c.text || '').trim();
      if (!text) continue;

      chunkOps.push({
        updateOne: {
          filter: { orgId, documentId: doc._id, chunkIndex },
          update: {
            $setOnInsert: { orgId, documentId: doc._id, chunkIndex, createdAt: new Date() },
            $set: {
              employeeId: c.employeeId,
              text,
              tokenCount: c.tokenCount,
              startMs: c.startMs,
              endMs: c.endMs,
              embeddingVectorId: c.embeddingVectorId,
              sensitivity: c.sensitivity || sensitivity || 'standard'
            }
          },
          upsert: true
        }
      });
    }

    if (chunkOps.length) await DocumentChunk.bulkWrite(chunkOps, { ordered: false });

    res.json({ ok: true, data: { orgId, documentId: doc._id, chunksUpserted: chunkOps.length } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/ingest/external-identities/link
router.put('/external-identities/link', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    const { sourceSystem, externalUserId, employeeId } = req.body || {};

    if (!sourceSystem || !externalUserId || !employeeId) {
      throw new HttpError(400, 'sourceSystem, externalUserId, employeeId are required', 'VALIDATION_ERROR');
    }

    const employee = await Employee.findOne({ orgId, employeeId }).lean();
    if (!employee) {
      throw new HttpError(404, `Employee not found: ${employeeId}`, 'NOT_FOUND');
    }

    const result = await ExternalIdentity.updateOne(
      { orgId, sourceSystem, externalUserId },
      {
        $set: {
          employeeId,
          matchMethod: 'manual',
          matchConfidence: 1,
          updatedAt: new Date()
        },
        $setOnInsert: { orgId, sourceSystem, externalUserId, createdAt: new Date() }
      },
      { upsert: true }
    );

    res.json({ ok: true, data: { orgId, matched: result.matchedCount, modified: result.modifiedCount } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
