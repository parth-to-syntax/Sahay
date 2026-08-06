import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Mail, Briefcase, Calendar, User as UserIcon, Activity, AlertTriangle, MessageSquare } from "lucide-react";
import { getEmployeeProfileByEmail, getEmployeeHistoryByEmail } from "../lib/api";
import { HistoryTrendChart, mapHistoryRowsForChart } from "../components/HistoryTrendChart";

function asFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return "0.00";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function getRiskLevelValue(level) {
  const normalized = String(level || "").trim().toLowerCase();
  if (normalized === "critical") return 4;
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  if (normalized === "low") return 1;
  return 0;
}

function getRiskHistoryRows(riskHistory = []) {
  return [...riskHistory].sort((a, b) => {
    const aTime = new Date(a?.analyzedAt || a?.createdAt || 0).getTime();
    const bTime = new Date(b?.analyzedAt || b?.createdAt || 0).getTime();
    return aTime - bTime;
  });
}

function getSeveritySignalCount(row, severity) {
  const normalizedSeverity = String(severity || "").toLowerCase();
  const direct = asFiniteNumber(
    row?.signalCounts?.[normalizedSeverity] ??
      row?.signalsBySeverity?.[normalizedSeverity] ??
      row?.retentionRisk?.signalCounts?.[normalizedSeverity],
    NaN
  );
  if (Number.isFinite(direct)) {
    return direct;
  }

  const signals = Array.isArray(row?.signals)
    ? row.signals
    : Array.isArray(row?.retentionRisk?.signals)
      ? row.retentionRisk.signals
      : [];

  if (signals.length > 0) {
    return signals.filter((signal) => String(signal?.severity || signal?.level || "").toLowerCase() === normalizedSeverity).length;
  }

  return 0;
}

function inferSourceTag(text) {
  const value = String(text || "").toLowerCase();
  if (!value) return "Model";
  if (/(slack|message|channel|reaction|activity|status)/.test(value)) return "Slack";
  if (/(meeting|transcript|zoom|call|1:1|one-on-one)/.test(value)) return "Meeting";
  if (/(risk|retention|signal|opportunit|transfer|linkedin|attrition)/.test(value)) return "Risk Signals";
  return "Model";
}

function hasExitIntentLanguage(text) {
  const value = String(text || "").toLowerCase();
  if (!value) return false;
  return [
    "want to leave",
    "leave this company",
    "not satisfied",
    "quit",
    "resign",
    "job search",
    "linkedin",
    "other opportunities",
  ].some((token) => value.includes(token));
}

