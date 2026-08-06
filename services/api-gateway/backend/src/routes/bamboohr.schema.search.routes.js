const express = require('express');
const { getMetaFields } = require('../connectors/bamboohr/bamboohrClient');

const router = express.Router();

function normalize(str) {
  return String(str || '').toLowerCase();
}

// Search BambooHR meta/fields by keyword in name or alias.
// GET /api/bamboohr/schema/search?q=salary
router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ ok: false, error: { message: 'Missing query param q' } });
    }

    const meta = await getMetaFields();
    const fields = Array.isArray(meta) ? meta : (meta && meta.fields) ? meta.fields : [];

    const nq = normalize(q);

    const results = fields
      .map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        alias: f.alias
      }))
      .filter((f) => normalize(f.name).includes(nq) || normalize(f.alias).includes(nq))
      .slice(0, 50);

    res.json({ ok: true, data: { q, count: results.length, results } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
