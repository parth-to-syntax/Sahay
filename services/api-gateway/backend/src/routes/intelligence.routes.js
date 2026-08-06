const express = require('express');
const mongoose = require('mongoose');
const { connectMongo } = require('../db/mongo');
const { getOrgId } = require('../shared/org');
const { readTokens } = require('../shared/googleTokenStore');
const { getOAuth2Client } = require('../connectors/google/googleClient');
const { listEvents } = require('../connectors/google/googleCalendar');
const Document = require('../db/models/Document');
const Meeting = require('../db/models/meeting');
const MeetingTranscriptTurn = require('../db/models/MeetingTranscriptTurn');

const router = express.Router();

function getLlmBaseUrl() {
  const raw = process.env.LLM_BASE_URL || process.env.LLM_API_BASE_URL || 'http://localhost:8080';
  return String(raw).replace(/\/+$/, '');
}

function getTimeoutMs() {
  const raw = Number.parseInt(String(process.env.LLM_PROXY_TIMEOUT_MS || '120000'), 10);
  if (!Number.isFinite(raw) || raw < 1000) return 30000;
  return Math.min(raw, 120000);
}

function asInt(value, fallback, { min = 0, max = 100000 } = {}) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(parsed, max));
}

function buildCalendarWindow({ pastDays, futureDays }) {
  const now = new Date();
  const timeMin = new Date(now.getTime() - pastDays * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + futureDays * 24 * 60 * 60 * 1000).toISOString();
  return { timeMin, timeMax };
}

