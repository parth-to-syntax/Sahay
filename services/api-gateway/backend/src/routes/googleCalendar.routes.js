const express = require('express');

const { HttpError } = require('../shared/errors');
const { maskEmail } = require('../shared/pii');
const { readTokens, writeTokens } = require('../shared/googleTokenStore');
const { getOAuth2Client, getScopes } = require('../connectors/google/googleClient');
const { listCalendars, listEvents } = require('../connectors/google/googleCalendar');

const router = express.Router();

function asInt(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function nowWindowIso({ pastDays, futureDays }) {
  const now = new Date();
  const start = new Date(now.getTime() - pastDays * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + futureDays * 24 * 60 * 60 * 1000);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

function collectKeys(value, { maxDepth = 4 } = {}) {
  const out = new Set();

  function walk(v, prefix, depth) {
    if (depth > maxDepth) return;
    if (v === null || v === undefined) return;

    if (Array.isArray(v)) {
      out.add(`${prefix}[]`);
      const first = v.find((x) => x !== null && x !== undefined);
      if (first !== undefined) walk(first, `${prefix}[]`, depth + 1);
      return;
    }

    if (typeof v === 'object') {
      Object.keys(v).forEach((k) => {
        const nextPrefix = prefix ? `${prefix}.${k}` : k;
        out.add(nextPrefix);
        walk(v[k], nextPrefix, depth + 1);
      });
      return;
    }

    // primitive
    out.add(prefix);
  }

  walk(value, '', 0);
  return Array.from(out).filter(Boolean).sort();
}

async function getAuthedOAuthClient() {
  const tokens = await readTokens();
  if (!tokens) {
    throw new HttpError(400, 'Google Calendar not connected. Visit /api/calendar/google/oauth/start first.', 'NOT_CONNECTED');
  }
  const client = getOAuth2Client();
  client.setCredentials(tokens);
  return client;
}

function safeEventSummary(evt) {
  const attendees = Array.isArray(evt?.attendees) ? evt.attendees : [];
  const organizerEmail = evt?.organizer?.email ? maskEmail(evt.organizer.email) : undefined;
  const creatorEmail = evt?.creator?.email ? maskEmail(evt.creator.email) : undefined;

  const entryPoints = Array.isArray(evt?.conferenceData?.entryPoints) ? evt.conferenceData.entryPoints : [];

  return {
    id: evt?.id,
    status: evt?.status,
    eventType: evt?.eventType,
    created: evt?.created,
    updated: evt?.updated,
    htmlLinkPresent: Boolean(evt?.htmlLink),

    summaryPresent: typeof evt?.summary === 'string' && evt.summary.trim() !== '',
    descriptionPresent: typeof evt?.description === 'string' && evt.description.trim() !== '',
    locationPresent: typeof evt?.location === 'string' && evt.location.trim() !== '',

    start: evt?.start,
    end: evt?.end,

    organizer: organizerEmail ? { email: organizerEmail } : undefined,
    creator: creatorEmail ? { email: creatorEmail } : undefined,

    attendeeCount: attendees.length,
    attendeeEmailsSample: attendees
      .map((a) => a?.email)
      .filter(Boolean)
      .slice(0, 8)
      .map(maskEmail),

    attendeesFlags: {
      hasOptional: attendees.some((a) => a?.optional === true),
      hasResponseStatus: attendees.some((a) => typeof a?.responseStatus === 'string'),
      hasOrganizerFlag: attendees.some((a) => a?.organizer === true)
    },

    recurrencePresent: Array.isArray(evt?.recurrence) && evt.recurrence.length > 0,
    recurringEventIdPresent: Boolean(evt?.recurringEventId),

    hangoutLinkPresent: Boolean(evt?.hangoutLink),
    conferenceDataPresent: Boolean(evt?.conferenceData),
    conferenceEntryPointsCount: entryPoints.length,
    conferenceSolutionName: evt?.conferenceData?.conferenceSolution?.name
  };
}

router.get('/oauth/start', async (_req, res, next) => {
  try {
    const client = getOAuth2Client();
    const scopes = getScopes();

    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: scopes
    });

    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

router.get('/oauth/callback', async (req, res, next) => {
  try {
    const code = req.query.code ? String(req.query.code) : null;
    if (!code) {
      res.status(400).json({ ok: false, error: { message: 'Missing query param: code', code: 'BAD_REQUEST' } });
      return;
    }

    const client = getOAuth2Client();
    const existing = await readTokens();

    const { tokens } = await client.getToken(code);

    // Preserve refresh token if Google doesn't return it on subsequent consents.
    const merged = {
      ...existing,
      ...tokens,
      refresh_token: tokens?.refresh_token || existing?.refresh_token
    };

    await writeTokens(merged);

    res.json({
      ok: true,
      data: {
        connected: true,
        hasRefreshToken: Boolean(merged?.refresh_token),
        expiry_date: merged?.expiry_date || null,
        scopes: merged?.scope || null
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/status', async (_req, res, next) => {
  try {
    const tokens = await readTokens();
    if (!tokens) {
      res.json({ ok: true, data: { connected: false } });
      return;
    }

    res.json({
      ok: true,
      data: {
        connected: true,
        hasRefreshToken: Boolean(tokens?.refresh_token),
        expiry_date: tokens?.expiry_date || null,
        scope: tokens?.scope || null
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/config', async (_req, res, next) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const scopes = process.env.GOOGLE_SCOPES;

    const missing = [];
    if (!clientId) missing.push('GOOGLE_CLIENT_ID');
    if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
    if (!redirectUri) missing.push('GOOGLE_REDIRECT_URI');

    res.json({
      ok: true,
      data: {
        configured: missing.length === 0,
        missing,
        present: {
          GOOGLE_CLIENT_ID: Boolean(clientId),
          GOOGLE_CLIENT_SECRET: Boolean(clientSecret),
          GOOGLE_REDIRECT_URI: Boolean(redirectUri),
          GOOGLE_SCOPES: Boolean(scopes)
        },
        redirectUri: redirectUri || null
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/probe', async (req, res, next) => {
  try {
    const calendarId = req.query.calendarId ? String(req.query.calendarId) : 'primary';
    const maxResults = asInt(req.query.maxResults, 25);
    const pastDays = asInt(req.query.pastDays, 90);
    const futureDays = asInt(req.query.futureDays, 30);

    if (pastDays < 0 || futureDays < 0 || pastDays > 3650 || futureDays > 3650) {
      throw new HttpError(400, 'Invalid window. Use pastDays/futureDays between 0 and 3650.', 'BAD_REQUEST');
    }

    const client = await getAuthedOAuthClient();

    const { timeMin, timeMax } = nowWindowIso({ pastDays, futureDays });

    const calendarList = await listCalendars(client, { maxResults: 50 });
    const events = await listEvents(client, { calendarId, timeMin, timeMax, maxResults });

    const items = Array.isArray(events?.items) ? events.items : [];

    const safeSample = items.slice(0, Math.min(10, items.length)).map(safeEventSummary);
    const sampleRaw = items[0] || null;

    res.json({
      ok: true,
      data: {
        fetchedAt: new Date().toISOString(),
        window: { calendarId, timeMin, timeMax, maxResults },
        calendarList: {
          total: Array.isArray(calendarList?.items) ? calendarList.items.length : 0,
          sample: (Array.isArray(calendarList?.items) ? calendarList.items : []).slice(0, 10).map((c) => ({
            id: c?.id,
            primary: Boolean(c?.primary),
            summaryPresent: typeof c?.summary === 'string' && c.summary.trim() !== '',
            accessRole: c?.accessRole
          }))
        },
        events: {
          resultCount: items.length,
          nextPageTokenPresent: Boolean(events?.nextPageToken),
          nextSyncTokenPresent: Boolean(events?.nextSyncToken),
          timeZone: events?.timeZone,
          safeSample
        },
        schema: {
          sampleEventKeys: sampleRaw ? collectKeys(sampleRaw, { maxDepth: 4 }) : [],
          sampleCalendarListKeys: calendarList ? collectKeys(calendarList, { maxDepth: 4 }) : []
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
