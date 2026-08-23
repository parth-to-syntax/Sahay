import { analyzeHealthScoreWithLLM } from "../analysis/llmHealthScore.js";
import { analyzeMeetingBriefWithLLM } from "../analysis/llmMeetingBrief.js";

const WEIGHTS = {
  sentiment: 0.3,
  retentionSafety: 0.4,
  engagement: 0.2,
  hrmsIndicators: 0.1,
};

const RETENTION_SIGNALS = {
  critical: [
    "mentioned other companies or opportunities",
    "asked about internal transfers",
    "referenced linkedin or job search",
    "expressed feeling undervalued repeatedly",
    "declined meetings with chro",
  ],
  high: [
    "promotion passed over without explanation",
    "workload complaints over 3+ weeks",
    "manager conflict mentioned",
    "sentiment dropped 20+ points in 30 days",
    "reduced slack activity by 50%+",
  ],
  medium: [
    "work life balance concerns",
    "unclear career path mentioned",
    "team dynamics issues raised",
    "leave days unusually high",
    "skipped team channels",
  ],
  low: [
    "minor frustrations expressed",
    "slight sentiment dip",
    "single complaint resolved",
  ],
};

const SIGNAL_MATCHERS = [
  {
    tier: "critical",
    signal: RETENTION_SIGNALS.critical[0],
    patterns: ["other opportunities", "reassess my options", "offers", "recruiters"],
  },
  {
    tier: "critical",
    signal: RETENTION_SIGNALS.critical[1],
    patterns: ["internal transfer", "move teams"],
  },
  {
    tier: "critical",
    signal: RETENTION_SIGNALS.critical[2],
    patterns: ["linkedin", "job search"],
  },
  {
    tier: "critical",
    signal: RETENTION_SIGNALS.critical[3],
    patterns: ["undervalued", "not valued"],
  },
  {
    tier: "critical",
    signal: RETENTION_SIGNALS.critical[4],
    patterns: ["decline meeting", "declined meeting"],
  },
  {
    tier: "high",
    signal: RETENTION_SIGNALS.high[0],
    patterns: ["passed over for promotion", "promotion without explanation"],
  },
  {
    tier: "high",
    signal: RETENTION_SIGNALS.high[1],
    patterns: ["workload", "unsustainable", "overloaded", "fire-fighting"],
  },
  {
    tier: "high",
    signal: RETENTION_SIGNALS.high[2],
    patterns: ["manager conflict", "conflicting direction"],
  },
  {
    tier: "high",
    signal: RETENTION_SIGNALS.high[4],
    patterns: ["less active in slack", "responding only when tagged", "quieter in team channels"],
  },
  {
    tier: "medium",
    signal: RETENTION_SIGNALS.medium[0],
    patterns: ["work life balance", "burnout", "low energy", "fatigue"],
  },
  {
    tier: "medium",
    signal: RETENTION_SIGNALS.medium[1],
    patterns: ["career path", "promotion criteria", "unclear"],
  },
  {
    tier: "medium",
    signal: RETENTION_SIGNALS.medium[2],
    patterns: ["team dynamics", "alignment", "communication norms"],
  },
  {
    tier: "low",
    signal: RETENTION_SIGNALS.low[0],
    patterns: ["frustration", "concern"],
  },
];

const TIER_SCORES = {
  critical: 34,
  high: 20,
  medium: 10,
  low: 5,
};

