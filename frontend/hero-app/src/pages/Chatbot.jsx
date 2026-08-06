import { useEffect, useState } from "react";
import { Send, Bot, User, Menu, Loader2, Filter, FileText, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  createChatSession,
  deleteChatSession,
  getChatSessionHistory,
  listChatSessions,
  sendChatQuery,
} from "../lib/api";

const CHATBOT_STORAGE_KEY = "hrx.chatbot.state.v2";

const DEFAULT_MESSAGES = [
  {
    id: "welcome",
    sender: "bot",
    text: "Hello! I'm your HR Intelligence Assistant. Ask about retention risk, sentiment, or specific employees.",
    transcriptCards: [],
    filters: {},
    count: 0,
  },
];

function mapSessionMessagesToUi(rows = []) {
  return rows
    .map((row) => {
      const role = String(row?.role || "assistant").toLowerCase();
      const text = String(row?.content || "").trim();
      if (!text) return null;

      const sender = role === "user" ? "user" : "bot";
      const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};

      return {
        id: `db-${String(row?.messageIndex ?? "")}-${String(row?.createdAt || "")}`,
        sender,
        text,
        transcriptCards: sender === "bot" && Array.isArray(metadata.transcriptCards) ? metadata.transcriptCards : [],
        filters: sender === "bot" && metadata.filters && typeof metadata.filters === "object" ? metadata.filters : {},
        count: sender === "bot" ? Number(metadata.count || 0) : 0,
      };
    })
    .filter(Boolean);
}

function toSessionTitle(session, fallback = "New chat") {
  const explicit = String(session?.title || "").trim();
  if (explicit) {
    return explicit;
  }
  return fallback;
}

function firstUserPromptFromHistory(rows = []) {
  const firstUser = rows.find((row) => String(row?.role || "").toLowerCase() === "user");
  const text = String(firstUser?.content || "").trim();
  return text || "";
}

