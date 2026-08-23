import { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, Clock, Users, ArrowRight, Lightbulb, CheckCircle2, ChevronLeft, ChevronRight, Loader2, ShieldAlert, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  getMeetingTranscript,
  getUpcomingBrief,
  listMeetings,
  refreshGoogleCalendarMeetings,
  syncCalendarEventsIngest,
  syncFirefliesTranscripts,
} from "../lib/api";

// ---------- Mini Calendar ----------
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function MiniCalendar({ meetings, onSelectMeeting }) {
  const today = new Date();
  const [viewDate, setViewDate] = useState(today);

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const meetingMap = {};
  meetings.forEach((m) => {
    const d = new Date(m.date);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const key = d.getDate();
      meetingMap[key] = meetingMap[key] || [];
      meetingMap[key].push(m);
    }
  });

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="select-none">
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-1.5 rounded hover:bg-gray-100 transition-colors">
          <ChevronLeft className="w-4 h-4 text-gray-500" />
        </button>
        <span className="text-sm font-semibold text-[#1f2937]">
          {MONTH_NAMES[month]} {year}
        </span>
        <button onClick={nextMonth} className="p-1.5 rounded hover:bg-gray-100 transition-colors">
          <ChevronRight className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Day names */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_NAMES.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-gray-400 pb-1">{d}</div>
        ))}
      </div>

      {/* Cells */}
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, idx) => {
          if (!day) return <div key={`e${idx}`} />;
          const hasEvent = !!meetingMap[day];
          const isToday =
            day === today.getDate() &&
            month === today.getMonth() &&
            year === today.getFullYear();
          return (
            <button
              key={day}
              onClick={() => hasEvent && onSelectMeeting(meetingMap[day][0])}
              className={`relative mx-auto w-8 h-8 flex items-center justify-center rounded-full text-xs transition-colors
                ${isToday ? "bg-[#1f7a6c] text-white font-bold" : "text-gray-700 hover:bg-gray-100"}
                ${hasEvent && !isToday ? "font-semibold" : ""}
              `}
            >
              {day}
              {hasEvent && (
                <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isToday ? "bg-white" : "bg-[#1f7a6c]"}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Event list for this month */}
      <div className="mt-4 border-t border-gray-100 pt-3 space-y-1.5">
        {Object.entries(meetingMap).map(([day, ms]) =>
          ms.map((m) => (
            <button
              key={m.id}
              onClick={() => onSelectMeeting(m)}
              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[#1f7a6c]/5 transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#1f7a6c] flex-shrink-0" />
              <span className="text-xs text-gray-700 truncate">{m.empName} — {m.type}</span>
            </button>
          ))
        )}
        {Object.keys(meetingMap).length === 0 && (
          <p className="text-xs text-gray-400 text-center py-2">No meetings this month</p>
        )}
      </div>
    </div>
  );
}

// ---------- Main Page ----------
export function MeetingSummary() {
  const [meetings, setMeetings] = useState([]);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isBriefLoading, setIsBriefLoading] = useState(false);
  const [briefNotice, setBriefNotice] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortMode, setSortMode] = useState("logical");
  const [isCalendarSyncing, setIsCalendarSyncing] = useState(false);
  const [isTranscriptSyncing, setIsTranscriptSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");

  function toMeetingMillis(meetingAt) {
    const text = String(meetingAt || "").trim();
    if (!text) return 0;

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const endOfDay = new Date(`${text}T23:59:59`);
      const ts = endOfDay.getTime();
      return Number.isFinite(ts) ? ts : 0;
    }

    const ts = new Date(text).getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  function getMeetingStatus(meetingAt) {
    const ts = toMeetingMillis(meetingAt);
    if (!ts) return "unknown";
    return ts >= Date.now() ? "upcoming" : "past";
  }

  const filteredMeetings = useMemo(() => {
    const rows = meetings
      .map((meeting) => ({
        ...meeting,
        status: getMeetingStatus(meeting.meetingAt),
      }))
      .filter((meeting) => {
        if (statusFilter !== "all" && meeting.status !== statusFilter) return false;
        if (sourceFilter !== "all" && meeting.source !== sourceFilter) return false;
        return true;
      });

    rows.sort((a, b) => {
      const aTs = toMeetingMillis(a.meetingAt);
      const bTs = toMeetingMillis(b.meetingAt);

      if (sortMode === "date-asc") {
        return aTs - bTs;
      }

      if (sortMode === "date-desc") {
        return bTs - aTs;
      }

      // Logical order: upcoming first (soonest first), then past (most recent first).
      const aUpcoming = a.status === "upcoming";
      const bUpcoming = b.status === "upcoming";
      if (aUpcoming && !bUpcoming) return -1;
      if (!aUpcoming && bUpcoming) return 1;
      if (aUpcoming && bUpcoming) return aTs - bTs;
      return bTs - aTs;
    });

    return rows;
  }, [meetings, sourceFilter, sortMode, statusFilter]);

  const meetingStats = useMemo(() => {
    const stats = { all: meetings.length, upcoming: 0, past: 0 };
    meetings.forEach((meeting) => {
      const status = getMeetingStatus(meeting.meetingAt);
      if (status === "upcoming") stats.upcoming += 1;
      if (status === "past") stats.past += 1;
    });
    return stats;
  }, [meetings]);

  useEffect(() => {
    let isMounted = true;

    function formatNameFromEmail(emailText) {
      const local = String(emailText || "").split("@")[0];
      if (!local) return "";
      return local
        .split(/[._-]/g)
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
        .join(" ");
    }

    function toDisplayDate(dateText) {
      const d = new Date(dateText);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }

    function toDisplayTime(dateText) {
      const d = new Date(dateText);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }

    function toSourceLabel(sourceText) {
      const source = String(sourceText || "").toLowerCase();
      if (source === "google_calendar") return "Google Calendar";
      return "Intelligence";
    }

    async function loadMeetings() {
      try {
        setIsLoading(true);
        setError("");

        let rows = [];
        try {
          const refreshed = await refreshGoogleCalendarMeetings({
            pastDays: 1,
            futureDays: 14,
            limit: 30,
          });
          rows = Array.isArray(refreshed?.data) ? refreshed.data : [];
        } catch (_refreshErr) {
          rows = [];
        }

        if (!rows.length) {
          rows = await listMeetings({ limit: 30 });
        }

        if (!isMounted) return;

        const mapped = rows
          .map((row) => {
            const at = row.meetingAt || "";
            const participantEmail = row.employeeEmail || row.participants?.[0] || "";

            return {
              id: row.meetingId,
              employeeEmail: participantEmail,
              empName: formatNameFromEmail(participantEmail),
              participants: Array.isArray(row.participants) ? row.participants : [],
              dept: "",
              meetingAt: at,
              date: at ? String(at).slice(0, 10) : "",
              displayDate: toDisplayDate(at),
              time: toDisplayTime(at),
              type: row.title || "",
              transcript: [],
              aiSummary: {
                topics: row.summary || "",
                concerns: "",
                career: "",
              },
              suggestions: [],
              brief: null,
              source: String(row.source || "llm").toLowerCase(),
              sourceLabel: toSourceLabel(row.source),
            };
          })
          .filter((row) => row.id);

        const seen = new Set();
        const deduped = mapped.filter((row) => {
          const key = `${String(row.employeeEmail || "").toLowerCase()}|${row.date}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        setMeetings(deduped);
        setSelectedMeeting(deduped[0] || null);
      } catch (err) {
        if (!isMounted) return;
        setMeetings([]);
        setSelectedMeeting(null);
        setError(err?.message || "Unable to load live meetings");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadMeetings();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!filteredMeetings.length) {
      setSelectedMeeting(null);
      return;
    }

    const stillVisible = selectedMeeting
      ? filteredMeetings.some((meeting) => meeting.id === selectedMeeting.id)
      : false;

    if (!stillVisible) {
      setSelectedMeeting(filteredMeetings[0]);
    }
  }, [filteredMeetings, selectedMeeting]);

  useEffect(() => {
    let isMounted = true;

    async function hydrateTranscript() {
      if (!selectedMeeting?.id) return;
      try {
        const details = await getMeetingTranscript(selectedMeeting.id);
        if (!isMounted) return;

        const transcriptLines = Array.isArray(details?.transcript)
          ? details.transcript.map((line) => ({
              speaker: line?.speaker || line?.role || "Participant",
              text: line?.text || line?.message || "",
            }))
          : [];

        setSelectedMeeting((prev) => ({
          ...prev,
          transcript: transcriptLines.length ? transcriptLines : prev.transcript,
          aiSummary: {
            topics: details?.summary || prev.aiSummary.topics,
            concerns: prev.aiSummary.concerns,
            career: prev.aiSummary.career,
          },
        }));
      } catch (_err) {
        // Keep current UI state when transcript endpoint is unavailable.
      }
    }

    hydrateTranscript();
    return () => {
      isMounted = false;
    };
  }, [selectedMeeting?.id]);

  useEffect(() => {
    let isMounted = true;

    function mapBriefToSummary(brief = {}) {
      const concerns = Array.isArray(brief?.handleCarefully) ? brief.handleCarefully.join(", ") : "";
      const career = Array.isArray(brief?.whatChangedSinceLastMeeting)
        ? brief.whatChangedSinceLastMeeting.join(", ")
        : "";

      return {
        topics: brief?.executiveSummary || "",
        concerns,
        career,
      };
    }

    function mapBriefSuggestions(brief = {}) {
      const starters = Array.isArray(brief?.conversationStarters) ? brief.conversationStarters : [];
      const followUps = Array.isArray(brief?.openFollowUps)
        ? brief.openFollowUps
            .map((item) => {
              const owner = String(item?.owner || "").trim();
              const task = String(item?.task || "").trim();
              if (!owner && !task) return "";
              return owner ? `${owner}: ${task}` : task;
            })
            .filter(Boolean)
        : [];

      return [...starters, ...followUps].slice(0, 6);
    }

    async function hydrateBrief() {
      if (!selectedMeeting?.employeeEmail) {
        setBriefNotice("");
        return;
      }

      const meetingId = selectedMeeting.id;
      setIsBriefLoading(true);
      setBriefNotice("");

      try {
        const participantEmails = Array.isArray(selectedMeeting?.participants)
          ? selectedMeeting.participants
              .map((item) => (typeof item === "string" ? item : item?.email || ""))
              .map((value) => String(value || "").trim().toLowerCase())
              .filter((value) => value.includes("@"))
          : [];

        const response = await getUpcomingBrief(
          selectedMeeting.employeeEmail,
          selectedMeeting.meetingAt || undefined,
          participantEmails
        );
        if (!isMounted) return;

        const brief = response?.brief || response?.data?.brief || null;
        const participantInsights = Array.isArray(response?.participantInsights)
          ? response.participantInsights
          : Array.isArray(response?.data?.participantInsights)
            ? response.data.participantInsights
            : [];
        const message = response?.message || response?.data?.message || "";
        const relationshipStatus =
          response?.relationshipStatus ||
          response?.data?.relationshipStatus ||
          brief?.relationshipStatus ||
          "";

        if (!brief) {
          setSelectedMeeting((prev) => {
            if (!prev || prev.id !== meetingId) return prev;
            return {
              ...prev,
              brief: {
                ...(prev.brief || {}),
                participantInsights,
              },
            };
          });
          setBriefNotice(message || "Brief generation was queued. Select this meeting again after a short delay.");
          return;
        }

        const mappedSummary = mapBriefToSummary(brief);
        const suggestions = mapBriefSuggestions(brief);

        setSelectedMeeting((prev) => {
          if (!prev || prev.id !== meetingId) return prev;
          return {
            ...prev,
            aiSummary: {
              topics: mappedSummary.topics || prev.aiSummary.topics,
              concerns: mappedSummary.concerns,
              career: mappedSummary.career,
            },
            suggestions,
            brief: {
              healthBand: brief?.healthBand || "",
              recommendedTone: brief?.recommendedTone || "",
              relationshipStatus,
              participantInsights,
            },
          };
        });
      } catch (_err) {
        if (!isMounted) return;
        setBriefNotice("Unable to fetch upcoming brief guidance right now.");
      } finally {
        if (isMounted) setIsBriefLoading(false);
      }
    }

    hydrateBrief();
    return () => {
      isMounted = false;
    };
  }, [selectedMeeting?.id, selectedMeeting?.employeeEmail, selectedMeeting?.meetingAt]);

  async function handleCalendarSync() {
    try {
      setIsCalendarSyncing(true);
      setSyncNotice("");
      setError("");

      const ingest = await syncCalendarEventsIngest({
        calendarId: "primary",
        pastDays: 1,
        futureDays: 14,
      });

      setSyncNotice(
        `Calendar sync completed. Stored ${Number(ingest?.eventsStored || 0)} events and updated ${Number(ingest?.participantsStored || 0)} participant links.`
      );
    } catch (err) {
      setSyncNotice(`Calendar sync failed: ${err?.message || "Unknown error"}`);
    } finally {
      setIsCalendarSyncing(false);
    }
  }

  async function handleTranscriptSync() {
    try {
      setIsTranscriptSyncing(true);
      setSyncNotice("");
      setError("");

      const ingest = await syncFirefliesTranscripts({
        syncHrToCalendar: true,
        limit: 100,
      });

      setSyncNotice(
        `Transcript sync completed. Processed ${Number(ingest?.transcriptsSeen || 0)} transcripts and updated ${Number(ingest?.meetingsUpserted || 0)} meetings.`
      );
    } catch (err) {
      setSyncNotice(`Transcript sync failed: ${err?.message || "Unknown error"}`);
    } finally {
      setIsTranscriptSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1f2937]">Meeting Summary</h1>
        <p className="text-gray-500 mt-1">
          Review AI-generated insights and transcripts from past conversations.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={handleCalendarSync}
            disabled={isCalendarSyncing || isTranscriptSyncing}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1f7a6c] text-white px-3 py-2 text-sm font-medium hover:bg-[#165a50] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isCalendarSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sync Calendar
          </button>

          <button
            onClick={handleTranscriptSync}
            disabled={isTranscriptSyncing || isCalendarSyncing}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0f766e] text-white px-3 py-2 text-sm font-medium hover:bg-[#115e59] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isTranscriptSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sync Transcripts
          </button>
        </div>
      </div>

      {syncNotice && (
        <div className="text-sm text-[#0f5132] bg-[#d1e7dd] border border-[#badbcc] px-4 py-2 rounded-lg">
          {syncNotice}
        </div>
      )}

      {error && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg">
          Live meeting service unavailable: {error}.
        </div>
      )}

      {isLoading && <div className="text-sm text-gray-500">Loading meetings...</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ minHeight: "600px" }}>
        {/* LEFT — Calendar + meeting list */}
        <div className="col-span-1 surface-card rounded-2xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-[#dbe5e8] bg-[linear-gradient(180deg,#f5fafb_0%,#edf5f7_100%)] font-semibold text-gray-700 flex items-center text-sm">
            <CalendarIcon className="w-4 h-4 mr-2 text-[#1f7a6c]" /> Calendar
          </div>
          <div className="px-4 pt-3 pb-2 border-b border-gray-100 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setStatusFilter("all")}
                className={`text-[11px] px-2 py-1 rounded-md font-medium ${
                  statusFilter === "all" ? "bg-[#1f7a6c] text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                All ({meetingStats.all})
              </button>
              <button
                onClick={() => setStatusFilter("upcoming")}
                className={`text-[11px] px-2 py-1 rounded-md font-medium ${
                  statusFilter === "upcoming" ? "bg-[#0f766e] text-white" : "bg-[#e6fffb] text-[#0f766e]"
                }`}
              >
                Upcoming ({meetingStats.upcoming})
              </button>
              <button
                onClick={() => setStatusFilter("past")}
                className={`text-[11px] px-2 py-1 rounded-md font-medium ${
                  statusFilter === "past" ? "bg-[#7c2d12] text-white" : "bg-[#fff7ed] text-[#7c2d12]"
                }`}
              >
                Past ({meetingStats.past})
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700"
              >
                <option value="all">All sources</option>
                <option value="google_calendar">Google Calendar</option>
                <option value="llm">Intelligence</option>
              </select>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700"
              >
                <option value="logical">Logical order</option>
                <option value="date-asc">Date ascending</option>
                <option value="date-desc">Date descending</option>
              </select>
            </div>
          </div>
          <div className="p-4">
            <MiniCalendar meetings={filteredMeetings} onSelectMeeting={setSelectedMeeting} />
          </div>

          {/* Scrollable meeting cards below the calendar */}
          <div className="border-t border-gray-100 overflow-y-auto flex-1 p-2 space-y-1.5">
            {filteredMeetings.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedMeeting(m)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  selectedMeeting?.id === m.id
                    ? "border-[#1f7a6c] bg-[#1f7a6c]/5"
                    : "border-transparent hover:border-gray-200 hover:bg-gray-50"
                }`}
              >
                <div className="text-sm font-semibold text-[#1f2937]">{m.empName}</div>
                <div className="text-xs text-gray-400 mt-0.5 flex items-center">
                  <Clock className="w-3 h-3 mr-1" /> {m.displayDate} · {m.time}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <div
                    className={`inline-flex text-[10px] px-2 py-0.5 rounded font-semibold ${
                      m.status === "upcoming" ? "bg-[#e6fffb] text-[#0f766e]" : "bg-[#fff7ed] text-[#7c2d12]"
                    }`}
                  >
                    {m.status === "upcoming" ? "Upcoming" : "Past"}
                  </div>
                  <div className="inline-flex bg-gray-100 text-gray-700 text-[10px] px-2 py-0.5 rounded font-medium">
                    {m.type}
                  </div>
                  <div
                    className={`inline-flex text-[10px] px-2 py-0.5 rounded font-medium ${
                      m.source === "google_calendar"
                        ? "bg-[#d9f0ff] text-[#0c4a6e]"
                        : "bg-[#e8f7f1] text-[#165a50]"
                    }`}
                  >
                    {m.sourceLabel}
                  </div>
                </div>
              </button>
            ))}
            {filteredMeetings.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-gray-500">No meetings available.</div>
            )}
          </div>
        </div>

        {/* RIGHT — Details panel */}
        <div className="col-span-1 lg:col-span-2 surface-card rounded-2xl flex flex-col overflow-hidden">
          {!selectedMeeting ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-500 p-6">
              Select a meeting to view transcript and insights.
            </div>
          ) : (
            <AnimatePresence mode="wait">
            <motion.div
              key={selectedMeeting.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.24 }}
              className="h-full"
            >
          {/* Meeting header */}
          <div className="p-6 border-b border-[#dbe5e8] bg-[linear-gradient(180deg,#f5fafb_0%,#edf5f7_100%)]">
            <h2 className="text-lg font-bold text-[#1f2937]">
              {selectedMeeting.empName} — {selectedMeeting.type}
            </h2>
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex text-[11px] px-2.5 py-1 rounded-md font-semibold ${
                    selectedMeeting.source === "google_calendar"
                      ? "bg-[#d9f0ff] text-[#0c4a6e]"
                      : "bg-[#e8f7f1] text-[#165a50]"
                  }`}
                >
                  Source: {selectedMeeting.sourceLabel || "Intelligence"}
                </span>
                <span
                  className={`inline-flex text-[11px] px-2.5 py-1 rounded-md font-semibold ${
                    getMeetingStatus(selectedMeeting.meetingAt) === "upcoming"
                      ? "bg-[#e6fffb] text-[#0f766e]"
                      : "bg-[#fff7ed] text-[#7c2d12]"
                  }`}
                >
                  {getMeetingStatus(selectedMeeting.meetingAt) === "upcoming" ? "Upcoming" : "Past"}
                </span>
              </div>
            </div>
            <div className="flex gap-4 mt-1 text-gray-500 text-sm">
              <span className="flex items-center"><Users className="w-4 h-4 mr-1" />{selectedMeeting.dept}</span>
              <span className="flex items-center"><CalendarIcon className="w-4 h-4 mr-1" />{selectedMeeting.displayDate} · {selectedMeeting.time}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {/* AI Summary */}
            <section className="bg-[linear-gradient(180deg,#f7fbfc_0%,#eef6f4_100%)] p-5 rounded-xl border border-[#dbe5e8]">
              <h3 className="text-sm font-bold text-[#1f2937] mb-3 flex items-center">
                <Lightbulb className="w-4 h-4 text-[#f59e0b] mr-2" /> AI Summary Insights
              </h3>

              {isBriefLoading && (
                <div className="mb-3 inline-flex items-center gap-2 text-xs text-[#1f7a6c] bg-[#1f7a6c]/10 border border-[#1f7a6c]/20 rounded-md px-2 py-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing meeting brief guidance...
                </div>
              )}

              {briefNotice && (
                <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  {briefNotice}
                </div>
              )}

              {selectedMeeting.brief && (
                <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
                    <div className="text-gray-500">Health Band</div>
                    <div className="font-semibold text-[#1f2937]">{selectedMeeting.brief.healthBand || "Unknown"}</div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
                    <div className="text-gray-500">Recommended Tone</div>
                    <div className="font-semibold text-[#1f2937]">{selectedMeeting.brief.recommendedTone || "Supportive"}</div>
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <div className="text-amber-700 inline-flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" /> Relationship Status</div>
                    <div className="font-semibold text-amber-800">{selectedMeeting.brief.relationshipStatus || "Stable"}</div>
                  </div>
                </div>
              )}

              {Array.isArray(selectedMeeting?.brief?.participantInsights) && selectedMeeting.brief.participantInsights.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                    Participant AI + Past Meeting Insights
                  </h4>
                  <div className="space-y-2">
                    {selectedMeeting.brief.participantInsights.map((insight, idx) => {
                      const recentMeetings = Array.isArray(insight?.pastMeetingInsights?.recentMeetings)
                        ? insight.pastMeetingInsights.recentMeetings
                        : [];

                      return (
                        <div key={insight?.employeeEmail || `participant-${idx}`} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <span className="font-semibold text-[#1f2937]">{insight?.employeeEmail || "Unknown"}</span>
                            <span className="text-gray-500">Health: {insight?.profileAnalysis?.healthScore ?? "-"}</span>
                            <span className="text-gray-500">Risk: {insight?.profileAnalysis?.riskLevel || "-"}</span>
                            <span className="text-gray-500">Sentiment: {insight?.profileAnalysis?.sentimentScore ?? "-"}</span>
                            <span className="text-gray-500">
                              Past meetings: {insight?.pastMeetingInsights?.totalPastMeetings ?? 0}
                            </span>
                          </div>
                          {recentMeetings.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-gray-600 list-disc pl-4">
                              {recentMeetings.map((meeting) => (
                                <li key={meeting?.meetingId || `${insight?.employeeEmail}-${meeting?.meetingAt}`}>
                                  {meeting?.meetingAt ? `${meeting.meetingAt} - ` : ""}
                                  {meeting?.summary || meeting?.title || "Past meeting summary unavailable"}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <ul className="space-y-3">
                {[
                  ["Topics",   selectedMeeting.aiSummary.topics],
                  ["Concerns", selectedMeeting.aiSummary.concerns],
                  ["Career",   selectedMeeting.aiSummary.career],
                ].map(([label, text]) => (
                  <li key={label} className="flex items-start text-sm text-gray-700">
                    <span className="block w-20 flex-shrink-0 font-semibold text-gray-900">{label}</span>
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Follow-up suggestions */}
            <section>
              <h3 className="text-sm font-bold text-[#1f2937] mb-3 flex items-center">
                <CheckCircle2 className="w-4 h-4 text-[#1f7a6c] mr-2" /> Recommended Follow-up Questions
              </h3>
              <div className="space-y-2">
                {selectedMeeting.suggestions.map((q, i) => (
                  <div
                    key={i}
                    className="flex items-start p-3 bg-[#1f7a6c]/5 border border-[#1f7a6c]/20 rounded-lg text-sm text-[#165a50]"
                  >
                    <ArrowRight className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                    &ldquo;{q}&rdquo;
                  </div>
                ))}
                {selectedMeeting.suggestions.length === 0 && (
                  <div className="text-sm text-gray-500">No follow-up suggestions available.</div>
                )}
              </div>
            </section>

            {/* Transcript */}
            <section>
              <h3 className="text-sm font-bold text-gray-700 mb-3">Meeting Transcript</h3>
              <div className="h-64 overflow-y-auto bg-gray-50 border border-gray-200 rounded-lg p-4 font-mono text-sm text-gray-600 space-y-4">
                {selectedMeeting.transcript.map((line, i) => (
                  <p key={i}>
                    <span className={`font-bold pr-2 ${line.speaker === "HR" ? "text-[#1f7a6c]" : "text-gray-800"}`}>
                      {line.speaker}:
                    </span>
                    {line.text}
                  </p>
                ))}
                {selectedMeeting.transcript.length === 0 ? (
                  <p className="italic text-center text-gray-400 mt-4">No transcript available.</p>
                ) : (
                  <p className="italic text-center text-gray-400 mt-4">End of transcript</p>
                )}
              </div>
            </section>
          </div>
            </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