function buildReasonOfChangeRows(employee, history) {
  const rows = [];
  const summary = history?.summary || {};

  const recentSentimentDelta = asFiniteNumber(employee?.deltaSentiment7d, summary?.sentimentDelta ?? 0);
  const recentRiskDelta = asFiniteNumber(employee?.deltaRisk30d, summary?.riskDelta ?? 0);
  const longSentimentDelta = asFiniteNumber(summary?.sentimentDelta, recentSentimentDelta);
  const slackCount = asFiniteNumber(employee?.slackMessageCount, 0);
  const keyEvidence = Array.isArray(employee?.sentimentKeyEvidence)
    ? employee.sentimentKeyEvidence.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const sentimentEvidence = String(employee?.sentimentEvidence || "").trim();
  const evidenceText = keyEvidence.length > 0
    ? keyEvidence.slice(0, 2).join(" | ")
    : sentimentEvidence;
  const riskSummaryText = String(employee?.riskSummary || "").trim();

  const exitIntentDetected = [
    evidenceText,
    sentimentEvidence,
    riskSummaryText,
    ...(Array.isArray(employee?.observations) ? employee.observations : []),
  ].some((item) => hasExitIntentLanguage(item));

  const longWindowDiffers = Math.abs(longSentimentDelta - recentSentimentDelta) >= 5;
  const sentimentDetail = [
    `Sentiment shifted ${formatSigned(recentSentimentDelta)} points; current sentiment is ${Math.round(asFiniteNumber(employee?.sentimentScoreRaw, 0))}/100.`,
    slackCount > 0
      ? `Reason from Slack (${Math.round(slackCount)} message${Math.round(slackCount) === 1 ? "" : "s"} analyzed): ${evidenceText || "Signal extracted from recent Slack discussions."}`
      : "Reason from Slack: no new Slack text in this analysis window.",
    longWindowDiffers
      ? `Long-window trend is ${formatSigned(longSentimentDelta)}, while latest-window trend is ${formatSigned(recentSentimentDelta)}.`
      : "",
    exitIntentDetected
      ? "Exit-intent language is present in recent evidence, so this should be treated as a negative retention signal even if short-window sentiment appears stable."
      : "",
  ].join(" ");

  rows.push({
    title: "Sentiment Movement",
    detail: sentimentDetail,
    source: "Slack",
  });

  rows.push({
    title: "Retention Risk Shift",
    detail: `Risk shifted ${formatSigned(recentRiskDelta)} points; current level is ${employee?.riskLevel || "Unknown"}${Number.isFinite(Number(employee?.riskScore)) ? ` (${Math.round(Number(employee.riskScore))})` : ""}.`,
    source: "Risk Signals",
  });

  const orderedRiskRows = getRiskHistoryRows(history?.riskHistory || []);
  const latestRisk = orderedRiskRows[orderedRiskRows.length - 1] || null;
  const previousRisk = orderedRiskRows.length > 1 ? orderedRiskRows[orderedRiskRows.length - 2] : null;

  if (latestRisk) {
    const latestCritical = getSeveritySignalCount(latestRisk, "critical");
    const previousCritical = previousRisk ? getSeveritySignalCount(previousRisk, "critical") : 0;
    const latestHigh = getSeveritySignalCount(latestRisk, "high");
    const previousHigh = previousRisk ? getSeveritySignalCount(previousRisk, "high") : 0;
    const criticalDelta = latestCritical - previousCritical;
    const highDelta = latestHigh - previousHigh;

    rows.push({
      title: "Signal Intensity Change",
      detail: `Critical signals ${formatSigned(criticalDelta, 0)} (${latestCritical} now), high signals ${formatSigned(highDelta, 0)} (${latestHigh} now) versus previous analysis.`,
      source: "Risk Signals",
    });

    const latestLevel = String(latestRisk?.level || latestRisk?.riskLevel || "");
    const previousLevel = String(previousRisk?.level || previousRisk?.riskLevel || "");
    if (latestLevel) {
      const levelDelta = getRiskLevelValue(latestLevel) - getRiskLevelValue(previousLevel);
      rows.push({
        title: "Risk Level Transition",
        detail: previousLevel
          ? `Risk level moved from ${previousLevel} to ${latestLevel} (${formatSigned(levelDelta, 0)} level step change).`
          : `Latest risk level is ${latestLevel}; previous comparable level is unavailable.`,
        source: "Risk Signals",
      });
    }
  }

  if (riskSummaryText) {
    rows.push({
      title: "Risk Narrative",
      detail: riskSummaryText,
      source: inferSourceTag(riskSummaryText),
    });
  }

  const observations = Array.isArray(employee?.observations) ? employee.observations : [];
  observations.slice(0, 3).forEach((item, index) => {
    const detail = String(item || "").trim();
    if (!detail) return;

    rows.push({
      title: `Observation ${index + 1}`,
      detail,
      source: inferSourceTag(detail),
    });
  });

  if (rows.length === 0) {
    rows.push({
      title: "No Recent Changes",
      detail: "No structured change details are available yet for this employee.",
      source: "Model",
    });
  }

  return rows;
}