export function Chatbot() {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState(DEFAULT_MESSAGES);

  useEffect(() => {
    let isMounted = true;

    async function hydrateFromDb() {
      let parsed = null;
      try {
        const raw = window.localStorage.getItem(CHATBOT_STORAGE_KEY);
        parsed = raw ? JSON.parse(raw) : null;
      } catch (_err) {
        parsed = null;
      }

      const cachedMessages = Array.isArray(parsed?.messages) ? parsed.messages : [];
      const cachedSessionId = String(parsed?.sessionId || "").trim();

      if (cachedMessages.length > 0) {
        setMessages(cachedMessages);
      }
      if (cachedSessionId) {
        setSessionId(cachedSessionId);
      }

      try {
        const listed = await listChatSessions({ limit: 50 }).catch(() => []);
        if (!isMounted) return;

        const normalizedSessions = Array.isArray(listed)
          ? listed.map((row) => ({
              sessionId: String(row?.sessionId || "").trim(),
              title: toSessionTitle(row),
              lastMessageAt: row?.lastMessageAt || row?.startedAt || "",
              startedAt: row?.startedAt || "",
            })).filter((row) => row.sessionId)
          : [];

        if (normalizedSessions.length > 0) {
          setSessions(normalizedSessions);
        }

        let activeSessionId = cachedSessionId;
        if (
          !activeSessionId ||
          (normalizedSessions.length > 0 && !normalizedSessions.some((row) => row.sessionId === activeSessionId))
        ) {
          activeSessionId = normalizedSessions[0]?.sessionId || "";
        }
        if (!activeSessionId) {
          const created = await createChatSession();
          activeSessionId = String(created?.sessionId || "").trim();
          if (activeSessionId) {
            const createdTitle = toSessionTitle(created);
            setSessions((prev) => [{
              sessionId: activeSessionId,
              title: createdTitle,
              lastMessageAt: created?.lastMessageAt || created?.startedAt || new Date().toISOString(),
              startedAt: created?.startedAt || new Date().toISOString(),
            }, ...prev.filter((row) => row.sessionId !== activeSessionId)]);
          }
        }

        if (!isMounted) return;
        if (activeSessionId) {
          setSessionId(activeSessionId);

          const historyPayload = await getChatSessionHistory(activeSessionId, 180);
          if (!isMounted) return;

          const historyRows = Array.isArray(historyPayload?.data) ? historyPayload.data : [];
          const restoredMessages = mapSessionMessagesToUi(historyRows);
          if (restoredMessages.length > 0) {
            setMessages(restoredMessages);
            const fallbackTitle = firstUserPromptFromHistory(historyRows) || "Current chat";
            setSessions((prev) => prev.map((row) =>
              row.sessionId === activeSessionId && (!row.title || row.title === "New chat")
                ? { ...row, title: fallbackTitle }
                : row
            ));
          } else if (cachedMessages.length === 0) {
            setMessages(DEFAULT_MESSAGES);
          }
        }
      } catch (_err) {
        if (!isMounted) return;
        if (cachedMessages.length === 0) {
          setMessages(DEFAULT_MESSAGES);
        }
      } finally {
        if (isMounted) {
          setIsHydrating(false);
        }
      }
    }

    hydrateFromDb();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CHATBOT_STORAGE_KEY,
        JSON.stringify({
          sessionId,
          messages: messages.slice(-60),
        })
      );
    } catch (_err) {
      // Ignore storage quota or access errors.
    }
  }, [messages, sessionId]);

  const CHRO_TEMPLATE_INPUTS = [
    {
      title: "Top Attrition Risk",
      prompt: "Show me employees with critical retention risk and top reasons.",
    },
    {
      title: "Sentiment Drop Alerts",
      prompt: "Which employees had the biggest sentiment drop in the last 30 days?",
    },
    {
      title: "Today 1:1 Brief",
      prompt: "Generate a pre-meeting brief for today's 1:1s with high-risk employees.",
    },
    {
      title: "Open Commitments",
      prompt: "List unresolved commitments from previous HR check-ins.",
    },
    {
      title: "Manager Conflict Signals",
      prompt: "Who has repeated signals of manager conflict and what evidence supports it?",
    },
    {
      title: "Recognition Opportunities",
      prompt: "Which employees are thriving and should be recognized this week?",
    },
    {
      title: "Flight Risk Summary",
      prompt: "Summarize flight-risk employees by department with urgency levels.",
    },
    {
      title: "Workload Burnout",
      prompt: "Who is showing sustained workload or burnout concerns over the last 3 weeks?",
    },
  ];

  function formatFilterLabel(value) {
    return String(value || "")
      .replace(/([A-Z])/g, " $1")
      .replace(/[_.-]+/g, " ")
      .trim()
      .replace(/^./, (char) => char.toUpperCase());
  }

  function formatFilterValue(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).join(", ");
    }
    if (typeof value === "object") {
      if (typeof value.$regex === "string") {
        return value.$regex;
      }
      return Object.entries(value)
        .map(([key, item]) => `${key}: ${String(item)}`)
        .join(", ");
    }
    return String(value);
  }

  const handleSend = async (overrideText) => {
    const nextInput = typeof overrideText === "string" ? overrideText.trim() : input.trim();
    if (!nextInput) return;
    if (nextInput.length < 3) {
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text: "Please enter at least 3 characters so I can process your request.",
          transcriptCards: [],
          filters: {},
          count: 0,
        },
      ].slice(-60));
      return;
    }
    if (isSending || isHydrating) return;
    setIsSending(true);

    let activeSessionId = String(sessionId || "").trim();
    if (!activeSessionId) {
      try {
        const created = await createChatSession();
        activeSessionId = String(created?.sessionId || "").trim();
        if (activeSessionId) {
          setSessionId(activeSessionId);
        }
      } catch (_err) {
        // Continue; server can still allocate session ID on query.
      }
    }
    
    // Add user message
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        sender: "user",
        text: nextInput,
        transcriptCards: [],
        filters: {},
        count: 0,
      },
    ].slice(-60));
    setSessions((prev) => {
      const current = Array.isArray(prev) ? [...prev] : [];
      const idx = current.findIndex((item) => item.sessionId === activeSessionId);
      const now = new Date().toISOString();
      const next = {
        sessionId: activeSessionId,
        title: idx >= 0 ? current[idx].title : nextInput,
        lastMessageAt: now,
      };

      if (idx >= 0) {
        current.splice(idx, 1);
      }

      return [next, ...current].slice(0, 50);
    });
    setInput("");

    try {
      const result = await sendChatQuery(nextInput, { sessionId: activeSessionId });
      if (result?.sessionId && String(result.sessionId).trim() && result.sessionId !== activeSessionId) {
        setSessionId(String(result.sessionId).trim());
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text: result.answer || "I could not generate a response for that request.",
          transcriptCards: Array.isArray(result.transcriptCards) ? result.transcriptCards : [],
          filters: result.filters && typeof result.filters === "object" ? result.filters : {},
          count: Number(result.count || 0),
        },
      ].slice(-60));
    } catch (err) {
      const status = Number(err?.status || 0);
      const message = String(err?.message || "Request could not be completed.");
      const code = String(err?.code || "").toLowerCase();
      const isBackendUnavailable =
        status >= 500 || /unavailable|timeout|upstream|network/.test(code);

      let botText = "I could not process that request right now. Please try again shortly.";
      if (status === 400) {
        botText = `Your request needs adjustment: ${message}`;
      } else if (isBackendUnavailable) {
        botText =
          "The intelligence backend is currently unavailable. Please verify backend and LLM services are running, then try again.";
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text: botText,
          transcriptCards: [],
          filters: {},
          count: 0,
        },
      ].slice(-60));
    } finally {
      setIsSending(false);
    }
  };

  const handleSelectSession = async (nextSessionId) => {
    const key = String(nextSessionId || "").trim();
    if (!key || key === sessionId || isHydrating || isSending) return;

    setIsHydrating(true);
    setSessionId(key);
    setInput("");

    try {
      const historyPayload = await getChatSessionHistory(key, 180);
      const historyRows = Array.isArray(historyPayload?.data) ? historyPayload.data : [];
      const restoredMessages = mapSessionMessagesToUi(historyRows);
      setMessages(restoredMessages.length > 0 ? restoredMessages : DEFAULT_MESSAGES);

      const fallbackTitle = firstUserPromptFromHistory(historyRows) || "Current chat";
      setSessions((prev) => prev.map((row) =>
        row.sessionId === key && (!row.title || row.title === "New chat")
          ? { ...row, title: fallbackTitle }
          : row
      ));
    } catch (_err) {
      setMessages(DEFAULT_MESSAGES);
    } finally {
      setIsHydrating(false);
    }
  };

  const handleCreateNewChat = async () => {
    if (isHydrating || isSending) return;

    setIsHydrating(true);
    setInput("");

    try {
      const created = await createChatSession();
      const createdSessionId = String(created?.sessionId || "").trim();
      if (!createdSessionId) {
        return;
      }

      setSessionId(createdSessionId);
      setMessages(DEFAULT_MESSAGES);
      setSessions((prev) => [
        {
          sessionId: createdSessionId,
          title: toSessionTitle(created),
          lastMessageAt: created?.lastMessageAt || created?.startedAt || new Date().toISOString(),
          startedAt: created?.startedAt || new Date().toISOString(),
        },
        ...prev.filter((row) => row.sessionId !== createdSessionId),
      ].slice(0, 50));
    } finally {
      setIsHydrating(false);
    }
  };

  const handleDeleteSession = async (targetSessionId) => {
    const key = String(targetSessionId || "").trim();
    if (!key || isHydrating || isSending) return;

    const ok = window.confirm("Delete this chat session?");
    if (!ok) return;

    setIsHydrating(true);

    try {
      await deleteChatSession(key);
      const nextSessions = sessions.filter((item) => item.sessionId !== key);
      setSessions(nextSessions);

      if (sessionId === key) {
        const replacement = nextSessions[0]?.sessionId || "";
        if (replacement) {
          await handleSelectSession(replacement);
        } else {
          const created = await createChatSession();
          const createdSessionId = String(created?.sessionId || "").trim();
          if (createdSessionId) {
            setSessionId(createdSessionId);
            setMessages(DEFAULT_MESSAGES);
            setSessions([
              {
                sessionId: createdSessionId,
                title: toSessionTitle(created),
                lastMessageAt: created?.lastMessageAt || created?.startedAt || new Date().toISOString(),
                startedAt: created?.startedAt || new Date().toISOString(),
              },
            ]);
          }
        }
      }
    } catch (_err) {
      // Ignore delete errors and preserve current UI state.
    } finally {
      setIsHydrating(false);
    }
  };

  const runTemplatePrompt = (text) => {
    const nextText = String(text || "").trim();
    if (!nextText || isSending || isHydrating) return;
    setInput(nextText);
    handleSend(nextText);
  };

  return (
    <div className="surface-card flex h-[calc(100vh-140px)] rounded-2xl overflow-hidden">
      
      {/* Left Panel - History */}
      <div className="hidden md:flex flex-col w-64 border-r border-[#dbe5e8] bg-[linear-gradient(180deg,#f7fbfc_0%,#eef5f7_100%)] p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center">
            <Menu className="w-4 h-4 mr-2" /> Chats
          </h2>
          <button
            type="button"
            onClick={handleCreateNewChat}
            disabled={isSending || isHydrating}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-[#1f7a6c]/30 text-[#1f7a6c] hover:bg-white disabled:opacity-60"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>
        <div className="space-y-2 overflow-y-auto">
          {sessions.map((chat) => (
            <div
              key={chat.sessionId}
              className={`group w-full flex items-center gap-1 rounded-md border transition-all ${
                chat.sessionId === sessionId
                  ? "bg-white border-[#1f7a6c]/30 shadow-sm"
                  : "border-transparent hover:border-gray-200"
              }`}
            >
              <button
                type="button"
                onClick={() => handleSelectSession(chat.sessionId)}
                className="flex-1 text-left px-3 py-2 text-sm text-gray-700 truncate"
                title={chat.title}
              >
                {chat.title}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDeleteSession(chat.sessionId);
                }}
                className="mr-1 p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete chat"
                aria-label="Delete chat"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {sessions.length === 0 && (
            <div className="text-xs text-gray-500 px-1">No chats yet. Start a new one.</div>
          )}
        </div>
      </div>

      {/* Main Panel - Conversation */}
      <div className="flex flex-col flex-1 bg-white relative">
        <div className="p-4 border-b border-[#dbe5e8] flex items-center bg-white/90 backdrop-blur-sm z-10">
          <Bot className="w-6 h-6 text-[#1f7a6c] mr-2" />
          <h1 className="text-lg font-bold text-[#1f2937]">HR AI Assistant</h1>
        </div>

        {/* Conversation messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {isHydrating && (
            <div className="text-xs text-[#64748b]">Restoring chat history...</div>
          )}

          <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={msg.id || i}
              layout
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22 }}
              className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex gap-3 max-w-[80%] ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.sender === 'user' ? 'bg-[#1f7a6c] text-white' : 'bg-gray-200 text-[#1f7a6c]'}`}>
                  {msg.sender === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                </div>
                <div className="space-y-2">
                  <div className={`p-4 rounded-2xl text-sm ${msg.sender === 'user' ? 'bg-[#1f7a6c] text-white rounded-tr-none' : 'bg-gray-100 text-gray-800 rounded-tl-none'}`}>
                    {msg.text}
                  </div>

                  {msg.sender === "bot" && msg.count > 0 && (
                    <div className="text-xs text-gray-500 px-1">Matched profiles: {msg.count}</div>
                  )}

                  {msg.sender === "bot" && Object.keys(msg.filters || {}).length > 0 && (
                    <div className="flex flex-wrap gap-2 px-1">
                      <div className="inline-flex items-center text-[11px] font-medium text-gray-500">
                        <Filter className="w-3 h-3 mr-1" /> Applied Filters
                      </div>
                      {Object.entries(msg.filters).map(([key, value]) => (
                        <span key={`${key}-${formatFilterValue(value)}`} className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#1f7a6c]/10 text-[#165a50] text-[11px] border border-[#1f7a6c]/20">
                          {formatFilterLabel(key)}: {formatFilterValue(value)}
                        </span>
                      ))}
                    </div>
                  )}

                  {msg.sender === "bot" && Array.isArray(msg.transcriptCards) && msg.transcriptCards.length > 0 && (
                    <div className="space-y-2">
                      {msg.transcriptCards.slice(0, 3).map((card, index) => (
                        <div key={`${card.employeeEmail || card.employeeName || "card"}-${index}`} className="p-3 rounded-xl border border-gray-200 bg-white text-xs text-gray-700 shadow-sm">
                          <div className="font-semibold text-[#1f2937] flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5 text-[#1f7a6c]" />
                            {card.employeeName || "Employee"}
                            {card.employeeEmail ? <span className="text-gray-400 font-normal">({card.employeeEmail})</span> : null}
                          </div>
                          <p className="mt-1 text-gray-600">{card.summary || "No summary available."}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
          </AnimatePresence>

          <AnimatePresence>
          {isSending && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex justify-start"
            >
              <div className="flex gap-3 max-w-[80%]">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gray-200 text-[#1f7a6c]">
                  <Bot className="w-5 h-5" />
                </div>
                <motion.div
                  animate={{ opacity: [0.65, 1, 0.65] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                  className="p-3 rounded-2xl rounded-tl-none bg-gray-100 text-gray-700 text-sm inline-flex items-center gap-2"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Thinking...
                </motion.div>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        </div>

        {/* Bottom Panel - Input & Suggestions */}
        <div className="p-4 bg-white border-t border-gray-200">
          {CHRO_TEMPLATE_INPUTS.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4 justify-center">
              {CHRO_TEMPLATE_INPUTS.map(({ title, prompt }, i) => (
                <motion.button 
                  key={i} 
                  className="px-3 py-2 text-left text-xs text-[#1f7a6c] bg-[#1f7a6c]/10 hover:bg-[#1f7a6c]/20 rounded-full transition-colors border border-[#1f7a6c]/20"
                  onClick={() => runTemplatePrompt(prompt)}
                  whileHover={{ y: -1, scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="block font-semibold leading-none">{title}</span>
                  <span className="block text-[10px] text-[#165a50]/80 mt-0.5 leading-tight">{prompt}</span>
                </motion.button>
              ))}
            </div>
          )}

          <div className="relative flex items-center max-w-4xl mx-auto">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={isHydrating ? "Restoring chat session..." : "Ask anything about your workforce..."}
              disabled={isSending || isHydrating}
              className="w-full pl-4 pr-12 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1f7a6c]/50 focus:border-[#1f7a6c]"
            />
            <button 
              onClick={handleSend}
              disabled={isSending || isHydrating}
              className="absolute right-2 p-1.5 bg-[#1f7a6c] text-white rounded-lg hover:bg-[#165a50] transition-colors disabled:opacity-70"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
