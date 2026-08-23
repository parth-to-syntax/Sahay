// Probe whether specific BambooHR fields are *returned* for a given employee id.
// Prints only field presence (no values) to avoid leaking PII.
//
// Usage:
//   node scripts/probeBambooEmployeeFields.js 4
//

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getEmployeeById, getEmployeeDirectory } = require('../src/connectors/bamboohr/bamboohrClient');

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

(async () => {
  const employeeIdArg = process.argv[2];

  // A practical probe set based on missingCandidates observed.
  // Includes aliases and numeric ids that commonly represent compensation/time-off.
  const fieldsToTry = uniq([
    // manager/employee type
    'reportsTo', 'supervisor', 'employmentStatus', 'hireDate', 'jobTitle', 'department', 'division',
    'payType',

    // compensation (aliases)
    'payRate', 'payRateEffectiveDate', 'payChangeReason',
    'bonusAmount', 'bonusDate', 'bonusReason', 'bonusComment',
    'commissionAmount', 'commissionDate',

    // job level / band
    'payBand', 'jobLevel',

    // offboarding
    'terminationDate',

    // numeric meta ids from candidates (may work if BambooHR accepts ids in fields=)
    '19', '4021', '4017',
    '4152', '4151', '4153', '4154', '4157', '4156',
    '4494', '4495', '4496', '4498', '4499', '4500', '4501', '4502',

    // time off ids observed
    '4360', '4570', '4369'
  ]);

  const fieldsCsv = fieldsToTry.join(',');

  async function resolveEmployeeIdsToTry() {
    if (employeeIdArg) return [String(employeeIdArg)];

    const directory = await getEmployeeDirectory();
    const employees = directory && Array.isArray(directory.employees) ? directory.employees : [];
    const ids = employees
      .map((e) => e && (e.id ?? e.employeeId ?? e.employeeID))
      .filter((id) => id !== undefined && id !== null)
      .map((id) => String(id));
    return Array.from(new Set(ids)).slice(0, 20);
  }

  try {
    const employeeIdsToTry = await resolveEmployeeIdsToTry();
    if (employeeIdsToTry.length === 0) {
      console.error('No employee ids available to probe (directory empty or permission issue).');
      process.exit(1);
    }

    let lastErr = null;

    for (const candidateId of employeeIdsToTry) {
      try {
        const data = await getEmployeeById(candidateId, fieldsCsv);
        const keys = data && typeof data === 'object' ? Object.keys(data).sort() : [];
        const presence = fieldsToTry.map((f) => ({ field: f, present: keys.includes(f) }));

        const restrictedFields = Array.isArray(data?._restrictedFields) ? data._restrictedFields : undefined;

        console.log(JSON.stringify({
          company: process.env.BAMBOOHR_COMPANY,
          probedEmployeeId: candidateId,
          employeeIdSource: employeeIdArg ? 'arg' : 'directory',
          fetchedAt: new Date().toISOString(),
          requestedFieldCount: fieldsToTry.length,
          returnedKeyCount: keys.length,
          restrictedFieldCount: restrictedFields ? restrictedFields.length : 0,
          restrictedFields,
          presence
        }, null, 2));
        return;
      } catch (err) {
        lastErr = err;
        // Keep trying other employees on 404s (often indicates no access to that employee).
        if (String(err?.message || '').includes('(404)')) {
          continue;
        }
        throw err;
      }
    }

    throw lastErr || new Error('All employee probes failed');
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
})();