export function EmployeeProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState(null);
  const [history, setHistory] = useState({ sentimentHistory: [], riskHistory: [], summary: {} });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const profileEmail = useMemo(() => {
    const decoded = decodeURIComponent(String(id || "")).toLowerCase();
    return decoded.includes("@") ? decoded : "";
  }, [id]);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      try {
        setIsLoading(true);
        setError("");

        if (!profileEmail) {
          throw new Error("Invalid employee identifier");
        }

        const [profile, profileHistory] = await Promise.all([
          getEmployeeProfileByEmail(profileEmail),
          getEmployeeHistoryByEmail(profileEmail, 45),
        ]);
        if (!isMounted) return;
        setEmployee(profile);
        setHistory(profileHistory);
      } catch (err) {
        if (!isMounted) return;
        setError(err?.message || "Unable to load employee profile");
        setEmployee(null);
        setHistory({ sentimentHistory: [], riskHistory: [], summary: {} });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadProfile();
    return () => {
      isMounted = false;
    };
  }, [profileEmail]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center text-sm text-gray-500 hover:text-[#1f7a6c] transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Employees
        </button>
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-600">Loading profile...</div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center text-sm text-gray-500 hover:text-[#1f7a6c] transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Employees
        </button>
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-600">
          {error || "Employee profile not found."}
        </div>
      </div>
    );
  }

  const sentimentTrendData = mapHistoryRowsForChart(
    (history?.sentimentHistory || []).map((row) => ({
      analyzedAt: row?.analyzedAt || row?.createdAt || "",
      score: Number(row?.score),
      smoothedScore: Number(row?.smoothedScore),
    }))
  );

  const riskTrendData = mapHistoryRowsForChart(
    (history?.riskHistory || []).map((row) => ({
      analyzedAt: row?.analyzedAt || row?.createdAt || "",
      score: Number(row?.score),
    }))
  );

  const sentimentDelta = Number.isFinite(Number(employee?.deltaSentiment7d))
    ? Number(employee.deltaSentiment7d)
    : Number(history?.summary?.sentimentDelta || 0);
  const riskDelta = Number.isFinite(Number(employee?.deltaRisk30d))
    ? Number(employee.deltaRisk30d)
    : Number(history?.summary?.riskDelta || 0);
  const reasonRows = buildReasonOfChangeRows(employee, history);

  return (
    <div className="space-y-6">
      <button 
        onClick={() => navigate(-1)}
        className="flex items-center text-sm text-gray-500 hover:text-[#1f7a6c] transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Employees
      </button>

      {isLoading && <div className="text-sm text-gray-500">Refreshing employee profile...</div>}
      {error && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg">
          Live profile unavailable: {error}.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Section */}
        <div className="col-span-1 lg:col-span-1 bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col items-center">
          <div className="w-24 h-24 rounded-full bg-[#1f7a6c]/10 flex items-center justify-center text-[#1f7a6c] font-medium text-2xl mb-4">
            {employee.name.split(' ').map(n => n[0]).join('')}
          </div>
          <h2 className="text-xl font-bold text-[#1f2937] text-center">{employee.name}</h2>
          <p className="text-gray-500 text-sm mb-6 bg-gray-100 px-3 py-1 rounded-full mt-2">{employee.role}</p>
          
          <div className="w-full space-y-4 pt-4 border-t border-gray-200 text-sm">
            <div className="flex items-center text-gray-600">
              <Mail className="w-4 h-4 mr-3 text-gray-400" />
              {employee.email}
            </div>
            <div className="flex items-center text-gray-600">
              <Briefcase className="w-4 h-4 mr-3 text-gray-400" />
              {employee.dept}
            </div>
            <div className="flex items-center text-gray-600">
              <UserIcon className="w-4 h-4 mr-3 text-gray-400" />
              Reports to: {employee.manager}
            </div>
            <div className="flex items-center text-gray-600">
              <Calendar className="w-4 h-4 mr-3 text-gray-400" />
              Joined {employee.joinDate}
            </div>
          </div>
        </div>

        {/* Insights Section */}
        <div className="col-span-1 lg:col-span-2 space-y-6">
          <h3 className="text-lg font-semibold text-[#1f2937]">Employee Insights</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-500">Sentiment Score</span>
                <Activity className="w-4 h-4 text-[#1f7a6c]" />
              </div>
              <p className="text-2xl font-bold text-[#1f2937]">
                {Number.isFinite(Number(employee.sentimentScoreRaw))
                  ? `${Math.round(Number(employee.sentimentScoreRaw))}/100`
                  : (employee.sentimentScore || "")}
              </p>
              {Number.isFinite(Number(employee.healthScore)) && (
                <p className="text-xs text-gray-500 mt-1">Health Score: {Math.round(Number(employee.healthScore))}/100</p>
              )}
            </div>
            
            <div className="bg-white p-5 rounded-xl border border-[#f59e0b]/30 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-1 h-full bg-[#f59e0b]" />
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-500">Retention Risk</span>
                <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />
              </div>
              <p className="text-2xl font-bold text-[#f59e0b]">{employee.riskLevel || ""}{Number.isFinite(Number(employee.riskScore)) ? ` (${Math.round(Number(employee.riskScore))})` : ""}</p>
            </div>
            
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-500">Confidence</span>
                <MessageSquare className="w-4 h-4 text-gray-400" />
              </div>
              <p className="text-2xl font-bold text-[#1f2937]">
                {Number.isFinite(Number(employee.confidence)) ? `${Math.round(Number(employee.confidence) * 100)}%` : "-"}
              </p>
              <p className="text-xs text-gray-500 mt-1">Total Meetings: {employee.totalMeetings}</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mt-6">
            <h4 className="text-md font-medium text-[#1f2937] mb-4">Latest Platform Observations</h4>
            <div className="space-y-4">
              {reasonRows.map((row, index) => (
                <div key={`${row.title}-${index}`} className={`border-l-2 pl-4 py-1 ${index === 0 ? "border-[#f59e0b]" : "border-gray-300"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-gray-900">{row.title}</p>
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                      {row.source}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 mt-1">{row.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mt-6">
            <h4 className="text-md font-medium text-[#1f2937] mb-4">Scoring Breakdown</h4>
            <div className="space-y-3 text-sm text-gray-700">
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span>Scoring Version</span>
                <span className="text-gray-500">{employee.scoringVersion || "-"}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  ["Sentiment", employee?.contributors?.sentiment],
                  ["Retention Safety", employee?.contributors?.retentionSafety],
                  ["Engagement", employee?.contributors?.engagement],
                  ["HRMS", employee?.contributors?.hrms],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between py-1 px-2 rounded bg-gray-50 border border-gray-100">
                    <span>{label}</span>
                    <span className="text-gray-600">{Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "-"}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="flex justify-between py-1 px-2 rounded bg-gray-50 border border-gray-100">
                  <span>Risk Delta (30d)</span>
                  <span className="text-gray-600">
                    {Number.isFinite(Number(employee.deltaRisk30d))
                      ? `${Number(employee.deltaRisk30d) > 0 ? "+" : ""}${Number(employee.deltaRisk30d).toFixed(2)}`
                      : "-"}
                  </span>
                </div>
                <div className="flex justify-between py-1 px-2 rounded bg-gray-50 border border-gray-100">
                  <span>Sentiment Delta (7d)</span>
                  <span className="text-gray-600">
                    {Number.isFinite(Number(employee.deltaSentiment7d))
                      ? `${Number(employee.deltaSentiment7d) > 0 ? "+" : ""}${Number(employee.deltaSentiment7d).toFixed(2)}`
                      : "-"}
                  </span>
                </div>
              </div>
              {(employee?.extractionMeta?.sentimentFallbackUsed || employee?.extractionMeta?.retentionFallbackUsed) && (
                <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs">
                  Extraction fallback was used in the latest scoring pass; confidence may be reduced.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="text-xs text-gray-600 px-1">
              Trend summary: Sentiment {sentimentDelta > 0 ? "+" : ""}{sentimentDelta.toFixed(2)} | Risk {riskDelta > 0 ? "+" : ""}{riskDelta.toFixed(2)}
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <HistoryTrendChart
                title="Sentiment Trend"
                data={sentimentTrendData}
                lines={[
                  { key: "score", label: "Sentiment", color: "#0f766e" },
                  { key: "smoothedScore", label: "Smoothed", color: "#334155" },
                ]}
                emptyText="No sentiment history available yet."
              />
              <HistoryTrendChart
                title="Risk Trend"
                data={riskTrendData}
                lines={[{ key: "score", label: "Risk", color: "#b45309" }]}
                emptyText="No risk history available yet."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
