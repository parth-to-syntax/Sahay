const express = require('express');
const { compareBamboohrToSlack } = require('../features/bambooSlackSync/compare');
const { buildImportPlan, applyImport } = require('../features/bambooSlackSync/importSlackUsersToBamboohr');

const router = express.Router();

// GET /api/sync/bamboohr-slack/compare?includeEmails=true
router.get('/bamboohr-slack/compare', async (req, res, next) => {
  try {
    const includeEmails = String(req.query.includeEmails || '').toLowerCase() === 'true';
    const data = await compareBamboohrToSlack({ includeEmails });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/sync/slack-to-bamboohr/plan?limit=200
router.get('/slack-to-bamboohr/plan', async (req, res, next) => {
  try {
    const limit = Number.parseInt(String(req.query.limit || '200'), 10);
    const data = await buildImportPlan({ limit: Number.isFinite(limit) ? limit : 200 });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/sync/slack-to-bamboohr/apply?confirm=true&maxCreates=20
router.post('/slack-to-bamboohr/apply', async (req, res, next) => {
  try {
    const confirm = String(req.query.confirm || '').toLowerCase() === 'true';
    const maxCreates = Number.parseInt(String(req.query.maxCreates || '20'), 10);
    const data = await applyImport({
      confirm,
      maxCreates: Number.isFinite(maxCreates) ? maxCreates : 20
    });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
