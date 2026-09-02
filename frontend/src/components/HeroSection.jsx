import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260302_085640_276ea93b-d7da-4418-a09b-2aa5b490e838.mp4";

const GEIST = "'Geist', 'Barlow', sans-serif";
const SERIF = "'Instrument Serif', serif";

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] },
  }),
};

export function HeroSection() {
  const videoRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {});
  }, []);

  return (
    <section
      className="relative w-full overflow-hidden bg-white"
      style={{ minHeight: "100vh" }}
    >
      {/* ── Background Video ── */}
      <div className="absolute inset-0 z-0">
        <video
          ref={videoRef}
          autoPlay loop muted playsInline preload="auto"
          className="w-full h-full object-cover"
          style={{ transform: "scaleY(-1)" }}
        >
          <source src={VIDEO_URL} type="video/mp4" />
        </video>

        {/* White gradient — blends video seamlessly into white page */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0) 26.416%, rgba(255,255,255,1) 66.943%)",
          }}
        />
      </div>

      {/* ── Content ── */}
      <div
        className="relative z-10 mx-auto flex flex-col items-center text-center"
        style={{
          maxWidth: "1200px",
          paddingTop: "290px",
          paddingBottom: "80px",
          paddingLeft: "24px",
          paddingRight: "24px",
          gap: "32px",
        }}
      >
        {/* Brand mark */}
        <motion.div
          initial="hidden" animate="visible" custom={0} variants={fadeUp}
          style={{ fontFamily: GEIST, fontWeight: 700, fontSize: "15px", color: "#1f7a6c", letterSpacing: "0.06em", textTransform: "uppercase" }}
        >
          SAHAY
        </motion.div>

        {/* ── Headline ── */}
        <motion.h1
          initial="hidden" animate="visible" custom={0.1} variants={fadeUp}
          style={{
            fontFamily: GEIST,
            fontWeight: 500,
            letterSpacing: "-0.04em",
            lineHeight: 1.05,
            color: "#0f0f0f",
            margin: 0,
          }}
          className="flex flex-col items-center"
        >
          <span style={{ fontSize: "clamp(40px, 6vw, 80px)" }}>
            Simple{" "}
            <span
              style={{
                fontFamily: SERIF,
                fontStyle: "italic",
                fontWeight: 400,
                fontSize: "clamp(48px, 7.5vw, 100px)",
                letterSpacing: "-0.02em",
                color: "#1f2937",
              }}
            >
              management
            </span>
          </span>
          <span style={{ fontSize: "clamp(40px, 6vw, 80px)" }}>
            for your remote team
          </span>
        </motion.h1>

        {/* ── Description ── */}
        <motion.p
          initial="hidden" animate="visible" custom={0.2} variants={fadeUp}
          style={{
            fontFamily: GEIST,
            fontSize: "18px",
            color: "#373a46",
            opacity: 0.8,
            maxWidth: "554px",
            lineHeight: 1.65,
            margin: 0,
          }}
        >
          SAHAY helps HR leaders manage hundreds of employees with institutional memory,
          AI-powered meeting prep, sentiment tracking, and real-time workforce insights.
        </motion.p>

        {/* ── Single CTA Button ── */}
        <motion.div
          initial="hidden" animate="visible" custom={0.3} variants={fadeUp}
        >
          <button
            onClick={() => navigate("/login")}
            style={{
              fontFamily: GEIST,
              fontWeight: 500,
              fontSize: "15px",
              color: "#fff",
              background: "linear-gradient(145deg, #2a2a2a 0%, #1a1a1a 50%, #111 100%)",
              borderRadius: "40px",
              padding: "15px 36px",
              border: "none",
              cursor: "pointer",
              letterSpacing: "-0.01em",
              boxShadow:
                "inset -4px -6px 25px 0px rgba(201,201,201,0.08), inset 4px 4px 10px 0px rgba(29,29,29,0.24), 0px 8px 24px rgba(0,0,0,0.18)",
              transition: "transform 0.18s ease, opacity 0.18s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.opacity = "0.88";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.opacity = "1";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            Get Started →
          </button>

          <p style={{ fontFamily: GEIST, fontSize: "12px", color: "#9ca3af", marginTop: "12px" }}>
            No credit card required
          </p>
        </motion.div>
      </div>
    </section>
  );
}
