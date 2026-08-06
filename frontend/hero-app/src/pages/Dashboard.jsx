import { useEffect, useMemo, useState } from "react";
import { Users, Calendar, AlertTriangle, Activity } from "lucide-react";
import { MetricCard } from "../components/MetricCard";
import { SentimentChart } from "../components/SentimentChart";
import { DepartmentPieChart } from "../components/DepartmentPieChart";
import { DashboardAlerts } from "../components/DashboardAlerts";
import { getDashboardSummary, listEmployees } from "../lib/api";

function titleCase(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getSentimentFromScore(score) {
  if (!Number.isFinite(score)) return "Neutral";
  if (score >= 70) return "Positive";
  if (score >= 45) return "Neutral";
  return "Negative";
}

function normalizeSentiment(rawValue, sentimentScoreRaw) {
  const text = String(rawValue || "").trim().toLowerCase();
  if (["positive", "neutral", "negative"].includes(text)) {
    return titleCase(text);
  }
  if (text === "up") return "Positive";
  if (text === "flat") return "Neutral";
  if (text === "down") return "Negative";
  return getSentimentFromScore(sentimentScoreRaw);
}

function normalizeRisk(rawValue, healthScore) {
  const text = String(rawValue || "").trim().toLowerCase();
  if (["critical", "high", "medium", "low"].includes(text)) {
    return titleCase(text);
  }
  if (!Number.isFinite(healthScore)) return "Low";
  if (healthScore <= 35) return "Critical";
  if (healthScore <= 50) return "High";
  if (healthScore <= 70) return "Medium";
  return "Low";
}

// ---------- Employee Detail Modal ----------
function EmployeeModal({ person, onClose }) {
  if (!person) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#1f7a6c]/10 flex items-center justify-center text-[#1f7a6c] font-bold text-lg">
              {person.name.split(" ").map((n) => n[0]).join("")}
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1f2937]">{person.name}</h2>
              <p className="text-sm text-gray-500">{person.role} · {person.dept}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl font-light leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Risk & Sentiment Badges */}
          <div className="flex gap-3">
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
              person.sentiment === "Positive" ? "bg-green-100 text-green-800"
              : person.sentiment === "Negative" ? "bg-red-100 text-red-800"
              : "bg-gray-100 text-gray-800"
            }`}>
              Sentiment: {person.sentiment || ""}{Number.isFinite(Number(person.sentimentScoreRaw)) ? ` (${Math.round(Number(person.sentimentScoreRaw))}/100)` : ""}
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
              person.risk === "Critical" ? "bg-red-100 text-red-800"
              : person.risk === "High" ? "bg-amber-100 text-orange-800"
              : person.risk === "Medium" ? "bg-yellow-100 text-yellow-800"
              : "bg-green-100 text-green-800"
            }`}>
              Risk: {person.risk || ""}
            </span>
          </div>
          {Number.isFinite(Number(person.confidence)) && (
            <p className="text-xs text-gray-500 mt-1">
              Confidence: {Math.round(Number(person.confidence) * 100)}%
            </p>
          )}
          {Number.isFinite(Number(person.healthScore)) && (
            <p className="text-xs text-gray-500 mt-1">Health Score: {Math.round(Number(person.healthScore))}/100</p>
          )}

          {/* Employee details */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Employee Details</h3>
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span>Department</span><span className="text-gray-400">{person.dept || ""}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span>Role</span><span className="text-gray-400">{person.role || ""}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span>Last Meeting</span><span className="text-gray-400">{person.lastMeeting || ""}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Email</span><span className="text-gray-400">{person.email || ""}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-[#1f7a6c] text-white rounded-lg text-sm font-medium hover:bg-[#165a50] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Main Dashboard ----------
export function Dashboard() {
  const [modalEmployee, setModalEmployee] = useState(null);
  const [insights, setInsights] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [summary, setSummary] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      try {
        setIsLoading(true);
        setError("");
        const [summaryData, employeeData] = await Promise.all([getDashboardSummary(), listEmployees()]);
        if (!isMounted) return;

        const summaryEmployees = Array.isArray(summaryData?.employees) ? summaryData.employees : [];
        const summaryByEmail = new Map(
          summaryEmployees.map((row) => [
            String(row?.email || row?.employeeEmail || "").toLowerCase(),
            row,
          ])
        );

        const enrichedEmployees = employeeData.map((employee) => {
          const email = String(employee?.email || employee?.employeeEmail || "").toLowerCase();
          const summaryRow = summaryByEmail.get(email) || {};
          const sentimentScoreRawCandidate = Number(
            summaryRow?.sentimentScore ?? employee?.sentimentScoreRaw
          );
          const sentimentScoreRaw = Number.isFinite(sentimentScoreRawCandidate)
            ? sentimentScoreRawCandidate
            : Number(employee?.sentimentScoreRaw);

          const healthScoreCandidate = Number(summaryRow?.healthScore ?? employee?.healthScore ?? employee?.score);
          const healthScore = Number.isFinite(healthScoreCandidate)
            ? healthScoreCandidate
            : Number(employee?.healthScore);

          return {
            ...employee,
            sentimentScoreRaw: Number.isFinite(sentimentScoreRaw) ? sentimentScoreRaw : employee?.sentimentScoreRaw,
            healthScore: Number.isFinite(healthScore) ? healthScore : employee?.healthScore,
            score: Number.isFinite(healthScore) ? healthScore : employee?.score,
            sentiment: normalizeSentiment(
              employee?.sentiment || summaryRow?.sentimentTrend || "",
              Number.isFinite(sentimentScoreRaw) ? sentimentScoreRaw : employee?.sentimentScoreRaw
            ),
            risk: normalizeRisk(
              employee?.risk || summaryRow?.riskLevel || "",
              Number.isFinite(healthScore) ? healthScore : employee?.healthScore
            ),
          };
        });

        setAllEmployees(enrichedEmployees);
        setInsights(enrichedEmployees.slice(0, 6));
        setSummary(summaryData || {});
      } catch (err) {
        if (!isMounted) return;
        setInsights([]);
        setAllEmployees([]);
        setSummary({});
        setError(err?.message || "Unable to load dashboard summary");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadDashboard();
    return () => {
      isMounted = false;
    };
  }, []);

  const metrics = useMemo(() => {
    const summaryEmployees = Array.isArray(summary?.employees) ? summary.employees : [];
    const totalEmployees = Number(summary?.totalEmployees || summary?.employeeCount || summaryEmployees.length || allEmployees.length || 0);
    const meetingsThisWeek = Number(summary?.meetingsThisWeek || summary?.weeklyMeetingCount || (Array.isArray(summary?.todayMeetings) ? summary.todayMeetings.length : 0));
    const highRisk = Number(summary?.riskCounts?.high || 0);
    const criticalRisk = Number(summary?.riskCounts?.critical || 0);
    const atRisk = Number(summary?.atRiskEmployees || summary?.highRiskCount || highRisk + criticalRisk);
    const risingRisk = Number(summary?.risingRiskEmployees || 0);

    const scoreValues = (summaryEmployees.length ? summaryEmployees : allEmployees)
      .map((row) => Number(row?.healthScore ?? row?.sentimentScore ?? row?.score))
      .filter((score) => Number.isFinite(score));
    const computedAvgHealth = scoreValues.length
      ? Math.round(scoreValues.reduce((total, score) => total + score, 0) / scoreValues.length)
      : 0;
    const avgHealthCandidate = Number(summary?.averageHealthScore);
    const avgHealth = Number.isFinite(avgHealthCandidate) ? Math.round(avgHealthCandidate) : computedAvgHealth;

    return {
      totalEmployees,
      meetingsThisWeek,
      atRisk,
      risingRisk,
      avgHealth,
    };
  }, [allEmployees.length, summary]);

  const sentimentData = useMemo(() => {
    const counts = {};
    allEmployees.forEach((employee) => {
      const key = String(employee?.sentiment || "").trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });

    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [allEmployees]);

  const departmentData = useMemo(() => {
    const counts = {};
    allEmployees.forEach((employee) => {
      const key = String(employee?.dept || "").trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });

    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [allEmployees]);

  const alerts = useMemo(() => {
    const items = [];

    allEmployees.forEach((employee) => {
      const risk = String(employee?.risk || "").trim();
      const sentiment = String(employee?.sentiment || "").trim();
      const deltaRisk30d = Number(employee?.deltaRisk30d || 0);

      if (["Critical", "High", "Medium"].includes(risk)) {
        items.push({
          employeeEmail: employee?.email || employee?.employeeEmail || employee?.id || "unknown",
          employee,
          type: "risk-level",
          severity: risk,
          title: `${employee?.name || "Employee"}: ${risk} risk`,
          description: `${employee?.name || "This employee"} currently has a ${risk.toLowerCase()} retention risk classification.`,
          priority: risk === "Critical" ? 400 : risk === "High" ? 300 : 200,
        });
      }

      if (Number.isFinite(deltaRisk30d) && deltaRisk30d >= 15) {
        items.push({
          employeeEmail: employee?.email || employee?.employeeEmail || employee?.id || "unknown",
          employee,
          type: "rising-risk",
          severity: "High",
          title: `${employee?.name || "Employee"}: rising risk trend`,
          description: `Risk increased by ${deltaRisk30d.toFixed(1)} points over the last 30 days.`,
          priority: 320,
        });
      }

      const sentimentScore = Number(employee?.sentimentScoreRaw);
      if (sentiment === "Negative" && Number.isFinite(sentimentScore) && sentimentScore <= 45) {
        items.push({
          employeeEmail: employee?.email || employee?.employeeEmail || employee?.id || "unknown",
          employee,
          type: "negative-sentiment",
          severity: "Medium",
          title: `${employee?.name || "Employee"}: negative sentiment`,
          description: `Latest sentiment score is ${Math.round(sentimentScore)}/100 and trending negative.`,
          priority: 210,
        });
      }
    });

    return items
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 8);
  }, [allEmployees]);

  return (
    <>
      {modalEmployee && (
        <EmployeeModal person={modalEmployee} onClose={() => setModalEmployee(null)} />
      )}

      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1f2937]">Workforce Overview</h1>
          <p className="text-gray-500 mt-1">Latest metrics and employee intelligence from integrated systems.</p>
        </div>

        {error && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg">
            Live dashboard unavailable: {error}.
          </div>
        )}

        {/* SECTION 1 – Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard title="Total Employees" value={String(metrics.totalEmployees)} description="Live employee registry" icon={Users} trend="up" />
          <MetricCard title="Meetings This Week" value={String(metrics.meetingsThisWeek)} description="From integrated meeting data" icon={Calendar} trend="up" />
          <MetricCard title="Employees At Risk" value={String(metrics.atRisk)} description={`Requires immediate attention • ${metrics.risingRisk} rising risk`} icon={AlertTriangle} trend="down" />
          <MetricCard title="Avg Health Score" value={`${metrics.avgHealth}/100`} description="Computed from latest profile analyses" icon={Activity} trend="up" />
        </div>

        {isLoading && <div className="text-sm text-gray-500">Loading dashboard data...</div>}

        {/* SECTION 2 & 3 – Charts + Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SentimentChart data={sentimentData} />
          <DepartmentPieChart data={departmentData} />
          <DashboardAlerts alerts={alerts} onSelectEmployee={(person) => setModalEmployee(person)} />
        </div>

        {/* SECTION 4 – Recent Employee Insights (clickable rows) */}
        <div className="surface-card rounded-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[#1f2937]">Recent Employee Insights</h3>
            <span className="text-xs text-gray-400">Click a row to view details</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Meeting</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sentiment</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk Level</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk Delta (30d)</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {insights.map((person) => (
                  <tr
                    key={person.id}
                    className="hover:bg-[#1f7a6c]/5 cursor-pointer transition-colors duration-150"
                    onClick={() => setModalEmployee(person)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="shrink-0 h-8 w-8 rounded-full bg-[#1f7a6c]/10 flex items-center justify-center text-[#1f7a6c] font-medium text-xs">
                          {person.name.split(" ").map((n) => n[0]).join("")}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{person.name}</div>
                          <div className="text-sm text-gray-500">{person.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{person.dept}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{person.lastMeeting}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-medium rounded-full ${
                        person.sentiment === "Positive" ? "bg-green-100 text-green-800"
                        : person.sentiment === "Negative" ? "bg-red-100 text-red-800"
                        : "bg-gray-100 text-gray-800"
                      }`}>
                        {person.sentiment || ""}{Number.isFinite(Number(person.sentimentScoreRaw)) ? ` (${Math.round(Number(person.sentimentScoreRaw))})` : ""}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-medium rounded-full ${
                        person.risk === "Critical" ? "bg-red-100 text-red-800"
                        : person.risk === "High"   ? "bg-amber-100 text-orange-800"
                        : person.risk === "Medium" ? "bg-yellow-100 text-yellow-800"
                        : "bg-green-100 text-green-800"
                      }`}>
                        {person.risk || ""}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {Number.isFinite(Number(person.deltaRisk30d))
                        ? `${Number(person.deltaRisk30d) > 0 ? "+" : ""}${Number(person.deltaRisk30d).toFixed(1)}`
                        : "-"}
                    </td>
                  </tr>
                ))}
                {insights.length === 0 && (
                  <tr>
                    <td colSpan="6" className="px-6 py-8 text-center text-sm text-gray-500">
                      No employee insights available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
