// Simple CLI probe (Node) that prints non-PII summary.
// Usage: node backend/scripts/probeBamboohr.js  (from repo root)
//    or: node scripts/probeBamboohr.js          (from backend folder)

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getMetaFields, getEmployeeDirectory } = require('../src/connectors/bamboohr/bamboohrClient');

(async () => {
  try {
    const meta = await getMetaFields();
    const directory = await getEmployeeDirectory();

    const fields = Array.isArray(meta)
      ? meta
      : (meta && meta.fields) ? meta.fields : [];

    const aliases = fields
      .map((f) => f.alias)
      .filter(Boolean);

    const employees = (directory && directory.employees) ? directory.employees : (Array.isArray(directory) ? directory : []);

    const summary = {
      company: process.env.BAMBOOHR_COMPANY,
      fetchedAt: new Date().toISOString(),
      meta: {
        fieldCount: fields.length,
        aliasesSample: Array.from(new Set(aliases)).slice(0, 30)
      },
      directory: {
        employeeCount: employees.length,
        fieldNames: employees.length > 0 ? Object.keys(employees[0]).sort() : []
      }
    };

    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
})();
