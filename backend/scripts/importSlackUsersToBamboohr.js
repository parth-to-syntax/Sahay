// Create BambooHR employee records for Slack users (by email).
// Dry-run by default. To actually create employees:
//   set CONFIRM_IMPORT=true
// Optional:
//   MAX_CREATES=20
//
// Usage:
//   node scripts/importSlackUsersToBamboohr.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { buildImportPlan, applyImport } = require('../src/features/bambooSlackSync/importSlackUsersToBamboohr');

(async () => {
  try {
    const confirm = String(process.env.CONFIRM_IMPORT || '').toLowerCase() === 'true';
    const maxCreates = Number.parseInt(String(process.env.MAX_CREATES || '20'), 10);

    if (!confirm) {
      const plan = await buildImportPlan({ limit: 200 });
      console.log(JSON.stringify({
        ok: true,
        mode: 'plan',
        data: plan,
        next: 'Set CONFIRM_IMPORT=true (and optionally MAX_CREATES) to apply.'
      }, null, 2));
      return;
    }

    const result = await applyImport({
      confirm,
      maxCreates: Number.isFinite(maxCreates) ? maxCreates : 20
    });

    console.log(JSON.stringify({ ok: true, mode: 'apply', data: result }, null, 2));
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
})();
