function flattenSlack(slack = {}) {
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
        ts: item.timestamp || item.ts || null,
        speaker: item.realName || item.userId || "Unknown",
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
      source: "meeting",
      text: String(item.text || item.message),
      ts: item.timestamp || item.ts || null,
      speaker: item.speaker || "Unknown",
    }));
}

function normalizeUnifiedSchema({ hrms, meet, slack }) {
  const employee = hrms?.employee || {};
  const job = hrms?.job || {};
  const manager = job?.reportsTo || {};
  const normalizedEmail = String(employee.workEmail || employee.email || "").trim().toLowerCase();

  const slackMessages = flattenSlack(slack);
  const meetingLines = flattenTranscript(meet);

  return {
    employee: {
      employeeId: employee.id || "unknown",
      email: normalizedEmail,
      displayName:
        employee.displayName || [employee.firstName, employee.lastName].filter(Boolean).join(" ") || "Unknown",
      role: job.title || "Unknown",
      department: job.department || "Unknown",
      manager: manager.name || "Unknown",
      location: employee.location || "Unknown",
      tenureStartDate: job.hireDate || null,
    },
    hrms: {
      performance: hrms?.performance || {},
      compensation: hrms?.compensation || {},
      timeOff: hrms?.timeOff || hrms?.leave || {},
      metadata: hrms?.metadata || {},
    },
    activity: {
      slackMessages,
      meetingTranscript: meetingLines,
    },
    sourceStats: {
      slackMessageCount: slackMessages.length,
      meetingTurnCount: meetingLines.length,
      hasHrmsProfile: Boolean(hrms?.employee),
    },
    mergedContextText: [
      ...slackMessages.map((item) => `[Slack][${item.channel}] ${item.speaker}: ${item.text}`),
      ...meetingLines.map((item) => `[Meeting] ${item.speaker}: ${item.text}`),
      hrms?.performance?.lastReview?.notes ? `[HRMS Review] ${hrms.performance.lastReview.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    normalizedAt: new Date().toISOString(),
  };
}

export { normalizeUnifiedSchema };
