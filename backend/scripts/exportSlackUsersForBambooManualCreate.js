// Export Slack users (real employees) that are missing in BambooHR by email.
// This is intended for MANUAL creation in BambooHR when API-based create is unavailable.
//
// Safety:
// - By default, emails are masked.
// - To include real emails, set EXPORT_PII=true.
//
// Optional:
// - FORMAT=json|csv (default json)
//
// Usage:
//   node scripts/exportSlackUsersForBambooManualCreate.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getEmployeeDirectory } = require('../src/connectors/bamboohr/bamboohrClient');
const { usersList } = require('../src/connectors/slack/slackClient');
const { normalizeEmail, maskEmail, emailFingerprint } = require('../src/shared/pii');

function splitName(fullName) {
  const name = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!name) return { firstName: '', lastName: '' };
  const parts = name.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

function pickSlackEmployee(u) {
  const profile = u?.profile || {};
  const email = normalizeEmail(profile.email);
  const fullName = String(profile.real_name || u?.real_name || profile.display_name || u?.name || '').trim();
  const { firstName, lastName } = splitName(fullName);

  return {
    slackUserId: u?.id,
    email,
    firstName: String(profile.first_name || firstName || '').trim(),
    lastName: String(profile.last_name || lastName || '').trim(),
    displayName: fullName,
    deleted: Boolean(u?.deleted),
    isBot: Boolean(u?.is_bot)
  };
}

function toCsvRow(values) {
  return values
    .map((v) => {
      const s = String(v ?? '');
      const escaped = s.replace(/"/g, '""');
      return `"${escaped}"`;
    })
    .join(',');
}

(async () => {
  try {
    const exportPii = String(process.env.EXPORT_PII || '').toLowerCase() === 'true';
    const format = String(process.env.FORMAT || 'json').toLowerCase();

    const directory = await getEmployeeDirectory();
    const bambooEmployees = directory && Array.isArray(directory.employees) ? directory.employees : [];
    const bambooEmails = new Set(
      bambooEmployees
        .map((e) => normalizeEmail(e?.workEmail))
        .filter(Boolean)
    );

    const slack = await usersList({ limit: 1000 });
    const slackMembersRaw = slack && Array.isArray(slack.members) ? slack.members : [];

    const slackEmployees = slackMembersRaw
      .map(pickSlackEmployee)
      .filter((u) => Boolean(u.email))
      .filter((u) => !u.deleted && !u.isBot);

    const missing = slackEmployees
      .filter((u) => !bambooEmails.has(u.email))
      .map((u) => {
        const emailOut = exportPii ? u.email : maskEmail(u.email);
        return {
          slackUserId: u.slackUserId,
          email: emailOut,
          emailId: emailFingerprint(u.email),
          firstName: u.firstName,
          lastName: u.lastName,
          displayName: u.displayName
        };
      });

    const out = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      exportPii,
      bamboohr: {
        directoryEmployeeCount: bambooEmployees.length,
        directoryWithEmailCount: bambooEmails.size
      },
      slack: {
        memberCount: slackMembersRaw.length,
        usableEmployeeCount: slackEmployees.length
      },
      missingInBambooCount: missing.length,
      missing
    };

    if (format === 'csv') {
      const header = ['slackUserId', 'email', 'emailId', 'firstName', 'lastName', 'displayName'];
      const lines = [toCsvRow(header)];
      for (const row of missing) {
        lines.push(toCsvRow(header.map((k) => row[k])));
      }
      process.stdout.write(`${lines.join('\n')}\n`);
      return;
    }

    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } catch (err) {
    // Avoid printing env values/tokens.
    // eslint-disable-next-line no-console
    console.error(err?.message || err);
    process.exit(1);
  }
})();
