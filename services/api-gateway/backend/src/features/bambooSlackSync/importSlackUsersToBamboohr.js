const { HttpError } = require('../../shared/errors');
const { normalizeEmail, maskEmail, emailFingerprint } = require('../../shared/pii');

const { getEmployeeDirectory, createEmployee } = require('../../connectors/bamboohr/bamboohrClient');
const { usersList } = require('../../connectors/slack/slackClient');

function normalizeNamePart(value) {
  return String(value || '').trim();
}

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

function pickSlackUserForImport(u) {
  const profile = u?.profile || {};
  const email = normalizeEmail(profile.email);
  const fullName = normalizeNamePart(profile.real_name || u?.real_name || profile.display_name || u?.name);

  const { firstName, lastName } = splitName(fullName);
  return {
    slackUserId: u?.id,
    email,
    emailMasked: maskEmail(email),
    emailId: emailFingerprint(email),
    firstName: normalizeNamePart(profile.first_name) || firstName,
    lastName: normalizeNamePart(profile.last_name) || lastName,
    displayName: fullName,
    deleted: Boolean(u?.deleted),
    isBot: Boolean(u?.is_bot),
    isRestricted: Boolean(u?.is_restricted || u?.is_ultra_restricted)
  };
}

async function buildImportPlan({ limit = 200 } = {}) {
  if (!process.env.BAMBOOHR_COMPANY || !process.env.BAMBOOHR_API_KEY) {
    throw new HttpError(500, 'Missing BambooHR configuration (BAMBOOHR_COMPANY, BAMBOOHR_API_KEY)', 'BAMBOOHR_NOT_CONFIGURED');
  }
  if (!process.env.SLACK_BOT_TOKEN) {
    throw new HttpError(500, 'Missing Slack configuration (SLACK_BOT_TOKEN)', 'SLACK_NOT_CONFIGURED');
  }

  const directory = await getEmployeeDirectory();
  const bambooEmployees = directory && Array.isArray(directory.employees) ? directory.employees : [];
  const bambooEmails = new Set(
    bambooEmployees
      .map((e) => normalizeEmail(e?.workEmail))
      .filter(Boolean)
  );

  const slack = await usersList({ limit: 1000 });
  const slackMembersRaw = slack && Array.isArray(slack.members) ? slack.members : [];

  const slackUsers = slackMembersRaw
    .map(pickSlackUserForImport)
    .filter((u) => Boolean(u.email))
    .filter((u) => !u.deleted && !u.isBot);

  const toCreate = [];
  const alreadyExists = [];
  const skipped = [];

  for (const u of slackUsers) {
    if (bambooEmails.has(u.email)) {
      alreadyExists.push(u);
      continue;
    }
    if (!u.firstName) {
      skipped.push({ ...u, reason: 'missing_first_name' });
      continue;
    }
    toCreate.push(u);
  }

  // Trim results for safety.
  return {
    fetchedAt: new Date().toISOString(),
    bamboohr: {
      directoryEmployeeCount: bambooEmployees.length,
      directoryWithEmailCount: bambooEmails.size
    },
    slack: {
      memberCount: slackMembersRaw.length,
      importableUserCount: slackUsers.length
    },
    plan: {
      toCreateCount: toCreate.length,
      alreadyExistsCount: alreadyExists.length,
      skippedCount: skipped.length
    },
    toCreate: toCreate.slice(0, limit).map((u) => ({
      slackUserId: u.slackUserId,
      email: u.emailMasked,
      emailId: u.emailId,
      firstName: u.firstName,
      lastName: u.lastName
    })),
    alreadyExists: alreadyExists.slice(0, 50).map((u) => ({
      slackUserId: u.slackUserId,
      email: u.emailMasked,
      emailId: u.emailId
    })),
    skipped: skipped.slice(0, 50).map((u) => ({
      slackUserId: u.slackUserId,
      email: u.emailMasked,
      emailId: u.emailId,
      reason: u.reason
    })),
    notes: [
      'This plan will create BambooHR employee records for Slack users missing from BambooHR (matched by email).',
      'BambooHR trial data uses synthetic emails; expect most Slack users to be missing in BambooHR.',
      'Apply requires explicit confirmation to avoid accidental account modifications.'
    ]
  };
}

async function applyImport({ maxCreates = 20, confirm = false } = {}) {
  if (!confirm) {
    throw new HttpError(400, 'Refusing to create BambooHR employees without confirm=true', 'CONFIRM_REQUIRED');
  }
  const created = [];
  const failed = [];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Re-fetch Slack users to get real emails for the selected emailIds.
  const slack = await usersList({ limit: 1000 });
  const slackMembersRaw = slack && Array.isArray(slack.members) ? slack.members : [];
  const slackUsers = slackMembersRaw
    .map(pickSlackUserForImport)
    .filter((u) => Boolean(u.email))
    .filter((u) => !u.deleted && !u.isBot);

  const directory = await getEmployeeDirectory();
  const bambooEmployees = directory && Array.isArray(directory.employees) ? directory.employees : [];
  const bambooEmails = new Set(
    bambooEmployees
      .map((e) => normalizeEmail(e?.workEmail))
      .filter(Boolean)
  );

  const candidates = slackUsers.filter((u) => !bambooEmails.has(u.email));
  const toCreate = candidates.slice(0, maxCreates);

  for (const u of toCreate) {
    const payload = {
      firstName: u.firstName || 'Unknown',
      lastName: u.lastName || 'Slack',
      workEmail: u.email
    };

    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await createEmployee(payload);

      // Verify the employee actually appears in the directory (trials/permissions can no-op).
      let foundInDirectory = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const latestDirectory = await getEmployeeDirectory();
        const latestEmployees = latestDirectory && Array.isArray(latestDirectory.employees) ? latestDirectory.employees : [];
        const latestEmails = new Set(
          latestEmployees
            .map((e) => normalizeEmail(e?.workEmail))
            .filter(Boolean)
        );

        if (latestEmails.has(u.email)) {
          foundInDirectory = true;
          bambooEmails.add(u.email);
          break;
        }

        // eslint-disable-next-line no-await-in-loop
        await sleep(600);
      }

      if (!foundInDirectory) {
        failed.push({
          slackUserId: u.slackUserId,
          email: u.emailMasked,
          emailId: u.emailId,
          error: `Create returned status ${res?.status} but employee did not appear in directory (possible trial limitation or insufficient permissions).`
        });
        continue;
      }

      created.push({
        slackUserId: u.slackUserId,
        email: u.emailMasked,
        emailId: u.emailId,
        bamboohrEmployeeId: res?.employeeId || null,
        bamboohrStatus: res?.status,
        bamboohrRawResponse: res?.raw || ''
      });
    } catch (err) {
      failed.push({
        slackUserId: u.slackUserId,
        email: u.emailMasked,
        emailId: u.emailId,
        error: err?.message || String(err)
      });
    }
  }

  return {
    appliedAt: new Date().toISOString(),
    attemptedCreates: toCreate.length,
    createdCount: created.length,
    failedCount: failed.length,
    created: created.slice(0, 50),
    failed: failed.slice(0, 50),
    notes: [
      'BambooHR permissions vary: create employee may be blocked in trial or by API key permissions.',
      'If you get 403/404, use the demo mapping approach instead of creating employees.'
    ]
  };
}

module.exports = {
  buildImportPlan,
  applyImport
};
