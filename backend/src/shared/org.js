const { HttpError } = require('./errors');

function getOrgId(req) {
  const header = req.headers['x-org-id'];
  const query = req.query?.orgId;
  const env = process.env.DEFAULT_ORG_ID;

  const value = (header || query || env || 'demo').toString().trim();
  return value === '' ? 'demo' : value;
}

function parseDateLike(value, { fieldName } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return null;

  const asString = String(value).trim();
  // Allow YYYY-MM-DD as a convenience (interpreted as UTC midnight).
  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    const d = new Date(`${asString}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const d = new Date(asString);
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(400, `Invalid date for ${fieldName || 'date'}: ${asString}`, 'INVALID_DATE');
  }
  return d;
}

function getAsOf(req, { queryKey = 'snapshotAt', bodyKey = 'snapshotAt' } = {}) {
  const raw = req.query?.[queryKey] ?? req.body?.[bodyKey];
  return parseDateLike(raw, { fieldName: queryKey }) || new Date();
}

module.exports = {
  getOrgId,
  parseDateLike,
  getAsOf
};
