const { HttpError } = require('../../shared/errors');
const { normalizeEmail, maskEmail, emailFingerprint } = require('../../shared/pii');
const { getEmployeeDirectory } = require('../../connectors/bamboohr/bamboohrClient');
const { usersList } = require('../../connectors/slack/slackClient');

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ');
}

function nameKeyFromParts(first, last) {
  const f = normalizeName(first).split(' ')[0] || '';
  const l = normalizeName(last).split(' ').slice(-1)[0] || '';
  if (!f || !l) return '';
  return `${f} ${l}`;
}

function bambooNameKey(e) {
  const direct = nameKeyFromParts(e?.firstName, e?.lastName);
  if (direct) return direct;
  return normalizeName(e?.displayName);
}

function slackNameKey(u) {
  const profile = u?.profile || {};
  const direct = nameKeyFromParts(profile.first_name, profile.last_name);
  if (direct) return direct;
  const rn = normalizeName(u?.real_name || profile.real_name || profile.real_name_normalized);
  if (rn) return rn;
  return normalizeName(profile.display_name || u?.name);
}

function pickBambooEmployee(e) {
  return {
    id: e?.id,
    employeeId: e?.employeeId,
    displayName: e?.displayName,
    firstName: e?.firstName,
    lastName: e?.lastName,
    jobTitle: e?.jobTitle,
    department: e?.department,
    location: e?.location,
    workEmail: e?.workEmail
  };
}

function pickSlackUser(u) {
  const profile = u?.profile || {};
  return {
    id: u?.id,
    name: u?.name,
    real_name: u?.real_name,
    deleted: Boolean(u?.deleted),
    is_bot: Boolean(u?.is_bot),
    is_restricted: Boolean(u?.is_restricted || u?.is_ultra_restricted),
    email: profile?.email,
    profile: {
      first_name: profile?.first_name,
      last_name: profile?.last_name,
      display_name: profile?.display_name,
      real_name: profile?.real_name,
      real_name_normalized: profile?.real_name_normalized
    }
  };
}

function buildIndex(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    const arr = map.get(key) || [];
    arr.push(item);
    map.set(key, arr);
  }
  return map;
}

