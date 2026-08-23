const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeEmail } = require('../shared/pii');

const MOCK_DIR = path.resolve(__dirname, '../../../llm/mock_data');
const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_ORG_ID = 'demo';

let cachedData = null;
let chatState = null;

function isDemoMode() {
  const value = String(process.env.DEMO_MODE || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function readJson(fileName) {
  const filePath = path.join(MOCK_DIR, fileName);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function stableHash(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value), 'utf8').digest('hex').slice(0, 10);
}

function titleCase(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toMillis(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function daysAgo(days) {
  return new Date(Date.now() - Math.max(0, Number(days) || 0) * DAY_MS).toISOString();
}

function daysAhead(days) {
  return new Date(Date.now() + Math.max(0, Number(days) || 0) * DAY_MS).toISOString();
}

function isoDateDaysAgo(days) {
  return daysAgo(days).slice(0, 10);
}

function initialFor(name) {
  return String(name || '')
    .split(' ')
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase();
}

function buildRiskSignals(riskLevel) {
  const level = String(riskLevel || '').trim().toLowerCase();
  if (level === 'critical') {
    return { critical: 4, high: 3, medium: 1, low: 0 };
  }
  if (level === 'high') {
    return { critical: 1, high: 4, medium: 2, low: 0 };
  }
  if (level === 'medium') {
    return { critical: 0, high: 2, medium: 4, low: 1 };
  }
  return { critical: 0, high: 0, medium: 1, low: 4 };
}

function buildHistoryRows(baseScore, delta, count, kind) {
  const rows = [];
  const safeCount = Math.max(3, Number(count) || 6);
  for (let index = safeCount - 1; index >= 0; index -= 1) {
    const offset = index * 7 + 3;
    const score = clamp(baseScore - delta + ((delta * (safeCount - 1 - index)) / Math.max(1, safeCount - 1)), 0, 100);
    if (kind === 'sentiment') {
      rows.push({
        analyzedAt: daysAgo(offset),
        score: Number(score.toFixed(1)),
        smoothedScore: Number(clamp(score + 1.8, 0, 100).toFixed(1)),
      });
      continue;
    }

    const normalizedScore = Number(score.toFixed(1));
    rows.push({
      analyzedAt: daysAgo(offset),
      score: normalizedScore,
      level: normalizedScore >= 78 ? 'Critical' : normalizedScore >= 60 ? 'High' : normalizedScore >= 40 ? 'Medium' : 'Low',
      signalCounts: buildRiskSignals(normalizedScore >= 78 ? 'critical' : normalizedScore >= 60 ? 'high' : normalizedScore >= 40 ? 'medium' : 'low'),
      signalsBySeverity: buildRiskSignals(normalizedScore >= 78 ? 'critical' : normalizedScore >= 60 ? 'high' : normalizedScore >= 40 ? 'medium' : 'low'),
    });
  }

  return rows;
}

function employeeSeedProfiles() {
  return {
    'drashti maheswari': {
      department: 'People Operations',
      role: 'HR Generalist',
      manager: 'Harsh Shah',
      riskLevel: 'Low',
      healthScore: 85,
      sentimentScore: 82,
      riskScore: 18,
      confidence: 0.9,
      deltaRisk30d: -4,
      deltaSentiment7d: 6,
      observations: [
        'Strong engagement in coaching and onboarding conversations.',
        'Positive tone across meeting notes and follow-up actions.',
      ],
      sentimentEvidence: 'Clear prioritization and positive collaboration in HR check-ins.',
      riskSummary: 'Low retention risk with steady engagement and clear next steps.',
      slackMessageCount: 1,
    },
    'nihar mehta': {
      department: 'IT',
      role: 'IT Security Engineer',
      manager: 'Aaron Eckerly',
      riskLevel: 'Critical',
      healthScore: 31,
      sentimentScore: 28,
      riskScore: 88,
      confidence: 0.96,
      deltaRisk30d: 18,
      deltaSentiment7d: -14,
      observations: [
        'Repeated language about wanting to quit and missing promotion expectations.',
        'Needs immediate manager and HR follow-up.',
      ],
      sentimentEvidence: 'Explicit exit-intent language and frustrated tone in Slack.',
      riskSummary: 'Critical retention risk driven by compensation dissatisfaction and exit-intent signals.',
      slackMessageCount: 2,
    },
    'harsh shah': {
      department: 'Operations',
      role: 'Operations Lead',
      manager: 'Shah, Harsh',
      riskLevel: 'High',
      healthScore: 47,
      sentimentScore: 42,
      riskScore: 72,
      confidence: 0.88,
      deltaRisk30d: 11,
      deltaSentiment7d: -8,
      observations: [
        'Workload and planning clarity are recurring themes in meeting notes.',
        'The profile shows elevated risk but still responds to structured support.',
      ],
      sentimentEvidence: 'Frustration around priorities and role clarity.',
      riskSummary: 'High retention risk with workload and ownership ambiguity.',
      slackMessageCount: 2,
    },
    'nikhil solanki': {
      department: 'Product',
      role: 'Product Analyst',
      manager: 'Harsh Shah',
      riskLevel: 'Medium',
      healthScore: 66,
      sentimentScore: 58,
      riskScore: 52,
      confidence: 0.85,
      deltaRisk30d: 6,
      deltaSentiment7d: -2,
      observations: [
        'Looking for clearer weekly priorities and ownership boundaries.',
        'Responds positively when structure is added.',
      ],
      sentimentEvidence: 'Mixed tone with some frustration around process.',
      riskSummary: 'Moderate retention risk with a need for clearer operating rhythm.',
      slackMessageCount: 1,
    },
    'parth srivastava': {
      department: 'HR',
      role: 'HR Specialist',
      manager: 'Harsh Shah',
      riskLevel: 'Low',
      healthScore: 88,
      sentimentScore: 86,
      riskScore: 16,
      confidence: 0.94,
      deltaRisk30d: -6,
      deltaSentiment7d: 8,
      observations: [
        'Consistently positive in the 1:1 review notes.',
        'Good candidate for recognition and stretch opportunities.',
      ],
      sentimentEvidence: 'Positive collaboration and follow-up behavior.',
      riskSummary: 'Low risk and strong engagement with leadership potential.',
      slackMessageCount: 1,
    },
  };
}

function buildDemoEmployee(rawEmployee, index, meetingMap, slackMap) {
  const name = String(rawEmployee?.displayName || `${rawEmployee?.firstName || ''} ${rawEmployee?.lastName || ''}`.trim()).trim();
  const email = normalizeEmail(rawEmployee?.workEmail || rawEmployee?.email || '');
  const key = name.toLowerCase();
  const seed = employeeSeedProfiles()[key] || {};
  const meeting = meetingMap.get(email) || {};
  const slackMessageCount = Number(seed.slackMessageCount || slackMap.get(email)?.count || 0);

  const sentimentScore = Number(seed.sentimentScore || 70);
  const healthScore = Number(seed.healthScore || 72);
  const riskScore = Number(seed.riskScore || 40);
  const confidence = Number(seed.confidence || 0.82);
  const riskLevel = String(seed.riskLevel || 'Low');
  const manager = String(seed.manager || rawEmployee?.supervisor || rawEmployee?.manager || '');
  const department = String(seed.department || rawEmployee?.department || rawEmployee?.division || '');
  const role = String(seed.role || rawEmployee?.role || rawEmployee?.jobTitle || 'Employee');
  const deltaRisk30d = Number(seed.deltaRisk30d || 0);
  const deltaSentiment7d = Number(seed.deltaSentiment7d || 0);
  const meetingCount = Number(meeting.count || 0);
  const lastMeetingAt = meeting.lastMeetingAt || daysAgo(6 + index);
  const sentimentHistory = buildHistoryRows(sentimentScore, deltaSentiment7d, 6, 'sentiment');
  const riskHistory = buildHistoryRows(riskScore, deltaRisk30d, 6, 'risk');
  const sentimentKeyEvidence = [
    String(seed.sentimentEvidence || '').trim(),
    String(seed.observations?.[0] || '').trim(),
  ].filter(Boolean);

  return {
    id: String(rawEmployee?.id || rawEmployee?.employeeId || email || `${index}`),
    email,
    name,
    dept: department,
    role,
    manager,
    joinDate: String(rawEmployee?.hireDate || rawEmployee?.joinDate || isoDateDaysAgo(180 + index * 45)),
    lastMeeting: lastMeetingAt,
    totalMeetings: meetingCount,
    risk: riskLevel,
    sentiment: sentimentScore >= 70 ? 'Positive' : sentimentScore >= 45 ? 'Neutral' : 'Negative',
    score: healthScore,
    sentimentScoreRaw: sentimentScore,
    healthScore,
    riskScore,
    confidence,
    deltaRisk30d,
    deltaSentiment7d,
    scoringVersion: 'demo-v1',
    updatedAt: daysAgo(index + 1),
    sentimentTrend: sentimentScore >= 70 ? 'Positive' : sentimentScore >= 45 ? 'Neutral' : 'Negative',
    sentimentEvidence: seed.sentimentEvidence || '',
    sentimentKeyEvidence,
    riskLevel,
    riskSummary: seed.riskSummary || '',
    slackMessageCount,
    lastMeetingAt,
    observations: Array.isArray(seed.observations) ? seed.observations : [],
    sourceStats: {
      slackMessageCount,
    },
    analysis: {
      sentiment: {
        score: sentimentScore,
        trend: sentimentScore >= 70 ? 'Positive' : sentimentScore >= 45 ? 'Neutral' : 'Negative',
        evidence: seed.sentimentEvidence || '',
        keyEvidence: sentimentKeyEvidence,
      },
      health: {
        score: healthScore,
        band: healthScore >= 80 ? 'Strong' : healthScore >= 60 ? 'Healthy' : 'Watch',
      },
      retentionRisk: {
        level: riskLevel,
        score: riskScore,
        summary: seed.riskSummary || '',
        signals: [
          {
            severity: riskLevel,
            text: seed.riskSummary || '',
          },
        ],
        signalCounts: buildRiskSignals(riskLevel),
      },
      components: {
        confidence,
        contributors: {
          slack: slackMessageCount > 0 ? 1 : 0,
          meetings: meetingCount > 0 ? 1 : 0,
          hrms: 1,
        },
      },
      temporal: {
        deltaRisk30d,
        deltaSentiment7d,
      },
      extractionMeta: {
        source: 'demo-fixture',
        employeeIndex: index,
      },
      observations: Array.isArray(seed.observations) ? seed.observations : [],
      scoringVersion: 'demo-v1',
    },
    demoHistory: {
      sentimentHistory,
      riskHistory,
    },
  };
}

function getDataset() {
  if (cachedData) {
    return cachedData;
  }

  const bamboo = readJson('bamboohr_data.json');
  const meetingsSeed = readJson('meeting_transcript.json');
  const slackSeed = readJson('hr_slack_simulation.json');

  const rawEmployees = Array.isArray(bamboo.employees) ? bamboo.employees : [];
  const slackMembers = Array.isArray(slackSeed.members) ? slackSeed.members : [];
  const slackMessages = [...(Array.isArray(slackSeed.general) ? slackSeed.general : []), ...(Array.isArray(slackSeed.hr_discussions) ? slackSeed.hr_discussions : [])];

  const slackByEmail = new Map();
  slackMembers.forEach((member) => {
    const email = normalizeEmail(member?.email);
    if (!email) return;
    const count = slackMessages.filter((message) => normalizeEmail(message?.realName || '').toLowerCase() === String(member?.realName || '').toLowerCase()).length;
    slackByEmail.set(email, { member, count });
  });

  const employeeByEmail = new Map();
  const employeeByName = new Map();
  rawEmployees.forEach((row) => {
    const email = normalizeEmail(row?.workEmail || row?.email || '');
    const name = String(row?.displayName || `${row?.firstName || ''} ${row?.lastName || ''}`.trim()).trim();
    const normalizedName = name.toLowerCase();
    if (email) employeeByEmail.set(email, row);
    if (normalizedName) employeeByName.set(normalizedName, row);
  });

  const meetingByEmail = new Map();
  const meetingTranscriptById = new Map();
  const recentMeetings = [];

  const seedMeetings = Array.isArray(meetingsSeed.meetings) ? meetingsSeed.meetings : [];
  seedMeetings.forEach((meetingSeed, index) => {
    const participant = Array.isArray(meetingSeed?.meeting_brief?.attendees)
      ? meetingSeed.meeting_brief.attendees.find((item) => String(item?.role || '').toLowerCase() === 'employee')
      : null;
    const employeeName = String(participant?.name || '').trim();
    const employeeRow = employeeByName.get(employeeName.toLowerCase());
    const email = normalizeEmail(meetingSeed?.employeeEmail || employeeRow?.workEmail || employeeRow?.email || '');
    const name = String(employeeRow?.displayName || employeeName || '').trim();
    const meetingAt = daysAgo(index * 2 + 1);
    const transcript = Array.isArray(meetingSeed?.transcript) ? meetingSeed.transcript : [];
    const summary = Array.isArray(meetingSeed?.meeting_brief?.key_takeaways)
      ? meetingSeed.meeting_brief.key_takeaways.join(' ')
      : String(meetingSeed?.meeting_brief?.meeting_objective || '').trim();
    const meetingId = `demo-fireflies:${stableHash({ email, index, name })}`;

    const row = {
      meetingId,
      title: `${name || 'Employee'} 1:1`,
      meetingAt,
      employeeEmail: email,
      participants: email ? [email] : [],
      summary,
      hrInvolved: true,
      source: 'fireflies',
      date: meetingAt.slice(0, 10),
      empName: name,
      type: `${String(meetingSeed?.meeting_brief?.previous_meeting || 'HR Review')}`,
      transcript,
      brief: meetingSeed?.meeting_brief || null,
    };

    recentMeetings.push(row);
    if (email) {
      meetingByEmail.set(email, {
        count: (meetingByEmail.get(email)?.count || 0) + 1,
        lastMeetingAt: meetingAt,
      });
    }
    meetingTranscriptById.set(meetingId, row);
  });

  const demoEmployees = rawEmployees.map((row, index) => buildDemoEmployee(row, index, meetingByEmail, slackByEmail));

  const futureMeetings = demoEmployees.slice(0, 3).map((employee, index) => ({
    meetingId: `demo-calendar:${stableHash({ email: employee.email, index })}`,
    title: `${employee.name} follow-up`,
    meetingAt: daysAhead(index + 1),
    employeeEmail: employee.email,
    participants: employee.email ? [employee.email] : [],
    summary: `Follow-up conversation for ${employee.name} to review priorities, support, and next steps.`,
    hrInvolved: true,
    source: 'google_calendar',
    date: daysAhead(index + 1).slice(0, 10),
    empName: employee.name,
    type: 'Follow-up sync',
    transcript: [],
    brief: null,
  }));

  const employeeIndexByEmail = new Map(demoEmployees.map((employee) => [employee.email, employee]));

  cachedData = {
    orgId: DEMO_ORG_ID,
    sourceSystem: 'demo',
    fetchedAt: new Date().toISOString(),
    employees: demoEmployees,
    meetings: [...recentMeetings, ...futureMeetings].sort((a, b) => toMillis(b.meetingAt) - toMillis(a.meetingAt)),
    meetingTranscriptById,
    slackSeed,
    employeeIndexByEmail,
    slackByEmail,
    seedMeetings,
    chatState: null,
  };

  return cachedData;
}

function getEmployees() {
  return getDataset().employees.map((employee) => ({
    ...employee,
    analysis: {
      ...employee.analysis,
      extractionMeta: {
        ...employee.analysis.extractionMeta,
        fetchedAt: getDataset().fetchedAt,
      },
    },
  }));
}

function getDashboardSummary() {
  const employees = getEmployees();
  const meetings = listMeetings({ limit: 500, includeNonHr: true });
  const riskCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  let totalHealth = 0;
  let risingRiskEmployees = 0;

  employees.forEach((employee) => {
    const risk = String(employee.risk || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(riskCounts, risk)) {
      riskCounts[risk] += 1;
    }
    totalHealth += Number(employee.healthScore || 0);
    if (Number(employee.deltaRisk30d || 0) > 0) {
      risingRiskEmployees += 1;
    }
  });

  const atRiskEmployees = employees.filter((employee) => ['medium', 'high', 'critical'].includes(String(employee.risk || '').toLowerCase())).length;
  const averageHealthScore = employees.length ? Number((totalHealth / employees.length).toFixed(1)) : 0;
  const recentThreshold = Date.now() - 7 * DAY_MS;
  const meetingsThisWeek = meetings.filter((meeting) => toMillis(meeting.meetingAt) >= recentThreshold).length;
  const todayMeetings = meetings.filter((meeting) => String(meeting.meetingAt || '').slice(0, 10) === new Date().toISOString().slice(0, 10));

  return {
    totalEmployees: employees.length,
    employeeCount: employees.length,
    meetingsThisWeek,
    weeklyMeetingCount: meetingsThisWeek,
    atRiskEmployees,
    highRiskCount: employees.filter((employee) => ['high', 'critical'].includes(String(employee.risk || '').toLowerCase())).length,
    risingRiskEmployees,
    averageHealthScore,
    riskCounts,
    todayMeetings,
    employees: employees.map((employee) => ({
      email: employee.email,
      employeeEmail: employee.email,
      name: employee.name,
      employeeName: employee.name,
      dept: employee.dept,
      department: employee.dept,
      role: employee.role,
      jobTitle: employee.role,
      riskLevel: employee.risk,
      sentimentTrend: employee.sentiment,
      sentimentScore: employee.sentimentScoreRaw,
      healthScore: employee.healthScore,
      confidence: employee.confidence,
      deltaRisk30d: employee.deltaRisk30d,
      deltaSentiment7d: employee.deltaSentiment7d,
      score: employee.healthScore,
      updatedAt: employee.updatedAt,
    })),
  };
}

function getEmployeeProfile(email) {
  const employee = getDataset().employeeIndexByEmail.get(normalizeEmail(email));
  if (!employee) {
    return null;
  }

  return {
    employeeEmail: employee.email,
    employeeName: employee.name,
    displayName: employee.name,
    name: employee.name,
    department: employee.dept,
    dept: employee.dept,
    role: employee.role,
    jobTitle: employee.role,
    manager: employee.manager,
    joinDate: employee.joinDate,
    meetingCount: employee.totalMeetings,
    lastMeetingAt: employee.lastMeetingAt,
    healthScore: employee.healthScore,
    sentimentScore: employee.sentimentScoreRaw,
    riskScore: employee.riskScore,
    confidence: employee.confidence,
    deltaRisk30d: employee.deltaRisk30d,
    deltaSentiment7d: employee.deltaSentiment7d,
    sourceStats: employee.sourceStats,
    scoringVersion: employee.scoringVersion,
    updatedAt: employee.updatedAt,
    analysis: employee.analysis,
  };
}

function getEmployeeHistory(email, limit = 30) {
  const employee = getDataset().employeeIndexByEmail.get(normalizeEmail(email));
  if (!employee) {
    return null;
  }

  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 180));
  return {
    employeeEmail: employee.email,
    limit: safeLimit,
    sentimentHistory: employee.demoHistory.sentimentHistory.slice(-safeLimit),
    riskHistory: employee.demoHistory.riskHistory.slice(-safeLimit),
    summary: {
      latestSentimentScore: employee.sentimentScoreRaw,
      latestRiskScore: employee.riskScore,
      sentimentDelta: employee.deltaSentiment7d,
      riskDelta: employee.deltaRisk30d,
    },
  };
}

function listMeetings({ employeeEmail, query, limit = 20, includeNonHr = false }) {
  const normalizedEmail = normalizeEmail(employeeEmail);
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 500));
  const meetings = getDataset().meetings.filter((meeting) => {
    if (!includeNonHr && meeting.hrInvolved === false) {
      return false;
    }
    if (normalizedEmail) {
      const participants = Array.isArray(meeting.participants) ? meeting.participants.map(normalizeEmail) : [];
      if (normalizeEmail(meeting.employeeEmail) !== normalizedEmail && !participants.includes(normalizedEmail)) {
        return false;
      }
    }
    if (!normalizedQuery) {
      return true;
    }
    const haystack = `${meeting.title || ''} ${meeting.summary || ''} ${(meeting.participants || []).join(' ')}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  return meetings.slice(0, safeLimit).map((meeting) => ({
    meetingId: meeting.meetingId,
    title: meeting.title,
    meetingAt: meeting.meetingAt,
    employeeEmail: meeting.employeeEmail,
    participants: meeting.participants,
    summary: meeting.summary,
    source: meeting.source,
  }));
}

function getMeetingTranscript(meetingId, query = '') {
  const id = String(meetingId || '').trim();
  const meeting = getDataset().meetingTranscriptById.get(id) || getDataset().meetings.find((row) => row.meetingId === id);
  if (!meeting) {
    return null;
  }

  const transcript = Array.isArray(meeting.transcript)
    ? meeting.transcript.map((row, index) => ({
        turnIndex: Number.isFinite(Number(row?.turnIndex)) ? Number(row.turnIndex) : index,
        speaker: String(row?.speaker || row?.speaker_name || row?.role || '').trim() || null,
        text: String(row?.text || row?.message || '').trim(),
      })).filter((row) => row.text)
    : [];

  const normalizedQuery = String(query || '').trim().toLowerCase();
  const filteredTranscript = normalizedQuery
    ? transcript.filter((row) => `${row.speaker || ''} ${row.text}`.toLowerCase().includes(normalizedQuery))
    : transcript;

  return {
    meetingId: meeting.meetingId,
    title: meeting.title,
    meetingAt: meeting.meetingAt,
    participants: meeting.participants,
    summary: meeting.summary,
    transcript: filteredTranscript,
    transcriptCount: filteredTranscript.length,
    totalTranscriptCount: transcript.length,
    source: meeting.source,
  };
}

function buildBriefForEmployee(email, meetingAt, participantEmails = []) {
  const employee = getDataset().employeeIndexByEmail.get(normalizeEmail(email));
  if (!employee) {
    return null;
  }

  const meetings = listMeetings({ employeeEmail: employee.email, limit: 50, includeNonHr: true });
  const selectedMeeting = meetings.find((meeting) => String(meeting.meetingAt || '') === String(meetingAt || '')) || meetings[0] || null;
  const participantNames = Array.isArray(participantEmails) ? participantEmails.map((value) => String(value || '').split('@')[0]).slice(0, 4) : [];

  return {
    brief: {
      executiveSummary: `${employee.name} is currently ${String(employee.risk || '').toLowerCase()} risk with ${employee.sentiment === 'Positive' ? 'strong' : 'mixed'} engagement indicators.`,
      healthBand: employee.analysis.health.band,
      recommendedTone: employee.risk === 'Critical' || employee.risk === 'High' ? 'Supportive and direct' : 'Encouraging',
      relationshipStatus: employee.risk === 'Critical' ? 'Needs immediate attention' : employee.risk === 'High' ? 'Watch closely' : 'Stable',
      handleCarefully: [
        employee.risk === 'Critical' ? 'Address retention concerns immediately' : 'Keep the meeting practical and grounded',
        'Confirm next steps before ending the call',
      ],
      whatChangedSinceLastMeeting: Array.isArray(employee.observations) ? employee.observations.slice(0, 2) : [],
      conversationStarters: [
        `${employee.name}, what would make this week easier?`,
        selectedMeeting ? `Since your last ${selectedMeeting.title}, what shifted most?` : 'What is the main blocker right now?',
        participantNames.length ? `How should we involve ${participantNames.join(', ')} in the follow-up?` : 'Who else should be aligned on these next steps?',
      ],
      openFollowUps: [
        {
          owner: 'HR',
          task: 'Document the follow-up and assign an owner',
        },
        {
          owner: employee.manager || 'Manager',
          task: 'Review support plan and escalation risks',
        },
      ],
    },
    participantInsights: participantNames.map((value) => ({
      name: value,
      note: `${value} is included in the meeting context for the demo brief.`,
    })),
    relationshipStatus: employee.risk === 'Critical' ? 'Needs immediate attention' : employee.risk === 'High' ? 'Watch closely' : 'Stable',
    message: `Demo brief ready for ${employee.name}.`,
  };
}

function listChatSessions({ limit = 50, status } = {}) {
  const sessions = ensureChatState().sessions;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  return [...sessions.values()]
    .filter((session) => {
      if (!status) return true;
      return String(session.status || '').toLowerCase() === String(status || '').toLowerCase();
    })
    .sort((a, b) => toMillis(b.lastMessageAt || b.startedAt) - toMillis(a.lastMessageAt || a.startedAt))
    .slice(0, safeLimit)
    .map((session) => ({
      sessionId: session.sessionId,
      title: session.title,
      status: session.status,
      startedAt: session.startedAt,
      lastMessageAt: session.lastMessageAt,
    }));
}

function ensureChatState() {
  if (chatState) {
    return chatState;
  }

  const dataset = getDataset();
  const topRiskEmployees = dataset.employees
    .filter((employee) => ['Critical', 'High'].includes(employee.risk))
    .slice(0, 2);

  const seededMessages = [
    {
      role: 'user',
      content: 'Show me the highest retention risk employees.',
      createdAt: daysAgo(1),
      metadata: {},
    },
    {
      role: 'assistant',
      content: `Top risk employees are ${topRiskEmployees.map((employee) => employee.name).join(', ') || 'not available'}.`,
      createdAt: daysAgo(1),
      metadata: {
        count: topRiskEmployees.length,
        filters: { topic: 'retention risk' },
        transcriptCards: topRiskEmployees.map((employee) => ({
          employeeName: employee.name,
          employeeEmail: employee.email,
          summary: employee.riskSummary || employee.sentimentEvidence || 'No summary available.',
        })),
      },
    },
  ];

  const seedSessionId = 'demo-risk-review';
  chatState = {
    sessions: new Map([
      [seedSessionId, {
        sessionId: seedSessionId,
        title: 'Retention risk review',
        status: 'active',
        startedAt: daysAgo(2),
        lastMessageAt: daysAgo(1),
        messages: seededMessages,
      }],
    ]),
    counter: 1,
  };

  return chatState;
}

function createChatSession(sessionId = '') {
  const state = ensureChatState();
  const key = String(sessionId || '').trim() || `demo-session-${state.counter += 1}`;
  if (!state.sessions.has(key)) {
    state.sessions.set(key, {
      sessionId: key,
      title: 'New chat',
      status: 'active',
      startedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      messages: [],
    });
  }
  const session = state.sessions.get(key);
  return {
    sessionId: session.sessionId,
    title: session.title,
    status: session.status,
    startedAt: session.startedAt,
    lastMessageAt: session.lastMessageAt,
  };
}

function updateChatSession(sessionId, patch = {}) {
  const state = ensureChatState();
  const key = String(sessionId || '').trim();
  if (!key || !state.sessions.has(key)) return null;
  const session = state.sessions.get(key);
  const next = {
    ...session,
    ...patch,
    sessionId: key,
    updatedAt: new Date().toISOString(),
  };
  state.sessions.set(key, next);
  return {
    sessionId: next.sessionId,
    title: next.title,
    status: next.status,
    startedAt: next.startedAt,
    lastMessageAt: next.lastMessageAt,
  };
}

function deleteChatSession(sessionId) {
  const state = ensureChatState();
  const key = String(sessionId || '').trim();
  if (!key) return null;
  const existing = state.sessions.get(key) || null;
  state.sessions.delete(key);
  return existing
    ? {
        sessionId: existing.sessionId,
        title: existing.title,
        status: existing.status,
      }
    : null;
}

function getChatSessionHistory(sessionId) {
  const state = ensureChatState();
  const session = state.sessions.get(String(sessionId || '').trim());
  if (!session) {
    return { sessionId: String(sessionId || '').trim(), data: [], session: null };
  }

  return {
    sessionId: session.sessionId,
    data: Array.isArray(session.messages) ? session.messages : [],
    session: {
      sessionId: session.sessionId,
      title: session.title,
      status: session.status,
      startedAt: session.startedAt,
      lastMessageAt: session.lastMessageAt,
    },
  };
}

function buildChatAnswer(query, sessionId = '') {
  const employees = getEmployees();
  const text = String(query || '').trim().toLowerCase();
  let matches = [];
  let topic = 'retention risk';
  let answer = '';

  if (/(recognition|thriving|positive)/.test(text)) {
    topic = 'recognition';
    matches = employees.filter((employee) => employee.risk === 'Low' && employee.sentiment === 'Positive');
    answer = `The strongest recognition candidates are ${matches.map((employee) => employee.name).join(', ')}.`;
  } else if (/(sentiment|burnout|workload|frustration|stress)/.test(text)) {
    topic = 'sentiment';
    matches = employees
      .filter((employee) => Number(employee.deltaSentiment7d || 0) < 0)
      .sort((a, b) => Number(a.deltaSentiment7d || 0) - Number(b.deltaSentiment7d || 0));
    answer = `The biggest sentiment drops are in ${matches.map((employee) => employee.name).join(', ')}.`;
  } else if (/(brief|1:1|meeting|upcoming)/.test(text)) {
    topic = 'briefs';
    matches = employees.filter((employee) => ['Critical', 'High'].includes(employee.risk)).slice(0, 3);
    answer = `Use a supportive tone for ${matches.map((employee) => employee.name).join(', ')} and confirm follow-ups before ending the meeting.`;
  } else {
    matches = employees
      .filter((employee) => ['Critical', 'High', 'Medium'].includes(employee.risk))
      .sort((a, b) => {
        const riskOrder = { Critical: 3, High: 2, Medium: 1, Low: 0 };
        return (riskOrder[b.risk] || 0) - (riskOrder[a.risk] || 0);
      })
      .slice(0, 3);
    answer = `I found ${matches.length} employees worth immediate attention: ${matches.map((employee) => employee.name).join(', ')}.`;
  }

  const transcriptCards = matches.slice(0, 3).map((employee) => ({
    employeeName: employee.name,
    employeeEmail: employee.email,
    summary: employee.riskSummary || employee.sentimentEvidence || 'No summary available.',
  }));

  const filters = {
    topic,
    sessionId: sessionId || undefined,
  };

  return {
    answer,
    transcriptCards,
    filters,
    count: transcriptCards.length,
  };
}

function appendChatMessage(sessionId, role, content, metadata = {}) {
  const state = ensureChatState();
  const key = String(sessionId || '').trim();
  const session = state.sessions.get(key);
  if (!session) {
    return null;
  }

  const createdAt = new Date().toISOString();
  session.messages = Array.isArray(session.messages) ? session.messages : [];
  session.messages.push({
    role,
    content,
    createdAt,
    metadata,
  });
  session.lastMessageAt = createdAt;
  if (session.title === 'New chat' && role === 'user') {
    session.title = String(content || '').slice(0, 42) || 'New chat';
  }

  state.sessions.set(key, session);
  return session;
}

function queryChat(query, sessionId = '') {
  const session = createChatSession(sessionId);
  const userSessionId = session.sessionId;
  appendChatMessage(userSessionId, 'user', String(query || '').trim(), {});
  const result = buildChatAnswer(query, userSessionId);
  appendChatMessage(userSessionId, 'assistant', result.answer, {
    transcriptCards: result.transcriptCards,
    filters: result.filters,
    count: result.count,
  });
  return {
    sessionId: userSessionId,
    ...result,
    appliedFilters: result.filters,
  };
}

function getDemoHealth() {
  return {
    ok: true,
    service: 'intellihr-backend-demo',
    demoMode: true,
    ts: new Date().toISOString(),
  };
}

function getDemoDbHealth() {
  return {
    ok: true,
    data: {
      before: {
        uriSet: false,
        readyState: 0,
        state: 'demo',
        name: null,
        host: null,
        demoMode: true,
      },
      connectAttempt: {
        connected: false,
        reason: 'DEMO_MODE',
      },
      after: {
        uriSet: false,
        readyState: 0,
        state: 'demo',
        name: null,
        host: null,
        demoMode: true,
      },
    },
  };
}

function getDemoIngestionSummary(kind, extra = {}) {
  const employees = getEmployees();
  const meetings = listMeetings({ limit: 500, includeNonHr: true });

  if (kind === 'fireflies') {
    return {
      ok: true,
      data: {
        orgId: DEMO_ORG_ID,
        transcriptsSeen: meetings.filter((meeting) => meeting.source === 'fireflies').length,
        meetingsUpserted: meetings.filter((meeting) => meeting.source === 'fireflies').length,
        updatedMeetings: meetings.filter((meeting) => meeting.source === 'fireflies').length,
        source: 'demo-fixture',
      },
    };
  }

  if (kind === 'slackUsers') {
    return {
      ok: true,
      data: {
        orgId: DEMO_ORG_ID,
        usersSeen: employees.length,
        usersUpserted: employees.length,
        source: 'demo-fixture',
      },
    };
  }

  if (kind === 'slackChannels') {
    return {
      ok: true,
      data: {
        orgId: DEMO_ORG_ID,
        snapshotAt: new Date().toISOString(),
        channelsSeen: 1,
        channelIds: ['general'],
        channelsDocumentId: 'demo-slack-channels',
      },
    };
  }

  if (kind === 'slackMessages') {
    return {
      ok: true,
      data: {
        orgId: DEMO_ORG_ID,
        channelId: extra.channelId || 'general',
        oldest: daysAgo(14),
        watermarkTs: new Date().toISOString(),
        messagesSeen: getDataset().slackSeed.general.length,
        documentsUpserted: getDataset().slackSeed.general.length,
        participantsUpserted: employees.length,
        includeReplies: false,
      },
    };
  }

  if (kind === 'calendar') {
    return {
      ok: true,
      data: {
        orgId: DEMO_ORG_ID,
        calendarId: extra.calendarId || 'primary',
        timeMin: daysAgo(1),
        timeMax: daysAhead(14),
        eventsSeen: meetings.filter((meeting) => meeting.source === 'google_calendar').length,
        eventsStored: meetings.filter((meeting) => meeting.source === 'google_calendar').length,
      },
    };
  }

  if (kind === 'pipeline') {
    return {
      ok: true,
      data: {
        acceptedCount: employees.length,
        totalCandidates: employees.length,
        errorCount: 0,
        reason: extra.reason || 'demo-pipeline',
        demoMode: true,
      },
    };
  }

  if (kind === 'bambooSync') {
    return {
      ok: true,
      data: {
        acceptedCount: employees.length,
        totalCandidates: employees.length,
        errorCount: 0,
        demoMode: true,
      },
    };
  }

  return {
    ok: true,
    data: {
      demoMode: true,
    },
  };
}

function getDemoMeetingsResponse({ employeeEmail, query, limit, includeNonHr }) {
  const data = listMeetings({ employeeEmail, query, limit, includeNonHr });
  return {
    ok: true,
    count: data.length,
    data,
    sources: {
      llm: 0,
      googleCalendar: data.filter((row) => row.source === 'google_calendar').length,
      fireflies: data.filter((row) => row.source === 'fireflies').length,
    },
    partial: false,
  };
}

module.exports = {
  isDemoMode,
  getDemoHealth,
  getDemoDbHealth,
  getEmployees,
  getDashboardSummary,
  getEmployeeProfile,
  getEmployeeHistory,
  getMeetings: listMeetings,
  getMeetingTranscript,
  buildBriefForEmployee,
  listChatSessions,
  createChatSession,
  updateChatSession,
  deleteChatSession,
  getChatSessionHistory,
  queryChat,
  getDemoIngestionSummary,
  getDemoMeetingsResponse,
};
