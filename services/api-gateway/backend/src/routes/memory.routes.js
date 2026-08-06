const express = require('express');

const { connectMongo } = require('../db/mongo');
const { getOrgId, parseDateLike } = require('../shared/org');
const { HttpError } = require('../shared/errors');

const MemoryEvent = require('../db/models/MemoryEvent');

const router = express.Router();

async function ensureMongoConnected() {
  const result = await connectMongo();
  if (!result?.connected) {
    const reason = result?.reason || 'MONGO_NOT_CONNECTED';
    throw new HttpError(503, `MongoDB not connected (${reason})`, 'MONGO_NOT_CONNECTED');
  }
}

// GET /api/memory/events?employeeId=123&limit=50
router.get('/events', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    const employeeId = String(req.query.employeeId || '').trim();
    const limit = Number.parseInt(String(req.query.limit || '50'), 10);

    if (!employeeId) {
      throw new HttpError(400, 'employeeId is required', 'VALIDATION_ERROR');
    }

    const items = await MemoryEvent.find({ orgId, employeeId })
      .sort({ eventTime: -1 })
      .limit(Number.isFinite(limit) ? Math.min(limit, 200) : 50)
      .lean();

    res.json({ ok: true, data: { orgId, employeeId, count: items.length, items } });
  } catch (err) {
    next(err);
  }
});

// POST /api/memory/events
router.post('/events', async (req, res, next) => {
  try {
    await ensureMongoConnected();

    const orgId = getOrgId(req);
    const {
      employeeId,
      eventType,
      eventTime,
      summary,
      payload,
      sourceDocumentId,
      sourceChunkId,
      sourceExcerpt,
      confidence,
      sensitivity
    } = req.body || {};

    if (!employeeId || !eventType || !eventTime) {
      throw new HttpError(400, 'employeeId, eventType, eventTime are required', 'VALIDATION_ERROR');
    }

    const when = parseDateLike(eventTime, { fieldName: 'eventTime' });

    const created = await MemoryEvent.create({
      orgId,
      employeeId,
      eventType,
      eventTime: when,
      summary,
      payload,
      sourceDocumentId,
      sourceChunkId,
      sourceExcerpt,
      confidence,
      sensitivity
    });

    res.status(201).json({ ok: true, data: { orgId, id: created._id } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
