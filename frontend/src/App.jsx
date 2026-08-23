import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { Employees } from "./pages/Employees";
import { EmployeeProfile } from "./pages/EmployeeProfile";
import { Chatbot } from "./pages/Chatbot";
import { MeetingSummary } from "./pages/MeetingSummary";
import { Profile } from "./pages/Profile";
import { AiInsights } from "./pages/AiInsights";
import { HeroSection } from "./components/HeroSection";

/* ── Landing layout: NO navbar, no top padding ── */
function LandingLayout({ children }) {
  return (
    <div className="landing-shell min-h-screen flex flex-col text-[#1f2937] overflow-x-hidden">
      <main className="flex-1 w-full m-0 p-0">{children}</main>
      <Footer />
    </div>
  );
}

/* ── App layout: WITH navbar + top-padding for fixed bar ── */
function AppLayout({ children }) {
  return (
    <div className="app-shell min-h-screen flex flex-col text-[#1f2937] font-sans overflow-x-hidden">
      <div className="app-shell-glow" aria-hidden="true" />
      <Navbar />
      <main className="app-shell-main flex-1 w-full pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {children}
      </main>
      <Footer />
    </div>
  );
}

function RouteTransition({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
      transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
        {/* Landing — no navbar */}
        <Route
          path="/"
          element={(
            <RouteTransition>
              <LandingLayout><HeroSection /></LandingLayout>
            </RouteTransition>
          )}
        />

        {/* Auth — self-contained full-screen */}
        <Route path="/login" element={<RouteTransition><Login /></RouteTransition>} />
        <Route path="/signup" element={<RouteTransition><Signup /></RouteTransition>} />

        {/* Authenticated app — navbar visible */}
        <Route path="/dashboard" element={<RouteTransition><AppLayout><Dashboard /></AppLayout></RouteTransition>} />
        <Route path="/employees" element={<RouteTransition><AppLayout><Employees /></AppLayout></RouteTransition>} />
        <Route path="/employees/:id" element={<RouteTransition><AppLayout><EmployeeProfile /></AppLayout></RouteTransition>} />
        <Route path="/chatbot" element={<RouteTransition><AppLayout><Chatbot /></AppLayout></RouteTransition>} />
        <Route path="/ai-insights" element={<RouteTransition><AppLayout><AiInsights /></AppLayout></RouteTransition>} />
        <Route path="/meeting-summary" element={<RouteTransition><AppLayout><MeetingSummary /></AppLayout></RouteTransition>} />
        <Route path="/profile" element={<RouteTransition><AppLayout><Profile /></AppLayout></RouteTransition>} />
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  return (
    <Router>
      <AnimatedRoutes />
    </Router>
  );
}

export default App;
