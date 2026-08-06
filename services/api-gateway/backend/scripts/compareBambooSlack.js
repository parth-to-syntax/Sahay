// Compare BambooHR directory employees to Slack users (by email) and print a summary.
// Usage:
//   node scripts/compareBambooSlack.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { compareBamboohrToSlack } = require('../src/features/bambooSlackSync/compare');

(async () => {
  try {
    const includeEmails = String(process.env.INCLUDE_EMAILS || '').toLowerCase() === 'true';
    const data = await compareBamboohrToSlack({ includeEmails });
    console.log(JSON.stringify({ ok: true, data }, null, 2));
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
})();
