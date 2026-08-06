function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function maskEmail(email) {
  const e = normalizeEmail(email);
  const at = e.indexOf('@');
  if (at <= 1) return e ? '***' : '';
  const name = e.slice(0, at);
  const domain = e.slice(at + 1);
  const prefix = name.slice(0, Math.min(2, name.length));
  const suffix = name.length > 4 ? name.slice(-2) : '';
  return `${prefix}***${suffix}@${domain}`;
}

function emailFingerprint(email) {
  const crypto = require('crypto');
  const e = normalizeEmail(email);
  if (!e) return '';
  return crypto.createHash('sha256').update(e, 'utf8').digest('hex').slice(0, 10);
}

module.exports = {
  normalizeEmail,
  maskEmail,
  emailFingerprint
};
