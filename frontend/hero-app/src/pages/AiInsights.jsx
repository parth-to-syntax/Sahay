import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Brain, CalendarClock, RefreshCw, TrendingDown, TrendingUp, Users } from "lucide-react";
import { getDashboardSummary, listEmployees, listMeetings } from "../lib/api";

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toMillis(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toPct(value) {
  return `${Math.round(asNumber(value, 0) * 100)}%`;
}

function getRiskWeight(risk) {
  const text = String(risk || "").toLowerCase();
  if (text === "critical") return 4;
  if (text === "high") return 3;
  if (text === "medium") return 2;
  if (text === "low") return 1;
  return 0;
}

function buildInsights(employees = [], meetings = []) {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const activeMeetingEmployees = new Set(
    meetings
      .filter((meeting) => toMillis(meeting?.meetingAt) >= sevenDaysAgo)
      .map((meeting) => String(meeting?.employeeEmail || "").toLowerCase())
      .filter(Boolean)
  );

  const topRisk = [...employees]
    .sort((a, b) => {
      const riskDiff = getRiskWeight(b?.risk) - getRiskWeight(a?.risk);
      if (riskDiff !== 0) return riskDiff;
      return asNumber(b?.riskScore) - asNumber(a?.riskScore);
    })
    .slice(0, 5);

  const decliningSentiment = [...employees]
    .filter((row) => asNumber(row?.deltaSentiment7d, 0) < 0)
    .sort((a, b) => asNumber(a?.deltaSentiment7d, 0) - asNumber(b?.deltaSentiment7d, 0))
    .slice(0, 5);

  const lowCoverage = [...employees]
    .filter((row) => !activeMeetingEmployees.has(String(row?.email || "").toLowerCase()))
    .slice(0, 8);

  return {
    topRisk,
    decliningSentiment,
    lowCoverage,
    meetingCoveragePct:
      employees.length > 0 ? (activeMeetingEmployees.size / employees.length) * 100 : 0,
  };
}

function InsightCard({ icon: Icon, title, value, subtitle }) {
  return (
    <div className="surface-card rounded-2xl p-5 border border-gray-200">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-600">{title}</h3>
        <Icon className="w-4 h-4 text-[#0f766e]" />
      </div>
      <p className="text-2xl font-bold text-[#1f2937]">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
    </div>
  );
}

export function AiInsights() {
  const [summary, setSummary] = useState({});
  const [employees, setEmployees] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function loadData({ silent = false } = {}) {
    try {
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);
      setError("");

      const [summaryPayload, employeeRows, meetingRows] = await Promise.all([
        getDashboardSummary(),
        listEmployees(),
        listMeetings({ limit: 500 }),
      ]);

      setSummary(summaryPayload || {});
      setEmployees(Array.isArray(employeeRows) ? employeeRows : []);
      setMeetings(Array.isArray(meetingRows) ? meetingRows : []);
    } catch (err) {
      setError(err?.message || "Unable to load AI insights");
      setSummary({});
      setEmployees([]);
      setMeetings([]);
    } finally {
      if (silent) setIsRefreshing(false);
      else setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const computed = useMemo(() => buildInsights(employees, meetings), [employees, meetings]);
  const criticalCount = useMemo(
    () => employees.filter((row) => String(row?.risk || "").toLowerCase() === "critical").length,
    [employees]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1f2937]">AI Insights</h1>
          <p className="text-gray-500 mt-1">
            Cross-source insights from HRMS, meetings, and sentiment/risk trends.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadData({ silent: true })}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 rounded-md border border-[#0f766e]/35 px-3 py-2 text-sm font-medium text-[#0f766e] hover:bg-[#0f766e]/10 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Refreshing..." : "Refresh Insights"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg">
          {error}
        </div>
      )}

      {isLoading && <div className="text-sm text-gray-500">Loading insights...</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <InsightCard
          icon={Brain}
          title="Employee Profiles"
          value={String(employees.length)}
          subtitle="AI-ready people records"
        />
        <InsightCard
          icon={AlertTriangle}
          title="Critical Risk"
          value={String(criticalCount)}
          subtitle="Immediate intervention candidates"
        />
        <InsightCard
          icon={CalendarClock}
          title="7-Day Meeting Coverage"
          value={`${Math.round(computed.meetingCoveragePct)}%`}
          subtitle="Employees with at least one recent meeting"
        />
        <InsightCard
          icon={Users}
          title="At-Risk Employees"
          value={String(asNumber(summary?.atRiskEmployees, 0))}
          subtitle="From dashboard risk aggregates"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="surface-card rounded-2xl border border-gray-200 p-5 xl:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <h2 className="text-base font-semibold text-[#1f2937]">Top Risk Employees</h2>
          </div>
          <div className="space-y-3">
            {computed.topRisk.map((row) => (
              <div key={row.id} className="rounded-lg border border-gray-200 p-3 bg-white">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[#1f2937]">{row.name}</p>
                  <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
                    {row.risk || "Unknown"}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{row.dept} • {row.role}</p>
                <p className="text-xs text-gray-600 mt-1">
                  Risk score: {Math.round(asNumber(row.riskScore, 0))} • Confidence: {toPct(row.confidence)}
                </p>
              </div>
            ))}
            {computed.topRisk.length === 0 && <p className="text-sm text-gray-500">No risk insights yet.</p>}
          </div>
        </section>

        <section className="surface-card rounded-2xl border border-gray-200 p-5 xl:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-4 h-4 text-amber-600" />
            <h2 className="text-base font-semibold text-[#1f2937]">Declining Sentiment (7d)</h2>
          </div>
          <div className="space-y-3">
            {computed.decliningSentiment.map((row) => (
              <div key={row.id} className="rounded-lg border border-gray-200 p-3 bg-white">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[#1f2937]">{row.name}</p>
                  <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    {asNumber(row.deltaSentiment7d).toFixed(1)}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Current sentiment: {Math.round(asNumber(row.sentimentScoreRaw, 0))}/100</p>
              </div>
            ))}
            {computed.decliningSentiment.length === 0 && (
              <p className="text-sm text-gray-500">No negative sentiment trend detected.</p>
            )}
          </div>
        </section>

        <section className="surface-card rounded-2xl border border-gray-200 p-5 xl:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-[#0f766e]" />
            <h2 className="text-base font-semibold text-[#1f2937]">Action Queue</h2>
          </div>
          <div className="space-y-3 text-sm text-gray-700">
            <div className="rounded-lg border border-gray-200 p-3 bg-white">
              <p className="font-medium text-[#1f2937]">Review Non-Covered Employees</p>
              <p className="text-xs text-gray-600 mt-1">
                {computed.lowCoverage.length} employees had no meetings in the last 7 days.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3 bg-white">
              <p className="font-medium text-[#1f2937]">Prioritize Critical Risk Check-ins</p>
              <p className="text-xs text-gray-600 mt-1">
                {criticalCount} employees are in critical risk band.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3 bg-white">
              <p className="font-medium text-[#1f2937]">Pipeline Refresh</p>
              <p className="text-xs text-gray-600 mt-1">
                Run refresh on high-risk profiles before leadership meetings.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
