// Analyze BambooHR meta/fields for keywords (no PII)
// Usage: node scripts/analyzeBambooMeta.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getMetaFields } = require('../src/connectors/bamboohr/bamboohrClient');

function norm(str) {
  return String(str || '').toLowerCase();
}

function pick(field) {
  return {
    id: field.id,
    name: field.name,
    alias: field.alias || null,
    type: field.type
  };
}

(async () => {
  try {
    const meta = await getMetaFields();
    const fields = Array.isArray(meta) ? meta : (meta && meta.fields) ? meta.fields : [];

    const keywords = [
      'salary', 'pay rate', 'pay', 'bonus', 'commission', 'equity', 'stock', 'rsu', 'options',
      'compensation', 'raise', 'effective',
      'performance', 'review', 'rating', 'feedback', 'promotion',
      'time off', 'leave', 'pto', 'vacation', 'sick', 'balance', 'overtime', 'hours',
      'termination', 'exit', 'voluntary', 'involuntary', 'reason'
    ];

    const report = [];

    for (const kw of keywords) {
      const k = norm(kw);
      const matches = fields
        .filter((f) => norm(f.name).includes(k) || norm(f.alias).includes(k))
        .slice(0, 25)
        .map(pick);

      report.push({ keyword: kw, count: matches.length, results: matches });
    }

    console.log(JSON.stringify({
      company: process.env.BAMBOOHR_COMPANY,
      fetchedAt: new Date().toISOString(),
      metaFieldCount: fields.length,
      report
    }, null, 2));
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
})();
