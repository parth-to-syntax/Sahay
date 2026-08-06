const BACKEND_BASE_URL = String(import.meta.env.VITE_BACKEND_BASE_URL || "").replace(/\/+$/, "");
const ORG_ID = String(import.meta.env.VITE_ORG_ID || "").trim();

async function request(path, options = {}) {
  if (!BACKEND_BASE_URL) {
    throw new Error("VITE_BACKEND_BASE_URL is required");
  }

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (ORG_ID) {
    headers["x-org-id"] = ORG_ID;
  }

  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (_err) {
    data = null;
  }

  if (!response.ok) {
    const message =
      (typeof data?.error === "string" ? data.error : "") ||
      data?.error?.message ||
      data?.message ||
      `Request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.code = data?.error?.code || data?.code || "REQUEST_FAILED";
    err.payload = data;
    throw err;
  }

  return data;
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getScoreCandidate(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function titleCase(input) {
  if (!input || typeof input !== "string") return "";
  const lower = input.trim().toLowerCase();
  if (!lower) return "";
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function toMeetingDay(meetingAt) {
  const value = String(meetingAt || "").trim();
  return value ? value.slice(0, 10) : "";
}

function toMillis(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildMeetingStats(meetingRows = []) {
  const map = new Map();

  meetingRows.forEach((row) => {
    const email = String(row?.employeeEmail || "").toLowerCase();
    if (!email) return;

    const meetingDay = toMeetingDay(row?.meetingAt);
    const key = meetingDay || String(row?.meetingId || "");

    if (!map.has(email)) {
      map.set(email, {
        keys: new Set(),
        lastMeetingAt: "",
      });
    }

    const bucket = map.get(email);
    if (key) bucket.keys.add(key);

    const candidateAt = String(row?.meetingAt || "");
    if (toMillis(candidateAt) > toMillis(bucket.lastMeetingAt)) {
      bucket.lastMeetingAt = candidateAt;
    }
  });

  return map;
}

export async function getDashboardSummary() {
  const payload = await request("/api/intelligence/dashboard");
  return payload?.data || {};
}

export async function listEmployees() {
  const [employeePayload, meetingsPayload, dashboardPayload] = await Promise.all([
    request("/api/intelligence/employees"),
    request("/api/intelligence/meetings?limit=500").catch(() => ({ data: [] })),
    request("/api/intelligence/dashboard").catch(() => ({ data: { employees: [] } })),
  ]);

  const rows = Array.isArray(employeePayload?.data) ? employeePayload.data : [];
  const meetingRows = Array.isArray(meetingsPayload?.data) ? meetingsPayload.data : [];
  const meetingStats = buildMeetingStats(meetingRows);
  const summaryEmployees = Array.isArray(dashboardPayload?.data?.employees) ? dashboardPayload.data.employees : [];
  const summaryByEmail = new Map(
    summaryEmployees.map((row) => [String(row?.email || row?.employeeEmail || "").toLowerCase(), row])
  );

  return rows.map((row) => {
    const email = String(row?.employeeEmail || row?.email || "").toLowerCase();
    const summaryRow = summaryByEmail.get(email) || {};
    const name = row?.displayName || row?.employeeName || row?.name || "";
    const role = row?.role || row?.title || row?.jobTitle || "";
    const dept = row?.department || row?.dept || "";
    const stats = meetingStats.get(email);

    const riskRaw =
      row?.analysis?.retentionRisk?.level ||
      row?.retentionRisk ||
      row?.riskLevel ||
      summaryRow?.riskLevel ||
      "";
    const sentimentRaw =
      row?.analysis?.sentiment?.trend ||
      row?.analysis?.healthLevel ||
      row?.sentiment ||
      summaryRow?.sentimentTrend ||
      "";

    const sentimentScoreRaw = asNumber(
      getScoreCandidate(
        summaryRow?.sentimentScore,
        row?.analysis?.sentiment?.score,
        row?.sentimentScore
      ),
      0
    );

    const healthScore = asNumber(
      getScoreCandidate(
        summaryRow?.healthScore,
        row?.analysis?.health?.score,
        row?.analysis?.healthScore,
        row?.healthScore
      ),
      0
    );

    const reportedTotalMeetings = asNumber(row?.totalMeetings ?? row?.meetingCount, 0);
    const computedTotalMeetings = stats ? stats.keys.size : 0;
    const totalMeetings = Math.max(reportedTotalMeetings, computedTotalMeetings);

    const reportedLastMeeting = row?.lastMeetingAt || "";
    const computedLastMeeting = stats?.lastMeetingAt || "";
    const lastMeeting =
      toMillis(reportedLastMeeting) >= toMillis(computedLastMeeting)
        ? reportedLastMeeting || computedLastMeeting
        : computedLastMeeting;

    return {
      id: String(row?.employeeId || row?.id || email),
      email,
      name,
      dept,
      manager: row?.manager || "",
      joinDate: row?.joinDate || row?.hiredAt || "",
      lastMeeting: lastMeeting || row?.updatedAt || "",
      totalMeetings,
      risk: titleCase(String(riskRaw)),
      sentiment: titleCase(String(sentimentRaw)),
      score: healthScore,
      sentimentScoreRaw,
      healthScore,
      riskScore: asNumber(
        getScoreCandidate(
          summaryRow?.riskScore,
          row?.analysis?.retentionRisk?.score,
          row?.riskScore
        ),
        0
      ),
      confidence: asNumber(
        getScoreCandidate(
          summaryRow?.confidence,
          row?.analysis?.components?.confidence,
          row?.confidence
        ),
        0
      ),
      deltaRisk30d: asNumber(
        getScoreCandidate(
          summaryRow?.deltaRisk30d,
          row?.analysis?.temporal?.deltaRisk30d,
          row?.deltaRisk30d
        ),
        0
      ),
      deltaSentiment7d: asNumber(
        getScoreCandidate(
          summaryRow?.deltaSentiment7d,
          row?.analysis?.temporal?.deltaSentiment7d,
          row?.deltaSentiment7d
        ),
        0
      ),
      scoringVersion:
        summaryRow?.scoringVersion ||
        row?.analysis?.scoringVersion ||
        row?.scoringVersion ||
        "",
      updatedAt: row?.updatedAt || "",
    };
  }).filter((row) => row.email || row.id);
}

export async function getEmployeeProfileByEmail(email) {
  const safeEmail = encodeURIComponent(String(email || "").toLowerCase());
  const payload = await request(`/api/intelligence/employees/${safeEmail}/profile`);
  const data = payload?.data || {};

  let totalMeetings = asNumber(data?.meta?.meetingCount ?? data?.meetingCount, 0);
  let lastMeetingAt = data?.meta?.lastMeetingAt || data?.lastMeetingAt || "";

  if (totalMeetings === 0) {
    const meetingPayload = await request(
      `/api/intelligence/meetings?employeeEmail=${encodeURIComponent(String(email || "").toLowerCase())}&limit=500`
    ).catch(() => ({ data: [] }));

    const meetingRows = Array.isArray(meetingPayload?.data) ? meetingPayload.data : [];
    const stats = buildMeetingStats(meetingRows).get(String(email || "").toLowerCase());
    if (stats) {
      totalMeetings = stats.keys.size;
      if (!lastMeetingAt || toMillis(stats.lastMeetingAt) > toMillis(lastMeetingAt)) {
        lastMeetingAt = stats.lastMeetingAt;
      }
    }
  }

  const sentimentScoreRaw = asNumber(
    getScoreCandidate(
      data?.analysis?.sentiment?.score,
      data?.analysis?.health?.score,
      data?.analysis?.healthScore,
      data?.sentimentScore,
      data?.healthScore
    ),
    0
  );

  const healthScore = asNumber(
    getScoreCandidate(
      data?.analysis?.health?.score,
      data?.analysis?.healthScore,
      data?.healthScore,
      sentimentScoreRaw
    ),
    0
  );

  const riskScore = asNumber(
    getScoreCandidate(
      data?.analysis?.retentionRisk?.score,
      data?.analysis?.riskScore,
      data?.riskScore
    ),
    0
  );

  const confidence = asNumber(
    getScoreCandidate(
      data?.analysis?.components?.confidence,
      data?.confidence
    ),
    0
  );

  const deltaRisk30d = asNumber(
    getScoreCandidate(
      data?.analysis?.temporal?.deltaRisk30d,
      data?.deltaRisk30d
    ),
    0
  );

  const deltaSentiment7d = asNumber(
    getScoreCandidate(
      data?.analysis?.temporal?.deltaSentiment7d,
      data?.deltaSentiment7d
    ),
    0
  );

  return {
    email: String(data?.employeeEmail || email || "").toLowerCase(),
    name: data?.employeeName || data?.displayName || data?.name || "",
    dept: data?.department || data?.dept || "",
    role: data?.role || data?.jobTitle || "",
    manager: data?.manager || "",
    joinDate: data?.joinDate || data?.hiredAt || "",
    totalMeetings,
    healthScore,
    healthBand: data?.analysis?.health?.band || "",
    sentimentScoreRaw,
    sentimentScore: `${asNumber(sentimentScoreRaw, 0)}/100`,
    sentimentTrend: titleCase(data?.analysis?.sentiment?.trend || ""),
    sentimentEvidence: data?.analysis?.sentiment?.evidence || "",
    sentimentKeyEvidence: Array.isArray(data?.analysis?.sentiment?.keyEvidence)
      ? data.analysis.sentiment.keyEvidence
      : [],
    riskLevel: titleCase(data?.analysis?.retentionRisk?.level || data?.analysis?.riskLevel || data?.retentionRisk || ""),
    riskScore,
    confidence,
    deltaRisk30d,
    deltaSentiment7d,
    scoringVersion: data?.analysis?.scoringVersion || data?.scoringVersion || "",
    extractionMeta: data?.analysis?.extractionMeta || {},
    contributors: data?.analysis?.components?.contributors || {},
    riskSummary: data?.analysis?.retentionRisk?.summary || "",
    slackMessageCount: asNumber(data?.sourceStats?.slackMessageCount, 0),
    lastMeetingAt,
    observations: Array.isArray(data?.analysis?.observations)
      ? data.analysis.observations
      : Array.isArray(data?.analysis?.summary?.chunks)
        ? data.analysis.summary.chunks.map((chunk) => chunk.summary).filter(Boolean)
        : [],
  };
}

export async function getEmployeeHistoryByEmail(email, limit = 30) {
  const safeEmail = encodeURIComponent(String(email || "").toLowerCase());
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 180)) : 30;

  const payload = await request(
    `/api/intelligence/employees/${safeEmail}/history?limit=${safeLimit}`
  );

  return {
    employeeEmail: String(payload?.employeeEmail || email || "").toLowerCase(),
    sentimentHistory: Array.isArray(payload?.sentimentHistory) ? payload.sentimentHistory : [],
    riskHistory: Array.isArray(payload?.riskHistory) ? payload.riskHistory : [],
    summary: payload?.summary && typeof payload.summary === "object" ? payload.summary : {},
  };
}

export async function listMeetings(params = {}) {
  const query = new URLSearchParams();
  if (params.employeeEmail) query.set("employeeEmail", params.employeeEmail);
  if (params.q) query.set("q", params.q);
  if (params.limit) query.set("limit", String(params.limit));

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const payload = await request(`/api/intelligence/meetings${suffix}`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function refreshGoogleCalendarMeetings(options = {}) {
  const body = {};
  if (options.calendarId) body.calendarId = options.calendarId;
  if (options.pastDays !== undefined) body.pastDays = Number(options.pastDays);
  if (options.futureDays !== undefined) body.futureDays = Number(options.futureDays);
  if (options.maxResults !== undefined) body.maxResults = Number(options.maxResults);
  if (options.employeeEmail) body.employeeEmail = options.employeeEmail;
  if (options.q) body.q = options.q;
  if (options.limit !== undefined) body.limit = Number(options.limit);

  const payload = await request("/api/intelligence/meetings/refresh-google", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const meetings = payload?.data?.meetings || {};
  return {
    ingestion: payload?.data?.ingestion || null,
    count: asNumber(meetings?.count, 0),
    data: Array.isArray(meetings?.data) ? meetings.data : [],
    sources: meetings?.sources || {},
    partial: Boolean(meetings?.partial),
  };
}

export async function syncCalendarEventsIngest(options = {}) {
  const body = {
    calendarId: String(options.calendarId || "primary"),
    pastDays: Number.isFinite(Number(options.pastDays)) ? Number(options.pastDays) : 1,
    futureDays: Number.isFinite(Number(options.futureDays)) ? Number(options.futureDays) : 14,
  };

  const payload = await request("/api/ingest/calendar/events", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return payload?.data || {};
}

export async function syncFirefliesTranscripts(options = {}) {
  const body = {
    limit: Number.isFinite(Number(options.limit)) ? Number(options.limit) : 100,
    skip: Number.isFinite(Number(options.skip)) ? Number(options.skip) : 0,
    syncHrToCalendar:
      options.syncHrToCalendar === undefined ? true : Boolean(options.syncHrToCalendar),
  };

  if (options.fromDate) body.fromDate = String(options.fromDate);
  if (options.toDate) body.toDate = String(options.toDate);

  const payload = await request("/api/ingest/fireflies/transcripts", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return payload?.data || {};
}

export async function getMeetingTranscript(meetingId, q = "") {
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  return request(`/api/intelligence/meetings/${encodeURIComponent(meetingId)}/transcript${suffix}`);
}

export async function sendChatQuery(query, options = {}) {
  const sessionId = String(options?.sessionId || "").trim();
  const body = { query };
  if (sessionId) {
    body.sessionId = sessionId;
  }

  const payload = await request("/api/intelligence/chat/query", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    sessionId: String(payload?.sessionId || sessionId || ""),
    answer: payload?.answer || "",
    transcriptCards: Array.isArray(payload?.transcriptCards) ? payload.transcriptCards : [],
    filters: payload?.appliedFilters || payload?.filter || {},
    count: asNumber(payload?.count, 0),
  };
}

export async function createChatSession(sessionId = "") {
  const provided = String(sessionId || "").trim();
  const payload = await request("/api/intelligence/chat/sessions", {
    method: "POST",
    body: JSON.stringify(provided ? { sessionId: provided } : {}),
  });

  return payload?.data || {};
}

export async function listChatSessions(options = {}) {
  const params = new URLSearchParams();
  const limit = Number(options?.limit);
  const status = String(options?.status || "").trim().toLowerCase();

  if (Number.isFinite(limit) && limit > 0) {
    params.set("limit", String(Math.min(limit, 200)));
  }
  if (status) {
    params.set("status", status);
  }

  const qs = params.toString();
  const payload = await request(`/api/intelligence/chat/sessions${qs ? `?${qs}` : ""}`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function updateChatSession(sessionId, patch = {}) {
  const key = String(sessionId || "").trim();
  if (!key) {
    throw new Error("Session ID is required");
  }

  const payload = await request(`/api/intelligence/chat/sessions/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(patch && typeof patch === "object" ? patch : {}),
  });

  return payload?.data || null;
}