function clampScore(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function getRiskLevel(riskScore) {
  if (riskScore >= 76) {
    return "critical";
  }
  if (riskScore >= 51) {
    return "high";
  }
  if (riskScore >= 26) {
    return "medium";
  }
  return "low";
}

function getHealthBand(score) {
  if (score <= 40) {
    return "critical";
  }
  if (score <= 60) {
    return "monitor";
  }
  if (score <= 80) {
    return "healthy";
  }
  return "thriving";
}

function formatIso(dateValue) {
  return new Date(dateValue).toISOString();
}

function getHoursToMeeting(meetingStartsAt, nowIso) {
  if (!meetingStartsAt) {
    return null;
  }
  const meetingMs = new Date(meetingStartsAt).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (Number.isNaN(meetingMs) || Number.isNaN(nowMs)) {
    return null;
  }
  return Number(((meetingMs - nowMs) / (1000 * 60 * 60)).toFixed(2));
}

function flattenSlackMessages(slack = {}) {
  const messages = [];
  Object.entries(slack).forEach(([channel, value]) => {
    if (!Array.isArray(value)) {
      return;
    }
    value.forEach((item) => {
      if (!item?.text) {
        return;
      }
      messages.push({
        source: "slack",
        channel,
        text: String(item.text),
        timestamp: item.timestamp || item.ts || null,
        speaker: item.realName || item.user_name || item.userId || "Unknown",
      });
    });
  });
  return messages;
}

function flattenTranscript(meet = {}) {
  if (!Array.isArray(meet?.transcript)) {
    return [];
  }
  return meet.transcript
    .filter((item) => item?.text || item?.message)
    .map((item) => ({
      source: "transcript",
      text: String(item.text || item.message),
      timestamp: item.timestamp || item.ts || null,
      speaker: item.speaker || "Unknown",
    }));
}

function buildSourceLines({ slack, meet }) {
  return [...flattenSlackMessages(slack), ...flattenTranscript(meet)];
}

function extractUniqueSignals(lines) {
  const discovered = new Map();

  lines.forEach((line) => {
    const normalized = String(line.text || "").toLowerCase();
    SIGNAL_MATCHERS.forEach((matcher) => {
      const isMatch = matcher.patterns.some((pattern) => normalized.includes(pattern));
      if (!isMatch) {
        return;
      }

      const key = `${matcher.tier}:${matcher.signal}`;
      if (discovered.has(key)) {
        return;
      }

      discovered.set(key, {
        tier: matcher.tier,
        signal: matcher.signal,
        evidence: line.text,
        source: line.source,
        confidence: 0.8,
      });
    });
  });

  return Array.from(discovered.values());
}

function scoreRetentionRisk(signals) {
  const total = signals.reduce((acc, signal) => acc + (TIER_SCORES[signal.tier] || 0), 0);
  const riskScore = clampScore(total);

  return {
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    signals,
    summary:
      signals.length > 0
        ? `Detected ${signals.length} retention signals with strongest tier ${signals[0].tier}.`
        : "No explicit retention risk patterns found in available context.",
  };
}

function scoreSentiment(lines) {
  const negatives = [
    "overloaded",
    "unsustainable",
    "undervalued",
    "frustration",
    "conflict",
    "burnout",
    "fatigue",
    "reassess my options",
    "not great",
  ];

  const positives = ["appreciate", "support", "good", "helpful", "progress", "aligned"];

  let negativeHits = 0;
  let positiveHits = 0;

  lines.forEach((line) => {
    const text = String(line.text || "").toLowerCase();
    negatives.forEach((token) => {
      if (text.includes(token)) {
        negativeHits += 1;
      }
    });
    positives.forEach((token) => {
      if (text.includes(token)) {
        positiveHits += 1;
      }
    });
  });

  const sentimentScore = clampScore(76 + positiveHits * 3 - negativeHits * 6);

  return {
    sentimentScore,
    evidence: `Positive cues: ${positiveHits}; stress cues: ${negativeHits}.`,
  };
}

function scoreEngagement(lines, slackMessages) {
  const transcriptTurns = lines.filter((line) => line.source === "transcript").length;
  const slackCount = slackMessages.length;

  const reducedActivityMarkers = [
    "less active in slack",
    "responding only when tagged",
    "quieter in team channels",
    "avoid optional channels",
  ];

  const markerPenalty = lines.reduce((acc, line) => {
    const text = String(line.text || "").toLowerCase();
    const found = reducedActivityMarkers.some((marker) => text.includes(marker));
    return found ? acc + 10 : acc;
  }, 0);

  const base = slackCount * 8 + transcriptTurns * 1.5 + 20;
  const engagementScore = clampScore(base - markerPenalty);

  return {
    engagementScore,
    evidence: `Slack events: ${slackCount}; transcript turns: ${transcriptTurns}; activity penalty: ${markerPenalty}.`,
  };
}

function scoreHrmsIndicators(hrms = {}) {
  let score = 72;
  const notes = String(hrms?.performance?.lastReview?.notes || "").toLowerCase();

  if (notes.includes("deferred") || notes.includes("passed over")) {
    score -= 8;
  }

  const goals = Array.isArray(hrms?.performance?.activeGoals) ? hrms.performance.activeGoals : [];
  goals.forEach((goal) => {
    const status = String(goal?.status || "").toLowerCase();
    if (status === "blocked") {
      score -= 8;
    } else if (status === "at risk" || status === "delayed") {
      score -= 5;
    }
  });

  const upcoming = Array.isArray(hrms?.timeOff?.upcomingTimeOff) ? hrms.timeOff.upcomingTimeOff : [];
  if (upcoming.some((item) => String(item?.type || "").toLowerCase().includes("stress"))) {
    score -= 7;
  }

  return {
    hrmsIndicatorScore: clampScore(score),
    evidence: `Goals at risk/blocked: ${goals.filter((goal) => ["blocked", "at risk", "delayed"].includes(String(goal?.status || "").toLowerCase())).length}.`,
  };
}

function buildConversationStarters(signals) {
  const starters = [];

  if (signals.some((signal) => signal.signal.includes("promotion"))) {
    starters.push("What would make your career path and promotion criteria feel clear over the next quarter?");
  }

  if (signals.some((signal) => signal.signal.includes("workload"))) {
    starters.push("Which two workload changes would most improve sustainability this sprint?");
  }

  if (signals.some((signal) => signal.signal.includes("manager conflict"))) {
    starters.push("Where are priority expectations still misaligned between you and your manager?");
  }

  while (starters.length < 3) {
    starters.push("What support from HR would have the biggest positive impact before our next check-in?");
  }

  return starters.slice(0, 3);
}

function buildPersonalContext(hrms = {}) {
  const context = [];
  const employee = hrms?.employee || {};
  const job = hrms?.job || {};

  if (employee.location) {
    context.push(`Location: ${employee.location}`);
  }
  if (job.title && job.department) {
    context.push(`Role: ${job.title}, ${job.department}`);
  }
  if (job.reportsTo?.name) {
    context.push(`Manager: ${job.reportsTo.name}`);
  }

  const upcoming = Array.isArray(hrms?.timeOff?.upcomingTimeOff) ? hrms.timeOff.upcomingTimeOff : [];
  upcoming.slice(0, 1).forEach((leave) => {
    context.push(`Upcoming leave: ${leave.type} (${leave.startDate} to ${leave.endDate})`);
  });

  return context;
}

function buildOpenFollowUps(meet = {}) {
  const tracker = Array.isArray(meet?.meeting_brief?.commitment_tracker)
    ? meet.meeting_brief.commitment_tracker
    : [];

  return tracker
    .filter((item) => String(item.status || "").toLowerCase() !== "completed")
    .map((item) => ({
      owner: item.owner || "Unknown",
      task: item.commitment || "Follow-up item",
      status: String(item.status || "open").toLowerCase(),
    }));
}

function buildWhatChanged(previousProfile, currentProfile) {
  if (!previousProfile) {
    return ["Initial profile created from current Slack, transcript, and HRMS snapshot."];
  }

  const changes = [];
  const healthDelta = currentProfile.healthScore - previousProfile.healthScore;
  if (healthDelta !== 0) {
    changes.push(`Health score changed by ${healthDelta > 0 ? "+" : ""}${healthDelta} points.`);
  }

  const riskDelta = currentProfile.retentionRisk.riskScore - previousProfile.retentionRisk.riskScore;
  if (riskDelta !== 0) {
    changes.push(`Retention risk moved by ${riskDelta > 0 ? "+" : ""}${riskDelta} points.`);
  }

  if (currentProfile.retentionRisk.riskLevel !== previousProfile.retentionRisk.riskLevel) {
    changes.push(
      `Risk level changed from ${previousProfile.retentionRisk.riskLevel} to ${currentProfile.retentionRisk.riskLevel}.`
    );
  }

  return changes.length > 0 ? changes : ["No material changes detected since previous profile."];
}

function buildRecommendedTone(riskLevel) {
  if (riskLevel === "critical") {
    return "calm, empathetic, and action-focused with explicit accountability";
  }
  if (riskLevel === "high") {
    return "supportive and direct, with clear commitments and timelines";
  }
  if (riskLevel === "medium") {
    return "coaching-oriented with proactive alignment on expectations";
  }
  return "affirming and growth-oriented";
}

function shouldGenerateBrief({ meetingStartsAt, manualRequest, previousRiskLevel, currentRiskLevel, nowIso }) {
  const reasons = [];
  const hoursToMeeting = getHoursToMeeting(meetingStartsAt, nowIso);

  if (typeof hoursToMeeting === "number" && hoursToMeeting >= 0 && hoursToMeeting <= 24) {
    reasons.push("meeting_within_24h");
  }
  if (manualRequest) {
    reasons.push("manual_request");
  }
  if (
    previousRiskLevel &&
    currentRiskLevel &&
    String(previousRiskLevel).toLowerCase() !== String(currentRiskLevel).toLowerCase()
  ) {
    reasons.push("risk_level_changed");
  }

  return {
    shouldGenerate: reasons.length > 0,
    reasons,
    hoursToMeeting,
  };
}

function buildMockBrief({ previousProfile, currentProfile, hrms, meet, options }) {
  const trigger = shouldGenerateBrief({
    meetingStartsAt: options.meetingStartsAt,
    manualRequest: Boolean(options.manualRequest),
    previousRiskLevel: previousProfile?.retentionRisk?.riskLevel || null,
    currentRiskLevel: currentProfile.retentionRisk.riskLevel,
    nowIso: options.nowIso,
  });

  if (!trigger.shouldGenerate) {
    return {
      generated: false,
      trigger,
      message: "Meeting brief skipped because no trigger was met.",
    };
  }

  const openFollowUps = buildOpenFollowUps(meet);

  return {
    generated: true,
    trigger,
    brief: {
      currentHealthScore: currentProfile.healthScore,
      healthBand: currentProfile.healthBand,
      whatChangedSinceLastMeeting: buildWhatChanged(previousProfile, currentProfile),
      openFollowUps,
      conversationStarters: buildConversationStarters(currentProfile.retentionRisk.signals),
      handleCarefully: currentProfile.retentionRisk.signals.slice(0, 3).map((signal) => signal.signal),
      personalContext: buildPersonalContext(hrms),
      recommendedTone: buildRecommendedTone(currentProfile.retentionRisk.riskLevel),
      executiveSummary:
        currentProfile.retentionRisk.riskLevel === "critical"
          ? "Escalated retention concern requires immediate CHRO intervention with concrete commitments."
          : "Focus on commitment closure and clarity to improve stability before next check-in.",
    },
  };
}

function buildRuleEngineProfile({ hrms, meet, slack, nowIso }) {
  const lines = buildSourceLines({ slack, meet });
  const slackMessages = flattenSlackMessages(slack);
  const signals = extractUniqueSignals(lines);
  const retentionRisk = scoreRetentionRisk(signals);
  const sentiment = scoreSentiment(lines);
  const engagement = scoreEngagement(lines, slackMessages);
  const hrmsIndicators = scoreHrmsIndicators(hrms);

  const retentionSafetyScore = clampScore(100 - retentionRisk.riskScore);
  const healthScore = clampScore(
    sentiment.sentimentScore * WEIGHTS.sentiment +
      retentionSafetyScore * WEIGHTS.retentionSafety +
      engagement.engagementScore * WEIGHTS.engagement +
      hrmsIndicators.hrmsIndicatorScore * WEIGHTS.hrmsIndicators
  );

  return {
    healthScore,
    healthBand: getHealthBand(healthScore),
    componentScores: {
      sentimentScore: sentiment.sentimentScore,
      retentionRiskScore: retentionRisk.riskScore,
      retentionSafetyScore,
      engagementScore: engagement.engagementScore,
      hrmsIndicatorScore: hrmsIndicators.hrmsIndicatorScore,
    },
    weightedBreakdown: {
      sentiment: Number((sentiment.sentimentScore * WEIGHTS.sentiment).toFixed(2)),
      retentionSafety: Number((retentionSafetyScore * WEIGHTS.retentionSafety).toFixed(2)),
      engagement: Number((engagement.engagementScore * WEIGHTS.engagement).toFixed(2)),
      hrmsIndicators: Number((hrmsIndicators.hrmsIndicatorScore * WEIGHTS.hrmsIndicators).toFixed(2)),
    },
    evidence: {
      sentiment: sentiment.evidence,
      engagement: engagement.evidence,
      hrmsIndicators: hrmsIndicators.evidence,
    },
    retentionRisk,
    analyzedAt: nowIso,
  };
}

function normalizeLlmProfile(healthResult) {
  return {
    healthScore: clampScore(healthResult.healthScore),
    healthBand: healthResult.healthBand,
    componentScores: {
      sentimentScore: clampScore(healthResult?.componentScores?.sentimentScore),
      retentionRiskScore: clampScore(healthResult?.componentScores?.retentionRiskScore),
      retentionSafetyScore: clampScore(healthResult?.componentScores?.retentionSafetyScore),
      engagementScore: clampScore(healthResult?.componentScores?.engagementScore),
      hrmsIndicatorScore: clampScore(healthResult?.componentScores?.hrmsIndicatorScore),
    },
    weightedBreakdown: healthResult.weightedBreakdown || {
      sentiment: 0,
      retentionSafety: 0,
      engagement: 0,
      hrmsIndicators: 0,
    },
    evidence: healthResult.evidence || {},
    retentionRisk: {
      riskScore: clampScore(healthResult?.retentionRisk?.riskScore),
      riskLevel: healthResult?.retentionRisk?.riskLevel || "low",
      signals: Array.isArray(healthResult?.retentionRisk?.signals) ? healthResult.retentionRisk.signals : [],
      summary: healthResult?.retentionRisk?.summary || "No summary.",
    },
    analyzedAt: healthResult?.analyzedAt || new Date().toISOString(),
  };
}

async function generateAnalysis({ mode, hrms, meet, slack, previousProfile, options }) {
  const useLlmMode = mode === "llm";

  if (!useLlmMode) {
    const profile = buildRuleEngineProfile({ hrms, meet, slack, nowIso: options.nowIso });
    const briefResult = buildMockBrief({
      previousProfile,
      currentProfile: profile,
      hrms,
      meet,
      options,
    });
    return { profile, briefResult };
  }

  const healthResult = await analyzeHealthScoreWithLLM({ hrms, meet, slack });
  const normalizedProfile = normalizeLlmProfile(healthResult);

  const briefResult = await analyzeMeetingBriefWithLLM(
    { hrms, meet, slack },
    {
      meetingStartsAt: options.meetingStartsAt,
      manualRequest: Boolean(options.manualRequest),
      previousRiskLevel: previousProfile?.retentionRisk?.riskLevel || null,
      previousHealthScore: previousProfile?.healthScore || null,
    }
  );

  return {
    profile: normalizedProfile,
    briefResult,
  };
}

function buildDelta(previousProfile, currentProfile) {
  if (!previousProfile) {
    return {
      changedFields: [
        {
          field: "profile",
          from: null,
          to: "initialized",
          reason: "Initial profile generated from unified context.",
        },
      ],
    };
  }

  const changedFields = [];
  const tracked = [
    ["healthScore", previousProfile.healthScore, currentProfile.healthScore],
    ["healthBand", previousProfile.healthBand, currentProfile.healthBand],
    [
      "retentionRiskScore",
      previousProfile.retentionRisk.riskScore,
      currentProfile.retentionRisk.riskScore,
    ],
    [
      "retentionRiskLevel",
      previousProfile.retentionRisk.riskLevel,
      currentProfile.retentionRisk.riskLevel,
    ],
    [
      "sentimentScore",
      previousProfile.componentScores.sentimentScore,
      currentProfile.componentScores.sentimentScore,
    ],
    [
      "engagementScore",
      previousProfile.componentScores.engagementScore,
      currentProfile.componentScores.engagementScore,
    ],
  ];

  tracked.forEach(([field, from, to]) => {
    if (from === to) {
      return;
    }
    changedFields.push({
      field,
      from,
      to,
      reason: "Recomputed from latest context and signal set.",
    });
  });

  const previousSignals = new Set(previousProfile.retentionRisk.signals.map((signal) => signal.signal));
  const currentSignals = new Set(currentProfile.retentionRisk.signals.map((signal) => signal.signal));

  const addedSignals = Array.from(currentSignals).filter((signal) => !previousSignals.has(signal));
  if (addedSignals.length > 0) {
    changedFields.push({
      field: "addedRetentionSignals",
      from: null,
      to: addedSignals,
      reason: "New retention language patterns were detected.",
    });
  }

  const removedSignals = Array.from(previousSignals).filter((signal) => !currentSignals.has(signal));
  if (removedSignals.length > 0) {
    changedFields.push({
      field: "removedRetentionSignals",
      from: removedSignals,
      to: null,
      reason: "Previously detected risk signals no longer appeared in latest context.",
    });
  }

  return {
    changedFields,
  };
}

function buildAlerts({ previousProfile, currentProfile, briefResult, nowIso, eventType, slack }) {
  const alerts = [];

  if (previousProfile) {
    const riskIncrease = currentProfile.retentionRisk.riskScore - previousProfile.retentionRisk.riskScore;
    if (riskIncrease >= 15) {
      alerts.push({
        kind: "risk_score_spike",
        severity: "high",
        channel: "dashboard",
        message: `Retention risk increased by ${riskIncrease} points since last version.`,
        createdAt: nowIso,
        eventType,
      });
    }
  }

  if (currentProfile.retentionRisk.riskLevel === "critical") {
    alerts.push({
      kind: "critical_risk",
      severity: "critical",
      channel: "email+dashboard",
      message: "Employee risk reached CRITICAL. Immediate CHRO intervention recommended.",
      createdAt: nowIso,
      eventType,
    });
  }

  if (previousProfile) {
    const sentimentDrop =
      previousProfile.componentScores.sentimentScore - currentProfile.componentScores.sentimentScore;
    if (sentimentDrop >= 20) {
      alerts.push({
        kind: "sentiment_drop",
        severity: "high",
        channel: "dashboard",
        message: `Sentiment dropped ${sentimentDrop} points from the previous profile.`,
        createdAt: nowIso,
        eventType,
      });
    }
  }

  if (briefResult?.generated) {
    const unresolved = Array.isArray(briefResult?.brief?.openFollowUps)
      ? briefResult.brief.openFollowUps.filter(
          (item) => String(item.status || "").toLowerCase() !== "completed"
        )
      : [];

    if (unresolved.length > 0) {
      alerts.push({
        kind: "chro_commitment_unresolved",
        severity: "medium",
        channel: "dashboard",
        message: `${unresolved.length} commitment(s) are unresolved before the next check-in.`,
        createdAt: nowIso,
        eventType,
      });
    }

    const hoursToMeeting = briefResult?.trigger?.hoursToMeeting;
    if (typeof hoursToMeeting === "number" && hoursToMeeting <= 2 && hoursToMeeting >= 0) {
      alerts.push({
        kind: "meeting_brief_ready",
        severity: "info",
        channel: "dashboard",
        message: "Meeting starts in under 2 hours. Brief is ready.",
        createdAt: nowIso,
        eventType,
      });
    }
  }

  const slackMessages = flattenSlackMessages(slack);
  if (slackMessages.length <= 2) {
    alerts.push({
      kind: "slack_inactivity_digest",
      severity: "low",
      channel: "weekly_digest",
      message: "Employee Slack activity is low and should be reviewed in weekly digest.",
      createdAt: nowIso,
      eventType,
    });
  }

  return alerts;
}

function deriveEmployeeIdentity(hrms = {}) {
  const employee = hrms?.employee || {};
  return {
    email: employee.workEmail || "unknown@company.com",
    employeeId: employee.id || "unknown",
    displayName: employee.displayName || [employee.firstName, employee.lastName].filter(Boolean).join(" ") || "Unknown",
    role: hrms?.job?.title || "Unknown",
    department: hrms?.job?.department || "Unknown",
  };
}

function generateSlackEscalation(slack = {}, nowIso) {
  const updated = JSON.parse(JSON.stringify(slack));
  if (!Array.isArray(updated.hr_discussions)) {
    updated.hr_discussions = [];
  }

  const ts = String(Math.floor(new Date(nowIso).getTime() / 1000));
  updated.hr_discussions.push(
    {
      userId: "U0_ALEX_ENG",
      text: "I updated my LinkedIn profile this week and recruiters have been reaching out. I may need to explore external opportunities if this workload does not change.",
      timestamp: `${ts}.000000`,
      threadTs: null,
      reactions: [],
      realName: "Alex Chen",
    },
    {
      userId: "U0_ALEX_ENG",
      text: "If internal transfer options exist, I would like to understand them in the next conversation.",
      timestamp: `${Number(ts) + 120}.000000`,
      threadTs: null,
      reactions: [],
      realName: "Alex Chen",
    }
  );

  return updated;
}

function buildFollowUpMeeting(meet = {}) {
  const updated = JSON.parse(JSON.stringify(meet));
  updated.meeting_brief = {
    ...(updated.meeting_brief || {}),
    previous_meeting: "Retention Stabilization Follow-up",
    date: "2026-03-15",
    commitment_tracker: [
      {
        owner: "Sarah Jenkins",
        commitment: "Share written promotion criteria and timeline",
        dueDate: "2026-03-15",
        status: "completed",
      },
      {
        owner: "Engineering Manager",
        commitment: "Confirm revised workload split and on-call rotation",
        dueDate: "2026-03-16",
        status: "in_progress",
      },
    ],
  };

  updated.transcript = [
    {
      timestamp: "00:00:05",
      speaker: "Sarah Jenkins",
      text: "Thanks for meeting again, Alex. We have your promotion criteria document and revised workload plan ready.",
    },
    {
      timestamp: "00:00:34",
      speaker: "Alex Chen",
      text: "This is much clearer. Having concrete milestones and on-call redistribution already reduced stress this week.",
    },
    {
      timestamp: "00:01:12",
      speaker: "Sarah Jenkins",
      text: "Great. We will review progress weekly and keep manager alignment documented.",
    },
    {
      timestamp: "00:01:45",
      speaker: "Alex Chen",
      text: "I appreciate the follow-through. I feel more confident continuing here if this stays consistent.",
    },
  ];

  return updated;
}

function buildDashboardState(latestProfile, alerts, timeline) {
  return {
    employees: [
      {
        email: latestProfile.identity.email,
        name: latestProfile.identity.displayName,
        role: latestProfile.identity.role,
        department: latestProfile.identity.department,
        healthScore: latestProfile.profile.healthScore,
        healthBand: latestProfile.profile.healthBand,
        riskLevel: latestProfile.profile.retentionRisk.riskLevel,
      },
    ],
    alerts: alerts.slice(-8),
    timelineSummary: timeline.map((event) => ({
      eventType: event.eventType,
      version: event.profileVersion.version,
      healthScore: event.profileVersion.profile.healthScore,
      riskLevel: event.profileVersion.profile.retentionRisk.riskLevel,
      generatedBrief: event.meetingBrief.generated,
      alertCount: event.alerts.length,
    })),
  };
}

async function runEvent({ mode, eventType, hrms, meet, slack, previousVersion, options }) {
  const nowIso = options.nowIso;
  const previousProfile = previousVersion?.profile || null;

  const { profile, briefResult } = await generateAnalysis({
    mode,
    hrms,
    meet,
    slack,
    previousProfile,
    options,
  });

  const delta = buildDelta(previousProfile, profile);
  const version = (previousVersion?.version || 0) + 1;

  const profileVersion = {
    version,
    updatedAt: nowIso,
    eventType,
    profile,
    delta,
  };

  const alerts = buildAlerts({
    previousProfile,
    currentProfile: profile,
    briefResult,
    nowIso,
    eventType,
    slack,
  });

  return {
    eventType,
    processedAt: nowIso,
    profileVersion,
    meetingBrief: briefResult,
    alerts,
  };
}

async function runAiFlowSimulation({ mode = "mock", hrms, meet, slack, now = new Date() }) {
  const identity = deriveEmployeeIdentity(hrms);
  const timeline = [];
  const allAlerts = [];
  const sentimentHistory = [];

  const initialNow = formatIso(now);
  const initialEvent = await runEvent({
    mode,
    eventType: "initial_profile_build",
    hrms,
    meet,
    slack,
    previousVersion: null,
    options: {
      nowIso: initialNow,
      meetingStartsAt: formatIso(new Date(new Date(initialNow).getTime() + 90 * 60 * 1000)),
      manualRequest: true,
    },
  });
  timeline.push(initialEvent);
  allAlerts.push(...initialEvent.alerts);
  sentimentHistory.push({
    at: initialNow,
    score: initialEvent.profileVersion.profile.componentScores.sentimentScore,
  });

  const slackUpdateTime = formatIso(new Date(new Date(initialNow).getTime() + 10 * 60 * 1000));
  const escalatedSlack = generateSlackEscalation(slack, slackUpdateTime);
  const slackEvent = await runEvent({
    mode,
    eventType: "slack_message_debounced_reanalysis",
    hrms,
    meet,
    slack: escalatedSlack,
    previousVersion: initialEvent.profileVersion,
    options: {
      nowIso: slackUpdateTime,
      meetingStartsAt: formatIso(new Date(new Date(slackUpdateTime).getTime() + 6 * 60 * 60 * 1000)),
      manualRequest: false,
    },
  });
  timeline.push(slackEvent);
  allAlerts.push(...slackEvent.alerts);
  sentimentHistory.push({
    at: slackUpdateTime,
    score: slackEvent.profileVersion.profile.componentScores.sentimentScore,
  });

  const meetingUpdateTime = formatIso(new Date(new Date(slackUpdateTime).getTime() + 70 * 60 * 1000));
  const followUpMeeting = buildFollowUpMeeting(meet);
  const meetingEvent = await runEvent({
    mode,
    eventType: "meeting_transcript_priority_reanalysis",
    hrms,
    meet: followUpMeeting,
    slack: escalatedSlack,
    previousVersion: slackEvent.profileVersion,
    options: {
      nowIso: meetingUpdateTime,
      meetingStartsAt: formatIso(new Date(new Date(meetingUpdateTime).getTime() + 45 * 60 * 1000)),
      manualRequest: false,
    },
  });
  timeline.push(meetingEvent);
  allAlerts.push(...meetingEvent.alerts);
  sentimentHistory.push({
    at: meetingUpdateTime,
    score: meetingEvent.profileVersion.profile.componentScores.sentimentScore,
  });

  const latest = timeline[timeline.length - 1];

  return {
    mode,
    generatedAt: new Date().toISOString(),
    identity,
    timeline,
    latestProfile: {
      identity,
      profileVersion: latest.profileVersion.version,
      profile: latest.profileVersion.profile,
      meetingBrief: latest.meetingBrief,
    },
    sentimentHistory,
    alerts: allAlerts,
    dashboard: buildDashboardState(
      {
        identity,
        profile: latest.profileVersion.profile,
      },
      allAlerts,
      timeline
    ),
  };
}

export { runAiFlowSimulation };