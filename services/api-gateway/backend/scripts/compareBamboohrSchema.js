// Prints a concise report of which desired HRMS schema fields
// are discoverable via BambooHR meta fields and directory response.
// Usage: node backend/scripts/compareBamboohrSchema.js  (from repo root)
//    or: node scripts/compareBamboohrSchema.js          (from backend folder)

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getMetaFields, getEmployeeDirectory } = require('../src/connectors/bamboohr/bamboohrClient');
const { compareSchema } = require('../src/features/bamboohrSchema/schemaCompare');

(async () => {
  try {
    const [metaFields, directoryData] = await Promise.all([
      getMetaFields(),
      getEmployeeDirectory()
    ]);

    const report = compareSchema({ metaFields, directoryData });

    const out = {
      company: process.env.BAMBOOHR_COMPANY,
      fetchedAt: new Date().toISOString(),
      metaFieldCount: report.metaFieldCount,
      matchCount: report.matches.length,
      missingCount: report.missing.length,
      matchesSample: report.matches.slice(0, 20),
      missing: report.missing,
      missingCandidates: report.missingCandidates,
      notes: report.notes
    };

    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
})();
