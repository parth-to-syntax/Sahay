import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";

export function CTAButtons() {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
      className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-10"
    >
      {/* Primary CTA → /signup */}
      <button
        onClick={() => navigate("/signup")}
        className="px-8 py-3.5 bg-[#f8f8f8] hover:bg-white text-[#171717] rounded-[2px] font-medium transition-colors duration-300 w-full sm:w-auto"
      >
        Get Started
      </button>

      {/* Secondary CTA → /dashboard */}
      <button
        onClick={() => navigate("/dashboard")}
        className="px-8 py-3.5 bg-transparent border border-white/20 hover:bg-white/10 text-white rounded-[2px] font-medium transition-colors duration-300 w-full sm:w-auto"
      >
        View Dashboard
      </button>
    </motion.div>
  );
}