export async function deleteChatSession(sessionId) {
  const key = String(sessionId || "").trim();
  if (!key) {
    throw new Error("Session ID is required");
  }

  const payload = await request(`/api/intelligence/chat/sessions/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });

  return payload?.data || null;
}

export async function getChatSessionHistory(sessionId, limit = 120) {
  const key = String(sessionId || "").trim();
  if (!key) {
    return { sessionId: "", data: [] };
  }

  const safeLimit = Math.max(1, Math.min(Number(limit || 120), 500));
  const payload = await request(
    `/api/intelligence/chat/sessions/${encodeURIComponent(key)}/history?limit=${safeLimit}`
  );

  return {
    sessionId: String(payload?.sessionId || key),
    data: Array.isArray(payload?.data) ? payload.data : [],
    session: payload?.session || null,
  };
}

export async function getUpcomingBrief(employeeEmail, meetingAt, participantEmails = []) {
  const normalizedParticipants = Array.isArray(participantEmails)
    ? Array.from(
        new Set(
          participantEmails
            .map((value) => String(value || "").trim().toLowerCase())
            .filter((value) => value.includes("@"))
        )
      )
    : [];

  return request("/api/intelligence/briefs/upcoming", {
    method: "POST",
    body: JSON.stringify({
      employeeEmail,
      meetingAt,
      participantEmails: normalizedParticipants,
    }),
  });
}

export async function refreshEmployeePipeline(employeeEmail, reason = "manual-refresh") {
  const email = String(employeeEmail || "").toLowerCase();
  if (!email) {
    throw new Error("Employee email is required for refresh");
  }

  return request("/api/intelligence/pipeline/run", {
    method: "POST",
    body: JSON.stringify({
      employeeEmail: email,
      reason,
    }),
  });
}

export async function syncBambooHrEmployees(options = {}) {
  const providedEmails = Array.isArray(options.employeeEmails)
    ? Array.from(
        new Set(
          options.employeeEmails
            .map((value) => String(value || "").trim().toLowerCase())
            .filter((value) => value.includes("@"))
        )
      )
    : [];

  const payload = {
    reason: String(options.reason || "manual-bamboohr-bulk-sync"),
    runPipeline: options.runPipeline === true,
    continueOnError: options.continueOnError !== false,
  };

  if (providedEmails.length > 0) {
    payload.employeeEmails = providedEmails;
  }

  if (Number.isFinite(Number(options.limit))) {
    payload.limit = Number(options.limit);
  }

  return request("/api/intelligence/pipeline/sync-bamboohr", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function syncLatestSignals(options = {}) {
  const transcriptLimitRaw = Number.parseInt(String(options.transcriptLimit ?? 25), 10);
  const transcriptLimit = Number.isFinite(transcriptLimitRaw)
    ? Math.max(1, Math.min(transcriptLimitRaw, 200))
    : 25;

  const runPipeline = options.runPipeline !== false;
  const continueOnError = options.continueOnError !== false;
  const reason = String(options.reason || "manual-latest-signals-sync");

  const result = {
    success: false,
    warnings: [],
    fireflies: {
      ok: false,
      transcriptsSeen: 0,
      raw: null,
      error: "",
    },
    slackUsers: {
      ok: false,
      usersSeen: 0,
      raw: null,
      error: "",
    },
    slackMessages: {
      ok: false,
      channelsSeen: 0,
      channelsProcessed: 0,
      messagesSeen: 0,
      documentsUpserted: 0,
      perChannelFailures: [],
      raw: null,
      error: "",
    },
    pipeline: {
      ok: false,
      acceptedCount: 0,
      totalCandidates: 0,
      errorCount: 0,
      raw: null,
      error: "",
    },
  };

  try {
    const firefliesPayload = await request(
      `/api/ingest/fireflies/transcripts?limit=${transcriptLimit}&syncHrToCalendar=true`,
      { method: "POST" }
    );
    const data = firefliesPayload?.data || firefliesPayload || {};
    result.fireflies.ok = true;
    result.fireflies.raw = firefliesPayload;
    result.fireflies.transcriptsSeen = asNumber(
      getScoreCandidate(
        data?.transcriptsSeen,
        data?.count,
        data?.processed,
        data?.inserted,
        data?.total
      ),
      0
    );
  } catch (err) {
    result.fireflies.error = err?.message || "Fireflies sync failed";
    result.warnings.push({ step: "fireflies", message: result.fireflies.error });
  }

  try {
    const channelsPayload = await request("/api/ingest/slack/channels?incremental=true", {
      method: "POST",
    });
    const channelsData = channelsPayload?.data || channelsPayload || {};
    let channelIds = Array.isArray(channelsData?.channelIds)
      ? channelsData.channelIds
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : [];

    // When incremental snapshot hash is unchanged, backend may not include channelIds.
    // Force one non-incremental fetch so message sync can still iterate known channels.
    if (channelIds.length === 0 && asNumber(channelsData?.channelsSeen, 0) > 0) {
      try {
        const fallbackChannelsPayload = await request("/api/ingest/slack/channels?incremental=false", {
          method: "POST",
        });
        const fallbackData = fallbackChannelsPayload?.data || fallbackChannelsPayload || {};
        channelIds = Array.isArray(fallbackData?.channelIds)
          ? fallbackData.channelIds
              .map((value) => String(value || "").trim())
              .filter(Boolean)
          : channelIds;
      } catch (_fallbackErr) {
        // Keep best-effort behavior; message sync will no-op if channelIds remain empty.
      }
    }

    result.slackMessages.ok = true;
    result.slackMessages.raw = channelsPayload;
    result.slackMessages.channelsSeen = Math.max(channelIds.length, asNumber(channelsData?.channelsSeen, 0));

    for (const channelId of channelIds) {
      try {
        const messagePayload = await request(
          `/api/ingest/slack/channels/${encodeURIComponent(channelId)}/messages?incremental=true&daysBack=120&includeReplies=false`,
          { method: "POST" }
        );
        const messageData = messagePayload?.data || messagePayload || {};

        result.slackMessages.channelsProcessed += 1;
        result.slackMessages.messagesSeen += asNumber(
          getScoreCandidate(
            messageData?.messagesSeen,
            messageData?.count,
            messageData?.processed,
            messageData?.inserted,
            messageData?.total
          ),
          0
        );
        result.slackMessages.documentsUpserted += asNumber(
          getScoreCandidate(
            messageData?.documentsUpserted,
            messageData?.upserted,
            messageData?.inserted,
            messageData?.updated
          ),
          0
        );
      } catch (err) {
        const message = err?.message || `Slack message sync failed for channel ${channelId}`;
        result.slackMessages.perChannelFailures.push({ channelId, message });
        result.warnings.push({ step: "slackMessages", channelId, message });
      }
    }
  } catch (err) {
    result.slackMessages.error = err?.message || "Slack channels sync failed";
    result.warnings.push({ step: "slackMessages", message: result.slackMessages.error });
  }

  try {
    const slackPayload = await request("/api/ingest/slack/users?incremental=true", {
      method: "POST",
    });
    const data = slackPayload?.data || slackPayload || {};
    result.slackUsers.ok = true;
    result.slackUsers.raw = slackPayload;
    result.slackUsers.usersSeen = asNumber(
      getScoreCandidate(
        data?.usersSeen,
        data?.count,
        data?.processed,
        data?.inserted,
        data?.updated,
        data?.total
      ),
      0
    );
  } catch (err) {
    result.slackUsers.error = err?.message || "Slack users sync failed";
    result.warnings.push({ step: "slackUsers", message: result.slackUsers.error });
  }

  try {
    const pipelinePayload = await syncBambooHrEmployees({
      runPipeline,
      continueOnError,
      reason,
    });
    const data = pipelinePayload?.data || pipelinePayload || {};
    result.pipeline.ok = true;
    result.pipeline.raw = pipelinePayload;
    result.pipeline.acceptedCount = asNumber(
      getScoreCandidate(data?.acceptedCount, pipelinePayload?.acceptedCount),
      0
    );
    result.pipeline.totalCandidates = asNumber(
      getScoreCandidate(data?.totalCandidates, pipelinePayload?.totalCandidates),
      0
    );
    result.pipeline.errorCount = asNumber(
      getScoreCandidate(data?.errorCount, pipelinePayload?.errorCount),
      0
    );
  } catch (err) {
    result.pipeline.error = err?.message || "Pipeline sync failed";
    result.warnings.push({ step: "pipeline", message: result.pipeline.error });
  }

  const succeeded = [
    result.fireflies.ok,
    result.slackUsers.ok,
    result.slackMessages.ok,
    result.pipeline.ok,
  ].filter(Boolean).length;
  result.success = succeeded > 0;

  if (succeeded === 0) {
    throw new Error(
      "Unable to sync latest signals. Fireflies, Slack channels/messages, Slack users, and pipeline sync all failed."
    );
  }

  return result;
}

export { BACKEND_BASE_URL };