function listDuplicates(indexMap) {
  const out = [];
  for (const [key, arr] of indexMap.entries()) {
    if (arr.length > 1) out.push({ key, count: arr.length });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

function maybeMaskEmail(email, includeEmails) {
  if (includeEmails) return normalizeEmail(email);
  return maskEmail(email);
}

function emailId(email) {
  return emailFingerprint(email);
}

async function compareBamboohrToSlack({ includeEmails = false } = {}) {
  if (!process.env.BAMBOOHR_COMPANY || !process.env.BAMBOOHR_API_KEY) {
    throw new HttpError(500, 'Missing BambooHR configuration (BAMBOOHR_COMPANY, BAMBOOHR_API_KEY)', 'BAMBOOHR_NOT_CONFIGURED');
  }
  if (!process.env.SLACK_BOT_TOKEN) {
    throw new HttpError(500, 'Missing Slack configuration (SLACK_BOT_TOKEN)', 'SLACK_NOT_CONFIGURED');
  }

  const directory = await getEmployeeDirectory();
  const bambooEmployeesRaw = directory && Array.isArray(directory.employees) ? directory.employees : [];
  const bambooEmployees = bambooEmployeesRaw.map(pickBambooEmployee);

  const slack = await usersList({ limit: 1000 });
  const slackMembersRaw = slack && Array.isArray(slack.members) ? slack.members : [];
  const slackMembers = slackMembersRaw.map(pickSlackUser);

  // Filter Slack users to those that look like real employees.
  const slackEmployees = slackMembers.filter((u) => {
    const email = normalizeEmail(u.email);
    if (!email) return false;
    if (u.deleted) return false;
    if (u.is_bot) return false;
    return true;
  });

  const bambooByEmail = buildIndex(
    bambooEmployees,
    (e) => normalizeEmail(e.workEmail)
  );
  const slackByEmail = buildIndex(
    slackEmployees,
    (u) => normalizeEmail(u.email)
  );

  const bambooEmails = new Set(bambooByEmail.keys());
  const slackEmails = new Set(slackByEmail.keys());

  const matchedEmails = [];
  for (const email of bambooEmails) {
    if (slackEmails.has(email)) matchedEmails.push(email);
  }

  const matchedPairs = matchedEmails.slice(0, 500).map((email) => {
    const bamboo = (bambooByEmail.get(email) || [])[0];
    const slackUser = (slackByEmail.get(email) || [])[0];
    return {
      email: maybeMaskEmail(email, includeEmails),
      emailId: emailId(email),
      bamboohrId: bamboo?.id || bamboo?.employeeId,
      bambooName: bamboo?.displayName,
      slackUserId: slackUser?.id,
      slackName: slackUser?.real_name || slackUser?.profile?.real_name || slackUser?.profile?.display_name || slackUser?.name
    };
  });

  // Name-based suggestions (useful when BambooHR trial emails don't exist in Slack)
  const bambooByName = buildIndex(bambooEmployees, (e) => bambooNameKey(e));
  const slackByName = buildIndex(slackEmployees, (u) => slackNameKey(u));
  const nameMatched = [];
  for (const [nk, slackArr] of slackByName.entries()) {
    const bambooArr = bambooByName.get(nk);
    if (!bambooArr || bambooArr.length === 0) continue;
    for (const su of slackArr) {
      nameMatched.push({
        nameKey: nk,
        slackUserId: su.id,
        slackName: su?.real_name || su?.profile?.real_name || su?.profile?.display_name || su?.name,
        slackEmail: maybeMaskEmail(normalizeEmail(su.email), includeEmails),
        slackEmailId: emailId(su.email),
        bambooCandidates: bambooArr.slice(0, 5).map((be) => ({
          bamboohrId: be?.id || be?.employeeId,
          bambooName: be?.displayName,
          bambooEmail: maybeMaskEmail(normalizeEmail(be.workEmail), includeEmails),
          bambooEmailId: emailId(be.workEmail)
        }))
      });
    }
  }
  nameMatched.sort((a, b) => (a.nameKey || '').localeCompare(b.nameKey || ''));

  const missingInSlack = [];
  for (const email of bambooEmails) {
    if (!slackEmails.has(email)) {
      missingInSlack.push({
        email: maybeMaskEmail(email, includeEmails),
        emailId: emailId(email),
        bambooCount: bambooByEmail.get(email)?.length || 0
      });
    }
  }
  missingInSlack.sort((a, b) => (a.email || '').localeCompare(b.email || ''));

  const missingInBamboo = [];
  for (const email of slackEmails) {
    if (!bambooEmails.has(email)) {
      missingInBamboo.push({
        email: maybeMaskEmail(email, includeEmails),
        emailId: emailId(email),
        slackCount: slackByEmail.get(email)?.length || 0
      });
    }
  }
  missingInBamboo.sort((a, b) => (a.email || '').localeCompare(b.email || ''));

  const bambooDuplicates = listDuplicates(bambooByEmail).map((d) => ({
    email: maybeMaskEmail(d.key, includeEmails),
    emailId: emailId(d.key),
    count: d.count
  }));
  const slackDuplicates = listDuplicates(slackByEmail).map((d) => ({
    email: maybeMaskEmail(d.key, includeEmails),
    emailId: emailId(d.key),
    count: d.count
  }));

  // If Slack email scope is missing, most users will have empty email.
  const slackWithEmailCount = slackMembers.filter((u) => Boolean(normalizeEmail(u.email))).length;
  const slackNoEmailCount = slackMembers.length - slackWithEmailCount;

  return {
    fetchedAt: new Date().toISOString(),
    bamboohr: {
      employeeCount: bambooEmployees.length,
      employeesWithEmail: bambooEmployees.filter((e) => Boolean(normalizeEmail(e.workEmail))).length
    },
    slack: {
      memberCount: slackMembers.length,
      usableEmployeeCount: slackEmployees.length,
      membersWithEmail: slackWithEmailCount,
      membersWithoutEmail: slackNoEmailCount
    },
    match: {
      matchedEmailCount: matchedEmails.length,
      missingInSlackCount: missingInSlack.length,
      missingInBambooCount: missingInBamboo.length,
      bambooDuplicateEmailCount: bambooDuplicates.length,
      slackDuplicateEmailCount: slackDuplicates.length
    },
    matchedPairs,
    bambooDuplicates,
    slackDuplicates,
    missingInSlack: missingInSlack.slice(0, 200),
    missingInBamboo: missingInBamboo.slice(0, 200),
    nameBasedSuggestions: nameMatched.slice(0, 200),
    notes: [
      'Matching uses email as the primary key: BambooHR employees/directory.workEmail ↔ Slack users.profile.email.',
      'If Slack returns many members without email, your token likely lacks users:read.email (or admins restrict email visibility).',
      'Slack bots and deleted accounts are excluded from the Slack employee set.',
      'If you cannot create/invite Slack users to match BambooHR trial users, use nameBasedSuggestions to map a subset of BambooHR employees to your existing Slack users (demo-mode).'
    ]
  };
}

module.exports = { compareBamboohrToSlack };
