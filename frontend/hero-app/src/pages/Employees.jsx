import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { listEmployees, refreshEmployeePipeline, syncBambooHrEmployees, syncLatestSignals } from "../lib/api";

const REFRESH_POLL_INTERVAL_MS = 2500;
const REFRESH_POLL_MAX_ATTEMPTS = 12;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toTime(value) {
  const timestamp = new Date(value || "").getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildRefreshFingerprint(person) {
  return [
    String(person?.updatedAt || ""),
    String(person?.lastMeeting || ""),
    String(person?.totalMeetings || 0),
    String(person?.risk || ""),
    String(person?.sentiment || ""),
    String(Math.round(Number(person?.sentimentScoreRaw || 0))),
    String(Math.round(Number(person?.healthScore || 0))),
  ].join("|");
}

function hasEmployeeRefreshed(before, after) {
  if (!after) return false;

  const beforeUpdatedAt = toTime(before?.updatedAt);
  const afterUpdatedAt = toTime(after?.updatedAt);
  if (afterUpdatedAt > beforeUpdatedAt) {
    return true;
  }

  return buildRefreshFingerprint(before) !== buildRefreshFingerprint(after);
}

export function Employees() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [employees, setEmployees] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshNotice, setRefreshNotice] = useState("");
  const [refreshingByEmail, setRefreshingByEmail] = useState({});
  const [refreshStatusByEmail, setRefreshStatusByEmail] = useState({});
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [isSignalSyncing, setIsSignalSyncing] = useState(false);

  const loadEmployees = useCallback(async ({ withLoader = true } = {}) => {
    try {
      if (withLoader) setIsLoading(true);
      const data = await listEmployees();
      setEmployees(data);
      setError("");
    } catch (err) {
      setEmployees([]);
      setError(err?.message || "Unable to load live employee data");
    } finally {
      if (withLoader) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  const setRefreshStatus = useCallback((email, status) => {
    setRefreshStatusByEmail((prev) => ({ ...prev, [email]: status }));
  }, []);

  async function pollEmployeeRefresh(email, beforeSnapshot) {
    for (let attempt = 0; attempt < REFRESH_POLL_MAX_ATTEMPTS; attempt += 1) {
      await sleep(REFRESH_POLL_INTERVAL_MS);
      const rows = await listEmployees();
      setEmployees(rows);

      const latest = rows.find((item) => String(item?.email || "").toLowerCase() === email);
      if (hasEmployeeRefreshed(beforeSnapshot, latest)) {
        return { updated: true, latest };
      }
    }

    return { updated: false, latest: null };
  }

  async function handleRefreshEmployee(person) {
    const email = String(person?.email || "").toLowerCase();
    if (!email || refreshingByEmail[email]) {
      return;
    }

    const baseline = employees.find((item) => String(item?.email || "").toLowerCase() === email) || person;

    setError("");
    setRefreshNotice("");
    setRefreshingByEmail((prev) => ({ ...prev, [email]: true }));
    setRefreshStatus(email, "starting");
    setRefreshNotice(`Starting refresh for ${person.name || email}...`);

    try {
      await refreshEmployeePipeline(email, "manual-refresh");
      setRefreshStatus(email, "polling");
      setRefreshNotice(`Refresh accepted for ${person.name || email}. Checking for updated AI summary...`);

      const pollResult = await pollEmployeeRefresh(email, baseline);
      if (pollResult.updated) {
        setRefreshStatus(email, "updated");
        setRefreshNotice(`AI summary updated for ${person.name || email}.`);
      } else {
        setRefreshStatus(email, "queued");
        setRefreshNotice(`Refresh is still processing for ${person.name || email}. It remains queued in the background.`);
      }
    } catch (err) {
      setRefreshStatus(email, "error");
      setError(err?.message || "Unable to trigger refresh for employee");
    } finally {
      setRefreshingByEmail((prev) => ({ ...prev, [email]: false }));

      setTimeout(() => {
        setRefreshStatusByEmail((prev) => {
          const next = { ...prev };
          delete next[email];
          return next;
        });
      }, 3500);
    }
  }

  function getRefreshButtonLabel(email) {
    const status = refreshStatusByEmail[email];
    if (status === "starting") return "Starting...";
    if (status === "polling") return "Checking...";
    if (status === "updated") return "Updated";
    if (status === "queued") return "Queued";
    if (status === "error") return "Retry";
    return "Refresh";
  }

  async function handleSyncAllBambooHr() {
    if (isBulkSyncing) {
      return;
    }

    setError("");
    setRefreshNotice("Starting BambooHR sync for all employees...");
    setIsBulkSyncing(true);

    try {
      const result = await syncBambooHrEmployees({
        runPipeline: false,
        continueOnError: true,
      });

      const total = Number(result?.totalCandidates || 0);
      const accepted = Number(result?.acceptedCount || 0);
      const failed = Number(result?.errorCount || 0);

      setRefreshNotice(
        `BambooHR sync completed: ${accepted}/${total} employees updated${failed > 0 ? `, ${failed} failed` : ""}.`
      );

      await loadEmployees({ withLoader: false });
    } catch (err) {
      setError(err?.message || "Unable to sync BambooHR employees");
    } finally {
      setIsBulkSyncing(false);
    }
  }

  async function handleSyncLatestSignals() {
    if (isSignalSyncing) {
      return;
    }

    setError("");
    setRefreshNotice("Syncing latest Slack users and meeting transcripts...");
    setIsSignalSyncing(true);

    try {
      const result = await syncLatestSignals({ runPipeline: false, transcriptLimit: 25 });
      const transcriptsSeen = Number(result?.fireflies?.transcriptsSeen || 0);
      const slackMessagesSeen = Number(result?.slackMessages?.messagesSeen || 0);
      const slackChannelsProcessed = Number(result?.slackMessages?.channelsProcessed || 0);
      const accepted = Number(result?.pipeline?.acceptedCount || 0);
      const total = Number(result?.pipeline?.totalCandidates || 0);
      const warningCount = Array.isArray(result?.warnings) ? result.warnings.length : 0;

      setRefreshNotice(
        `Latest signals synced: transcripts ${transcriptsSeen}, Slack messages ${slackMessagesSeen} across ${slackChannelsProcessed} channels, bulk pipeline disabled (${accepted}/${total}), warnings ${warningCount}. Use per-employee Refresh for targeted AI runs.`
      );

      await loadEmployees({ withLoader: false });
    } catch (err) {
      setError(err?.message || "Unable to sync latest Slack and meeting signals");
    } finally {
      setIsSignalSyncing(false);
    }
  }

  const filteredEmployees = employees.filter((emp) => {
    const term = search.toLowerCase();
    return (
      emp.name.toLowerCase().includes(term) ||
      emp.dept.toLowerCase().includes(term) ||
      emp.role.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1f2937]">Employees</h1>
          <p className="text-gray-500 mt-1">
            {isLoading ? "Loading live workforce data..." : "Manage and track your entire workforce here."}
          </p>
        </div>

        <div className="flex w-full sm:w-auto items-center gap-2">
          <button
            type="button"
            onClick={handleSyncAllBambooHr}
            disabled={isBulkSyncing}
            className="inline-flex items-center gap-2 rounded-md border border-[#1f7a6c]/30 px-3 py-2 text-sm font-medium text-[#1f7a6c] hover:bg-[#1f7a6c]/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${isBulkSyncing ? "animate-spin" : ""}`} />
            {isBulkSyncing ? "Syncing BambooHR..." : "Sync BambooHR"}
          </button>

          <button
            type="button"
            onClick={handleSyncLatestSignals}
            disabled={isSignalSyncing}
            className="inline-flex items-center gap-2 rounded-md border border-[#1f7a6c]/30 px-3 py-2 text-sm font-medium text-[#1f7a6c] hover:bg-[#1f7a6c]/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${isSignalSyncing ? "animate-spin" : ""}`} />
            {isSignalSyncing ? "Syncing Latest Slack + Meetings..." : "Sync Latest Slack + Meetings"}
          </button>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, dept, or role..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a6c]/50 focus:border-[#1f7a6c] bg-white transition-colors"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg">
          Live API unavailable: {error}.
        </div>
      )}

      {refreshNotice && (
        <div className="text-sm text-[#1f7a6c] bg-[#1f7a6c]/10 border border-[#1f7a6c]/20 px-4 py-2 rounded-lg">
          {refreshNotice}
        </div>
      )}

      <div className="surface-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department / Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Manager</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joining Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Meeting</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Meetings</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sentiment Score</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredEmployees.map((person) => (
                <tr
                  key={person.id}
                  onClick={() => person.email && navigate(`/employees/${encodeURIComponent(person.email)}`)}
                  className={`transition-colors duration-150 ${person.email ? "hover:bg-[#1f7a6c]/5 cursor-pointer" : ""}`}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="shrink-0 h-10 w-10 rounded-full bg-[#1f7a6c]/10 flex items-center justify-center text-[#1f7a6c] font-medium text-sm">
                        {person.name.split(" ").map((n) => n[0]).join("")}
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{person.name}</div>
                        <div className="text-sm text-gray-500">{person.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{person.dept}</div>
                    <div className="text-sm text-gray-500">{person.role}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{person.manager}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{person.joinDate}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{person.lastMeeting}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{person.totalMeetings}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div>{Number.isFinite(Number(person.sentimentScoreRaw)) ? `${Math.round(Number(person.sentimentScoreRaw))}/100` : "--"}</div>
                    <div className="text-xs text-gray-400">
                      Health: {Number.isFinite(Number(person.healthScore)) ? `${Math.round(Number(person.healthScore))}/100` : "--"}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-medium rounded-full ${
                      person.risk === "Critical" ? "bg-red-100 text-red-800"
                      : person.risk === "High" ? "bg-amber-100 text-orange-800"
                      : person.risk === "Medium" ? "bg-yellow-100 text-yellow-800"
                      : "bg-green-100 text-green-800"
                    }`}>
                      {person.risk || "Low"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRefreshEmployee(person);
                      }}
                      disabled={!person.email || Boolean(refreshingByEmail[String(person.email).toLowerCase()])}
                      className="inline-flex items-center gap-2 rounded-md border border-[#1f7a6c]/30 px-3 py-1.5 text-xs font-medium text-[#1f7a6c] hover:bg-[#1f7a6c]/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${Boolean(refreshingByEmail[String(person.email).toLowerCase()]) ? "animate-spin" : ""}`}
                      />
                      {getRefreshButtonLabel(String(person.email || "").toLowerCase())}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredEmployees.length === 0 && (
                <tr>
                  <td colSpan="9" className="px-6 py-8 text-center text-sm text-gray-500">
                    No employees found matching &ldquo;{search}&rdquo;
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