function asIsoDate(value) {
  const text = value ? String(value) : '';
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toMillis(value) {
  const date = new Date(value || 0);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function clampHistoryLimit(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return 30;
  }
  return Math.max(1, Math.min(parsed, 180));
}

function byAnalyzedAtAsc(a, b) {
  return toMillis(a?.analyzedAt) - toMillis(b?.analyzedAt);
}

function getNumericScore(row, preferredKey) {
  const candidates = [
    row?.[preferredKey],
    row?.score,
    row?.value,
    row?.metricValue,
    row?.[`${preferredKey}Score`],
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return 0;
}

function buildHistorySummary(sentimentRows, riskRows) {
  const safeSentiment = Array.isArray(sentimentRows) ? [...sentimentRows].sort(byAnalyzedAtAsc) : [];
  const safeRisk = Array.isArray(riskRows) ? [...riskRows].sort(byAnalyzedAtAsc) : [];

  const firstSentiment = safeSentiment.length ? getNumericScore(safeSentiment[0], 'sentiment') : 0;
  const lastSentiment = safeSentiment.length ? getNumericScore(safeSentiment[safeSentiment.length - 1], 'sentiment') : 0;
  const firstRisk = safeRisk.length ? getNumericScore(safeRisk[0], 'risk') : 0;
  const lastRisk = safeRisk.length ? getNumericScore(safeRisk[safeRisk.length - 1], 'risk') : 0;

  return {
    latestSentimentScore: lastSentiment,
    latestRiskScore: lastRisk,
    sentimentDelta: safeSentiment.length > 1 ? lastSentiment - firstSentiment : 0,
    riskDelta: safeRisk.length > 1 ? lastRisk - firstRisk : 0,
  };
}

async function loadEmployeeHistoryFromMongo({ employeeEmail, limit }) {
  const connection = await connectMongo();
  if (!connection?.connected) {
    return null;
  }

  const db = mongoose?.connection?.db;
  if (!db) {
    return null;
  }

  const normalizedEmail = normalizeEmail(employeeEmail);
  const safeLimit = clampHistoryLimit(limit);

  const sentimentRows = await db
    .collection('sentiment_history')
    .find({ employeeEmail: normalizedEmail })
    .sort({ analyzedAt: -1 })
    .limit(safeLimit)
    .toArray();

  const riskRows = await db
    .collection('risk_history')
    .find({ employeeEmail: normalizedEmail })
    .sort({ analyzedAt: -1 })
    .limit(safeLimit)
    .toArray();

  const sentimentHistory = [...sentimentRows].reverse().sort(byAnalyzedAtAsc);
  const riskHistory = [...riskRows].reverse().sort(byAnalyzedAtAsc);

  return {
    employeeEmail: normalizedEmail,
    limit: safeLimit,
    sentimentHistory,
    riskHistory,
    summary: buildHistorySummary(sentimentHistory, riskHistory),
  };
}

function collectAttendeeEmails(calendarDoc) {
  const rawAttendees = Array.isArray(calendarDoc?.raw?.attendees) ? calendarDoc.raw.attendees : [];
  const organizerEmail = calendarDoc?.raw?.organizer?.email;
  const creatorEmail = calendarDoc?.raw?.creator?.email;
  const metadataOrganizerEmail = calendarDoc?.metadata?.organizer?.email;
  const metadataAttendees = Array.isArray(calendarDoc?.metadata?.attendees) ? calendarDoc.metadata.attendees : [];

  const emails = [];
  rawAttendees.forEach((attendee) => {
    const email = normalizeEmail(attendee?.email);
    if (email) {
      emails.push(email);
    }
  });

  metadataAttendees.forEach((attendee) => {
    const email = normalizeEmail(attendee?.email || attendee);
    if (email) {
      emails.push(email);
    }
  });

  if (organizerEmail) {
    const normalized = normalizeEmail(organizerEmail);
    if (normalized) {
      emails.push(normalized);
    }
  }

  if (creatorEmail) {
    const normalized = normalizeEmail(creatorEmail);
    if (normalized) {
      emails.push(normalized);
    }
  }

  if (metadataOrganizerEmail) {
    const normalized = normalizeEmail(metadataOrganizerEmail);
    if (normalized) {
      emails.push(normalized);
    }
  }

  return Array.from(new Set(emails));
}

function pickPrimaryEmployeeEmail(calendarDoc) {
  const attendees = Array.isArray(calendarDoc?.raw?.attendees) ? calendarDoc.raw.attendees : [];
  const organizer = normalizeEmail(calendarDoc?.raw?.organizer?.email || calendarDoc?.metadata?.organizer?.email);
  const creator = normalizeEmail(calendarDoc?.raw?.creator?.email);

  const attendeeCandidates = attendees
    .map((item) => ({
      email: normalizeEmail(item?.email),
      organizer: Boolean(item?.organizer),
      self: Boolean(item?.self),
      optional: Boolean(item?.optional),
    }))
    .filter((item) => item.email);

  // Prefer a concrete recipient: not organizer, not creator, not self.
  const nonOwner = attendeeCandidates.find(
    (item) =>
      !item.organizer &&
      !item.self &&
      item.email !== organizer &&
      item.email !== creator
  );
  if (nonOwner?.email) {
    return nonOwner.email;
  }

  // Fallback to any non-organizer attendee.
  const nonOrganizer = attendeeCandidates.find(
    (item) => !item.organizer && item.email !== organizer
  );
  if (nonOrganizer?.email) {
    return nonOrganizer.email;
  }

  // Final fallback to organizer/creator or first collected attendee.
  const all = collectAttendeeEmails(calendarDoc);
  return all[0] || '';
}

function mapCalendarDocToMeeting(calendarDoc) {
  const startDate =
    calendarDoc?.raw?.start?.dateTime ||
    calendarDoc?.raw?.start?.date ||
    calendarDoc?.metadata?.start?.dateTime ||
    calendarDoc?.metadata?.start?.date ||
    calendarDoc?.ingestedAt;

  const meetingAt = asIsoDate(startDate) || (typeof startDate === 'string' ? startDate : null);
  const attendees = collectAttendeeEmails(calendarDoc);
  const primaryEmployeeEmail = pickPrimaryEmployeeEmail(calendarDoc);
  const summary =
    String(calendarDoc?.raw?.description || calendarDoc?.metadata?.description || '').trim() ||
    String(calendarDoc?.content || '').trim();

  return {
    meetingId: `gcal:${calendarDoc.externalId}`,
    title:
      String(calendarDoc?.metadata?.summary || calendarDoc?.raw?.summary || calendarDoc?.content || '').trim() ||
      'Calendar Meeting',
    meetingAt,
    employeeEmail: primaryEmployeeEmail,
    participants: attendees,
    summary,
    source: 'google_calendar',
  };
}

function mapFirefliesDocToMeeting(meetingDoc) {
  const participants = Array.isArray(meetingDoc?.participants)
    ? Array.from(new Set(meetingDoc.participants.map(normalizeEmail).filter(Boolean)))
    : [];

  const employeeEmail = normalizeEmail(meetingDoc?.employeeEmail) || participants[0] || '';

  return {
    meetingId: String(meetingDoc?.meetingId || ''),
    title: String(meetingDoc?.title || '').trim() || 'Meeting',
    meetingAt: asIsoDate(meetingDoc?.meetingAt) || (meetingDoc?.meetingAt ? String(meetingDoc.meetingAt) : null),
    employeeEmail,
    participants,
    summary: String(meetingDoc?.summary || '').trim(),
    hrInvolved: meetingDoc?.hrInvolved !== false,
    source: 'fireflies',
  };
}

function mergeMeetings(rows = []) {
  const seen = new Set();
  const merged = [];

  rows.forEach((row) => {
    const meetingId = String(row?.meetingId || '');
    const employeeEmail = normalizeEmail(row?.employeeEmail);
    const meetingAt = String(row?.meetingAt || '');
    const key = meetingId || `${employeeEmail}|${meetingAt}`;

    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(row);
  });

  merged.sort((a, b) => toMillis(b?.meetingAt) - toMillis(a?.meetingAt));
  return merged;
}

async function fetchLlmMeetings(targetPath) {
  const base = getLlmBaseUrl();
  const timeoutMs = getTimeoutMs();
  const url = `${base}${targetPath}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
    });

    const text = await upstream.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch (_err) {
      json = {
        ok: false,
        error: {
          message: text || 'Invalid upstream response',
          code: 'UPSTREAM_PARSE_ERROR',
        },
      };
    }

    return {
      ok: upstream.ok,
      status: upstream.status,
      json,
    };
  } catch (err) {
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 504 : 502,
      json: {
        ok: false,
        error: {
          message:
            err?.name === 'AbortError'
              ? `LLM upstream timeout after ${timeoutMs}ms`
              : (err?.message || 'Failed to reach LLM upstream service'),
          code: err?.name === 'AbortError' ? 'LLM_UPSTREAM_TIMEOUT' : 'LLM_UPSTREAM_UNAVAILABLE',
        },
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function listCalendarMeetings({ orgId, employeeEmail, query, fetchLimit = 400 }) {
  const connection = await connectMongo();
  if (!connection?.connected) {
    return [];
  }

  const docs = await Document.find(
    {
      orgId,
      sourceSystem: 'google_calendar',
      documentType: 'calendar_event',
    },
    {
      externalId: 1,
      content: 1,
      metadata: 1,
      raw: 1,
      ingestedAt: 1,
    }
  )
    .sort({ ingestedAt: -1 })
    .limit(fetchLimit)
    .lean();

  const normalizedQuery = String(query || '').trim().toLowerCase();
  const normalizedEmail = normalizeEmail(employeeEmail);

  return docs
    .map(mapCalendarDocToMeeting)
    .filter((row) => {
      if (normalizedEmail) {
        const email = normalizeEmail(row.employeeEmail);
        const participants = Array.isArray(row.participants) ? row.participants.map(normalizeEmail) : [];
        if (email !== normalizedEmail && !participants.includes(normalizedEmail)) {
          return false;
        }
      }

      if (!normalizedQuery) {
        return true;
      }

      const text = `${row.title || ''}\n${row.summary || ''}\n${(row.participants || []).join(' ')}`.toLowerCase();
      return text.includes(normalizedQuery);
    })
    .map((row) => {
      if (!normalizedEmail) {
        return row;
      }

      const participants = Array.isArray(row.participants) ? row.participants.map(normalizeEmail) : [];
      if (participants.includes(normalizedEmail)) {
        return {
          ...row,
          employeeEmail: normalizedEmail,
        };
      }

      return row;
    });
}

async function listFirefliesMeetings({ orgId, employeeEmail, query, fetchLimit = 400, includeNonHr = false }) {
  const connection = await connectMongo();
  if (!connection?.connected) {
    return [];
  }

  const docs = await Meeting.find(
    includeNonHr ? { orgId } : { orgId, hrInvolved: { $ne: false } },
    {
      meetingId: 1,
      title: 1,
      meetingAt: 1,
      employeeEmail: 1,
      participants: 1,
      summary: 1,
      hrInvolved: 1,
    }
  )
    .sort({ meetingAt: -1 })
    .limit(fetchLimit)
    .lean();

  const normalizedQuery = String(query || '').trim().toLowerCase();
  const normalizedEmail = normalizeEmail(employeeEmail);

  return docs
    .map(mapFirefliesDocToMeeting)
    .filter((row) => {
      if (!row.meetingId) {
        return false;
      }

      if (normalizedEmail) {
        const email = normalizeEmail(row.employeeEmail);
        const participants = Array.isArray(row.participants) ? row.participants.map(normalizeEmail) : [];
        if (email !== normalizedEmail && !participants.includes(normalizedEmail)) {
          return false;
        }
      }

      if (!normalizedQuery) {
        return true;
      }

      const text = `${row.title || ''}\n${row.summary || ''}\n${(row.participants || []).join(' ')}`.toLowerCase();
      return text.includes(normalizedQuery);
    })
    .map((row) => {
      if (!normalizedEmail) {
        return row;
      }

      const participants = Array.isArray(row.participants) ? row.participants.map(normalizeEmail) : [];
      if (participants.includes(normalizedEmail)) {
        return {
          ...row,
          employeeEmail: normalizedEmail,
        };
      }

      return row;
    });
}

async function ingestGoogleCalendarEvents({ orgId, calendarId, pastDays, futureDays, maxResults }) {
  const tokens = await readTokens();
  if (!tokens) {
    const err = new Error('Google Calendar not connected. Visit /api/calendar/google/oauth/start first.');
    err.statusCode = 400;
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  const { timeMin, timeMax } = buildCalendarWindow({ pastDays, futureDays });
  const payload = await listEvents(oauth2Client, {
    calendarId,
    timeMin,
    timeMax,
    maxResults,
  });

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const now = new Date();

  const docOps = items
    .map((eventItem) => {
      const eventId = String(eventItem?.id || '').trim();
      if (!eventId) {
        return null;
      }

      const externalId = `google_calendar:${calendarId}:${eventId}`;
      return {
        updateOne: {
          filter: { orgId, sourceSystem: 'google_calendar', externalId },
          update: {
            $setOnInsert: {
              orgId,
              documentType: 'calendar_event',
              sourceSystem: 'google_calendar',
              externalId,
              createdAt: now,
            },
            $set: {
              ingestedAt: now,
              sensitivity: 'standard',
              content: eventItem?.summary || '',
              metadata: {
                calendarId,
                summary: eventItem?.summary || '',
                description: eventItem?.description || '',
                status: eventItem?.status || '',
                start: eventItem?.start || null,
                end: eventItem?.end || null,
                organizer: eventItem?.organizer || null,
                attendees: Array.isArray(eventItem?.attendees) ? eventItem.attendees : [],
                attendeesCount: Array.isArray(eventItem?.attendees) ? eventItem.attendees.length : 0,
              },
              raw: eventItem,
            },
          },
          upsert: true,
        },
      };
    })
    .filter(Boolean);

  if (docOps.length > 0) {
    await Document.bulkWrite(docOps, { ordered: false });
  }

  return {
    orgId,
    calendarId,
    timeMin,
    timeMax,
    eventsSeen: items.length,
    eventsStored: docOps.length,
  };
}

async function getMergedMeetings({ orgId, employeeEmail, query, limit, includeNonHr = false }) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(Number(limit), 500)) : 20;

  const params = new URLSearchParams();
  if (employeeEmail) params.set('employeeEmail', employeeEmail);
  if (query) params.set('q', query);
  params.set('limit', String(safeLimit));

  const qs = params.toString();
  const upstream = await fetchLlmMeetings(`/meetings${qs ? `?${qs}` : ''}`);
  const llmRowsRaw = Array.isArray(upstream?.json?.data) ? upstream.json.data : [];
  const llmRows = llmRowsRaw.map((row) => ({ ...row, source: row?.source || 'llm' }));

  const calendarRows = await listCalendarMeetings({
    orgId,
    employeeEmail,
    query,
    fetchLimit: Math.max(200, safeLimit * 8),
  });

  const firefliesRows = await listFirefliesMeetings({
    orgId,
    employeeEmail,
    query,
    fetchLimit: Math.max(200, safeLimit * 8),
    includeNonHr,
  });

  const merged = mergeMeetings([...llmRows, ...calendarRows, ...firefliesRows]).slice(0, safeLimit);
  return { upstream, llmRows, calendarRows, firefliesRows, merged, safeLimit };
}

async function getCalendarMeetingByMeetingId({ orgId, meetingId }) {
  if (!String(meetingId || '').startsWith('gcal:')) {
    return null;
  }

  const connection = await connectMongo();
  if (!connection?.connected) {
    return null;
  }

  const externalId = String(meetingId).slice(5);
  if (!externalId) {
    return null;
  }

  return Document.findOne(
    {
      orgId,
      sourceSystem: 'google_calendar',
      documentType: 'calendar_event',
      externalId,
    },
    {
      externalId: 1,
      content: 1,
      metadata: 1,
      raw: 1,
      ingestedAt: 1,
    }
  ).lean();
}

async function getFirefliesMeetingByMeetingId({ orgId, meetingId }) {
  const id = String(meetingId || '').trim();
  if (!id) {
    return null;
  }

  const connection = await connectMongo();
  if (!connection?.connected) {
    return null;
  }

  return Meeting.findOne(
    {
      orgId,
      meetingId: id,
    },
    {
      meetingId: 1,
      title: 1,
      meetingAt: 1,
      employeeEmail: 1,
      participants: 1,
      summary: 1,
      transcript: 1,
    }
  ).lean();
}

async function proxyJson({ req, res, next, method, targetPath, body }) {
  const base = getLlmBaseUrl();
  const timeoutMs = getTimeoutMs();
  const url = `${base}${targetPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const text = await upstream.text();
    let json;

    try {
      json = text ? JSON.parse(text) : {};
    } catch (_err) {
      json = { ok: false, error: { message: text || 'Invalid upstream response', code: 'UPSTREAM_PARSE_ERROR' } };
    }

    res.status(upstream.status).json(json);
  } catch (err) {
    if (err?.name === 'AbortError') {
      res.status(504).json({
        ok: false,
        error: {
          message: `LLM upstream timeout after ${timeoutMs}ms`,
          code: 'LLM_UPSTREAM_TIMEOUT'
        }
      });
      return;
    }
    next(err);
  } finally {
    clearTimeout(timer);
  }
}

router.get('/health', async (req, res, next) => {
  await proxyJson({ req, res, next, method: 'GET', targetPath: '/health' });
});

router.get('/ingestion/source-check', async (req, res, next) => {
  const params = new URLSearchParams();
  if (req.query.employeeEmail) params.set('employeeEmail', String(req.query.employeeEmail));
  if (req.query.historicalMode !== undefined) params.set('historicalMode', String(req.query.historicalMode));

  const qs = params.toString();
  await proxyJson({ req, res, next, method: 'GET', targetPath: `/ingestion/source-check${qs ? `?${qs}` : ''}` });
});

router.get('/dashboard', async (req, res, next) => {
  await proxyJson({ req, res, next, method: 'GET', targetPath: '/dashboard' });
});

router.get('/employees', async (req, res, next) => {
  await proxyJson({ req, res, next, method: 'GET', targetPath: '/employees' });
});

router.get('/employees/:email/profile', async (req, res, next) => {
  const email = encodeURIComponent(String(req.params.email || '').toLowerCase());
  await proxyJson({ req, res, next, method: 'GET', targetPath: `/employees/${email}/profile` });
});

router.get('/employees/:email/history', async (req, res, next) => {
  const normalizedEmail = normalizeEmail(req.params.email);
  const encodedEmail = encodeURIComponent(normalizedEmail);
  const safeLimit = clampHistoryLimit(req.query.limit);

  const base = getLlmBaseUrl();
  const timeoutMs = getTimeoutMs();
  const targetUrl = `${base}/employees/${encodedEmail}/history?limit=${safeLimit}`;

  let upstreamStatus;
  let upstreamError;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    upstreamStatus = upstream.status;
    const text = await upstream.text();

    if (!upstream.ok) {
      upstreamError = `Upstream returned non-OK status ${upstream.status}`;
    } else {
      try {
        const json = text ? JSON.parse(text) : {};
        return res.json(json);
      } catch (_parseErr) {
        upstreamError = 'Upstream history response was not valid JSON';
      }
    }
  } catch (err) {
    upstreamError =
      err?.name === 'AbortError'
        ? `Upstream history request timed out after ${timeoutMs}ms`
        : (err?.message || 'Failed to reach upstream history endpoint');
  } finally {
    clearTimeout(timer);
  }

  try {
    const fallback = await loadEmployeeHistoryFromMongo({
      employeeEmail: normalizedEmail,
      limit: safeLimit,
    });

    if (fallback) {
      return res.json(fallback);
    }

    return res.status(502).json({
      ok: false,
      error: {
        message: `Unable to load employee history from upstream or Mongo fallback. ${upstreamError || ''}`.trim(),
        code: 'EMPLOYEE_HISTORY_UNAVAILABLE',
        upstreamStatus: upstreamStatus || null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/meetings', async (req, res, next) => {
  try {
    const employeeEmail = req.query.employeeEmail ? String(req.query.employeeEmail) : '';
    const query = req.query.q ? String(req.query.q) : '';
    const includeNonHr = String(req.query.includeNonHr || '').trim().toLowerCase() === 'true';
    const requestedLimit = Number(req.query.limit || 20);
    const orgId = getOrgId(req);
    const { upstream, llmRows, calendarRows, firefliesRows, merged } = await getMergedMeetings({
      orgId,
      employeeEmail,
      query,
      limit: requestedLimit,
      includeNonHr,
    });

    return res.json({
      ok: true,
      count: merged.length,
      data: merged,
      sources: {
        llm: llmRows.length,
        googleCalendar: calendarRows.length,
        fireflies: firefliesRows.length,
      },
      partial: !upstream.ok,
      upstream: upstream.ok
        ? undefined
        : {
            status: upstream.status || 502,
            error: upstream?.json?.error || {
              message: 'Failed to load meetings from upstream service',
              code: 'UPSTREAM_ERROR',
            },
          },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/meetings/refresh-google', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const calendarId = String(req.body?.calendarId || req.query.calendarId || 'primary');
    const pastDays = asInt(req.body?.pastDays ?? req.query.pastDays, 1, { min: 0, max: 3650 });
    const futureDays = asInt(req.body?.futureDays ?? req.query.futureDays, 7, { min: 0, max: 3650 });
    const maxResults = asInt(req.body?.maxResults ?? req.query.maxResults, 250, { min: 1, max: 1000 });

    const ingest = await ingestGoogleCalendarEvents({ orgId, calendarId, pastDays, futureDays, maxResults });

    const employeeEmail = req.body?.employeeEmail ? String(req.body.employeeEmail) : '';
    const query = req.body?.q ? String(req.body.q) : '';
    const includeNonHr = String(req.body?.includeNonHr ?? req.query.includeNonHr ?? '').trim().toLowerCase() === 'true';
    const requestedLimit = Number(req.body?.limit || req.query.limit || 20);

    const { upstream, llmRows, calendarRows, firefliesRows, merged } = await getMergedMeetings({
      orgId,
      employeeEmail,
      query,
      limit: requestedLimit,
      includeNonHr,
    });

    return res.json({
      ok: true,
      data: {
        ingestion: ingest,
        meetings: {
          count: merged.length,
          data: merged,
          sources: {
            llm: llmRows.length,
            googleCalendar: calendarRows.length,
            fireflies: firefliesRows.length,
          },
          partial: !upstream.ok,
        },
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/meetings/:id/transcript', async (req, res, next) => {
  try {
    const meetingIdRaw = String(req.params.id || '');
    if (meetingIdRaw.startsWith('gcal:')) {
      const orgId = getOrgId(req);
      const doc = await getCalendarMeetingByMeetingId({ orgId, meetingId: meetingIdRaw });
      if (!doc) {
        return res.status(404).json({ error: 'meeting not found' });
      }

      const mapped = mapCalendarDocToMeeting(doc);
      return res.json({
        meetingId: mapped.meetingId,
        title: mapped.title,
        meetingAt: mapped.meetingAt,
        participants: mapped.participants,
        summary: mapped.summary,
        transcript: [],
        transcriptCount: 0,
        totalTranscriptCount: 0,
        source: 'google_calendar',
      });
    }

    const orgId = getOrgId(req);
    const firefliesDoc = await getFirefliesMeetingByMeetingId({ orgId, meetingId: meetingIdRaw });
    if (firefliesDoc) {
      const query = String(req.query.q || '').trim().toLowerCase();

      let transcriptRows = await MeetingTranscriptTurn.find(
        {
          orgId,
          meetingId: meetingIdRaw,
        },
        {
          turnIndex: 1,
          speaker: 1,
          text: 1,
        }
      )
        .sort({ turnIndex: 1 })
        .lean();

      if (!transcriptRows.length && Array.isArray(firefliesDoc.transcript)) {
        transcriptRows = firefliesDoc.transcript.map((row, index) => ({
          turnIndex: Number.isFinite(Number(row?.turnIndex)) ? Number(row.turnIndex) : index,
          speaker: String(row?.speaker || row?.speaker_name || row?.role || '').trim(),
          text: String(row?.text || row?.message || '').trim(),
        }));
      }

      const normalizedTranscript = transcriptRows
        .map((row, index) => ({
          turnIndex: Number.isFinite(Number(row?.turnIndex)) ? Number(row.turnIndex) : index,
          speaker: String(row?.speaker || '').trim() || null,
          text: String(row?.text || '').trim(),
        }))
        .filter((row) => row.text);

      const filteredTranscript = query
        ? normalizedTranscript.filter((row) => {
            const haystack = `${row.speaker || ''} ${row.text}`.toLowerCase();
            return haystack.includes(query);
          })
        : normalizedTranscript;

      const mapped = mapFirefliesDocToMeeting(firefliesDoc);
      return res.json({
        meetingId: mapped.meetingId,
        title: mapped.title,
        meetingAt: mapped.meetingAt,
        participants: mapped.participants,
        summary: mapped.summary,
        transcript: filteredTranscript,
        transcriptCount: filteredTranscript.length,
        totalTranscriptCount: normalizedTranscript.length,
        source: 'fireflies',
      });
    }

    const meetingId = encodeURIComponent(meetingIdRaw);
    const params = new URLSearchParams();
    if (req.query.q) params.set('q', String(req.query.q));

    const qs = params.toString();
    await proxyJson({
      req,
      res,
      next,
      method: 'GET',
      targetPath: `/meetings/${meetingId}/transcript${qs ? `?${qs}` : ''}`
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/briefs/upcoming', async (req, res, next) => {
  await proxyJson({ req, res, next, method: 'POST', targetPath: '/briefs/upcoming', body: req.body || {} });
});

router.post('/chat/query', async (req, res, next) => {
  await proxyJson({ req, res, next, method: 'POST', targetPath: '/chat/query', body: req.body || {} });
});

router.post('/chat/sessions', async (req, res, next) => {
  await proxyJson({ req, res, next, method: 'POST', targetPath: '/chat/sessions', body: req.body || {} });
});

router.get('/chat/sessions', async (req, res, next) => {
  const params = new URLSearchParams();
  if (req.query.limit) params.set('limit', String(req.query.limit));
  if (req.query.status) params.set('status', String(req.query.status));
  const qs = params.toString();

  await proxyJson({
    req,
    res,
    next,
    method: 'GET',
    targetPath: `/chat/sessions${qs ? `?${qs}` : ''}`,
  });
});

router.patch('/chat/sessions/:sessionId', async (req, res, next) => {
  const sessionId = encodeURIComponent(String(req.params.sessionId || ''));
  await proxyJson({
    req,
    res,
    next,
    method: 'PATCH',
    targetPath: `/chat/sessions/${sessionId}`,
    body: req.body || {},
  });
});

router.delete('/chat/sessions/:sessionId', async (req, res, next) => {
  const sessionId = encodeURIComponent(String(req.params.sessionId || ''));
  await proxyJson({
    req,
    res,
    next,
    method: 'DELETE',
    targetPath: `/chat/sessions/${sessionId}`,
  });
});

router.get('/chat/sessions/:sessionId/history', async (req, res, next) => {
  const sessionId = encodeURIComponent(String(req.params.sessionId || ''));
  const params = new URLSearchParams();
  if (req.query.limit) params.set('limit', String(req.query.limit));
  const qs = params.toString();

  await proxyJson({
    req,
    res,
    next,
    method: 'GET',
    targetPath: `/chat/sessions/${sessionId}/history${qs ? `?${qs}` : ''}`
  });
});

router.post('/pipeline/run', async (req, res, next) => {
  await proxyJson({ req, res, next, method: 'POST', targetPath: '/pipeline/run', body: req.body || {} });
});

router.post('/pipeline/sync-bamboohr', async (req, res, next) => {
  await proxyJson({ req, res, next, method: 'POST', targetPath: '/pipeline/sync-bamboohr', body: req.body || {} });
});

module.exports = router;
