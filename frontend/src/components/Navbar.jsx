import { Link, useLocation } from "react-router-dom";
import { Search, Bell, User, LogOut, Menu, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";

// Nav items shown in the app shell (non-landing pages)
const APP_NAV_ITEMS = [
  { name: "Dashboard",       path: "/dashboard"       },
  { name: "Employees",       path: "/employees"       },
  { name: "AI Insights",     path: "/ai-insights"     },
  { name: "Chatbot",         path: "/chatbot"         },
  { name: "Meeting Summary", path: "/meeting-summary" },
];

// Nav items shown on the landing page — Dashboard is intentionally excluded
const LANDING_NAV_ITEMS = [
  { name: "Employees",       path: "/employees"       },
  { name: "AI Insights",     path: "/ai-insights"     },
  { name: "Chatbot",         path: "/chatbot"         },
  { name: "Meeting Summary", path: "/meeting-summary" },
];

function useOutsideClick(ref, callback) {
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) callback();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, callback]);
}

export function Navbar() {
  const location  = useLocation();
  const isLanding = location.pathname === "/";

  const [notifications] = useState([]);
  const [currentUser, setCurrentUser] = useState({ name: "", email: "" });
  const [isAvatarOpen,   setIsAvatarOpen]   = useState(false);
  const [isNotifOpen,    setIsNotifOpen]    = useState(false);
  const [hasUnread,      setHasUnread]      = useState(false);
  const [isMobileOpen,   setIsMobileOpen]   = useState(false);

  const avatarRef = useRef(null);
  const notifRef  = useRef(null);

  useOutsideClick(avatarRef, () => setIsAvatarOpen(false));
  useOutsideClick(notifRef,  () => setIsNotifOpen(false));

  useEffect(() => {
    try {
      const name = window.localStorage.getItem("userName") || "";
      const email = window.localStorage.getItem("userEmail") || "";
      setCurrentUser({ name, email });
    } catch (_err) {
      setCurrentUser({ name: "", email: "" });
    }
  }, []);

  const avatarText = currentUser.name
    ? currentUser.name
        .split(" ")
        .map((part) => part[0] || "")
        .join("")
        .toUpperCase()
    : "";

  // Toggle notification panel; clear dot as soon as it opens
  function handleNotifToggle() {
    const willOpen = !isNotifOpen;
    setIsNotifOpen(willOpen);
    setIsAvatarOpen(false);
    if (willOpen) setHasUnread(false); // notifications seen → clear dot
  }

  const navItems  = isLanding ? LANDING_NAV_ITEMS : APP_NAV_ITEMS;

  const navBg      = isLanding ? "app-navbar-panel border-b border-black/5" : "app-navbar-panel border-b border-[#d7e3e6]";
  const logoColor  = isLanding ? "text-[#0f0f0f]" : "text-[#0f766e]";
  const mutedColor = isLanding ? "text-gray-400"   : "text-[#64748b]";

  const activeLink   = isLanding
    ? "bg-black/5 text-[#0f0f0f] font-semibold shadow-sm"
    : "bg-[#0f766e]/12 text-[#0f766e] font-semibold shadow-sm border border-[#0f766e]/15";
  const inactiveLink = isLanding
    ? "text-gray-600 hover:bg-black/5 hover:text-[#0f0f0f]"
    : "text-[#1f2937] hover:bg-white hover:text-[#0a5f59]";

  const dropdownBg = "bg-white/95 backdrop-blur-xl border border-[#d7e3e6] shadow-[0_16px_34px_rgba(23,32,51,0.14)]";

  return (
    <>
      <nav className={`app-navbar fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-6 py-3 transition-colors duration-300 ${navBg}`}>

        {/* ── Left: Logo + Nav links ── */}
        <div className="flex items-center gap-6">
          <Link
            to="/"
            className={`flex items-center gap-2 text-xl font-bold tracking-tight hover:opacity-80 transition-opacity ${logoColor}`}
            style={{ fontFamily: "var(--font-serif)" }}
          >
            <img
              src="/assets/logo.png"
              alt="SAHAY"
              className="h-7 w-auto object-contain"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
            <span>SAHAY</span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1.5 rounded-full p-1 bg-white/70 border border-[#d7e3e6]">
            {navItems.map((item) => (
              <Link
                key={item.name}
                to={item.path}
                className={`px-3 py-2 text-sm rounded-full transition-colors duration-150 ${
                  location.pathname === item.path ? activeLink : inactiveLink
                }`}
              >
                {item.name}
              </Link>
            ))}

            {/* Landing page: show Login link instead of auth-not-needed links */}
            {isLanding && (
              <Link
                to="/login"
                className={`px-3 py-2 text-sm rounded-full transition-colors duration-150 ${inactiveLink}`}
              >
                Login
              </Link>
            )}
          </div>
        </div>

        {/* ── Right: Search + Notifs + Avatar ── */}
        <div className="flex items-center gap-3">

          {/* Search — always shown on landing since bg is light */}
          <div className="relative hidden md:block">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${mutedColor}`} />
            <input
              type="text"
              placeholder="Search..."
              className="pl-9 pr-4 py-2 text-sm rounded-full border border-[#d7e3e6] bg-white/85 text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0f766e]/30 focus:border-[#0f766e] hover:bg-white transition-colors"
            />
          </div>

          {/* Notification Bell */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={handleNotifToggle}
              className="relative p-2 rounded-full transition-colors text-gray-500 hover:text-[#d97706] hover:bg-[#d97706]/10"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {/* Red dot — only shows when hasUnread is true */}
              {hasUnread && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
              )}
            </button>

            <AnimatePresence>
              {isNotifOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className={`absolute right-0 mt-2 w-80 rounded-xl overflow-hidden ${dropdownBg}`}
              >
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">Notifications</span>
                  <span className="text-xs text-gray-400">{notifications.length} notifications</span>
                </div>
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors last:border-0"
                  >
                    <p className={`text-sm font-medium ${
                      n.type === "alert" ? "text-red-600" : n.type === "success" ? "text-[#1f7a6c]" : "text-gray-800"
                    }`}>
                      {n.text}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{n.time}</p>
                  </div>
                ))}
                {notifications.length === 0 && (
                  <div className="px-4 py-6 text-sm text-gray-500 text-center">No notifications available.</div>
                )}
                <div className="px-4 py-2 bg-gray-50 text-center">
                  <button className="text-xs text-[#1f7a6c] hover:underline font-medium">
                    View all notifications
                  </button>
                </div>
              </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Avatar */}
          <div className="relative" ref={avatarRef}>
            <button
              onClick={() => { setIsAvatarOpen(!isAvatarOpen); setIsNotifOpen(false); }}
              className="p-0.5 rounded-full border-2 transition-colors border-[#d7e3e6] hover:border-[#0f766e] bg-white"
              aria-label="User menu"
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center font-medium text-sm bg-[#0f766e]/10 text-[#0f766e]">
                {avatarText}
              </div>
            </button>

            <AnimatePresence>
              {isAvatarOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className={`absolute right-0 mt-2 w-48 rounded-xl overflow-hidden ${dropdownBg}`}
              >
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800">{currentUser.name}</p>
                  <p className="text-xs text-gray-400 truncate">{currentUser.email}</p>
                </div>
                <Link
                  to="/profile"
                  onClick={() => setIsAvatarOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <User className="w-4 h-4" /> Profile
                </Link>
                <Link
                  to="/login"
                  onClick={() => setIsAvatarOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-4 h-4" /> Logout
                </Link>
              </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 rounded-full transition-colors text-gray-500 hover:bg-white"
            onClick={() => setIsMobileOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </nav>

      {/* ── Mobile Slide-in Menu ── */}
      <AnimatePresence>
      {isMobileOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setIsMobileOpen(false)}
          />
          <motion.div
            initial={{ x: 280 }}
            animate={{ x: 0 }}
            exit={{ x: 280 }}
            transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.9 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-64 bg-white shadow-2xl flex flex-col border-l border-[#d7e3e6]"
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
              <span className="text-lg font-bold text-[#0f766e]" style={{ fontFamily: "var(--font-serif)" }}>SAHAY</span>
              <button onClick={() => setIsMobileOpen(false)} className="p-1 text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col p-4 space-y-1 flex-1">
              {navItems.map((item) => (
                <Link
                  key={item.name}
                  to={item.path}
                  onClick={() => setIsMobileOpen(false)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname === item.path
                      ? "bg-[#1f7a6c]/10 text-[#1f7a6c]"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {item.name}
                </Link>
              ))}
              {isLanding && (
                <Link
                  to="/login"
                  onClick={() => setIsMobileOpen(false)}
                  className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Login
                </Link>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 space-y-2">
              <Link to="/profile" onClick={() => setIsMobileOpen(false)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
                <User className="w-4 h-4" /> Profile
              </Link>
              <Link to="/login" onClick={() => setIsMobileOpen(false)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-red-600 hover:bg-red-50">
                <LogOut className="w-4 h-4" /> Logout
              </Link>
            </div>
          </motion.div>
        </>
      )}
      </AnimatePresence>
    </>
  );
}
