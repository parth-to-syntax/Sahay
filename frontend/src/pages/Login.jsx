import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock } from "lucide-react";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260302_085640_276ea93b-d7da-4418-a09b-2aa5b490e838.mp4";

const GEIST = "'Geist', 'Barlow', sans-serif";

function AuthVideo() {
  const videoRef = useRef(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {});
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        autoPlay loop muted playsInline preload="auto"
        style={{
          position: "fixed", top: 0, left: 0,
          width: "100%", height: "100%",
          objectFit: "cover",
          transform: "scaleY(-1)",
          zIndex: -2,
        }}
      >
        <source src={VIDEO_URL} type="video/mp4" />
      </video>
      {/* gradient overlay — same as hero */}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: -1,
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0) 26.416%, rgba(255,255,255,0.85) 66.943%)",
        }}
      />
      {/* lighter frosted overlay so form stays readable */}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: -1,
          background: "rgba(255,255,255,0.35)",
        }}
      />
    </>
  );
}

export function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("emp1");
  const [password, setPassword] = useState("emp123");

  const handleLogin = () => {
    if (username === "emp1" && password === "emp123") {
      navigate("/dashboard");
    } else {
      alert("Invalid credentials. Please use emp1 and emp123");
    }
  };

  return (
    <div
      className="relative min-h-screen flex flex-col items-center justify-center px-4"
      style={{ fontFamily: GEIST }}
    >
      <AuthVideo />

      {/* Top logo */}
      <div className="fixed top-0 left-0 right-0 z-50 px-8 py-5">
        <Link to="/" style={{ fontFamily: GEIST, fontWeight: 600, fontSize: "20px", color: "#1f2937", textDecoration: "none", letterSpacing: "-0.03em" }}>
          SAHAY
        </Link>
      </div>

      {/* Card */}
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "#fff",
          borderRadius: "20px",
          boxShadow: "0px 24px 60px rgba(0,0,0,0.10), 0px 4px 16px rgba(0,0,0,0.06)",
          padding: "40px 36px",
          border: "1px solid rgba(0,0,0,0.06)",
          position: "relative",
          zIndex: 10,
        }}
      >
        {/* Card header */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <p style={{ fontWeight: 700, fontSize: "22px", color: "#0f0f0f", letterSpacing: "-0.04em" }}>
            SAHAY
          </p>
          <h1 style={{ fontWeight: 500, fontSize: "18px", color: "#1f2937", marginTop: "4px", letterSpacing: "-0.02em" }}>
            Sign in to your account
          </h1>
          <p style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>
            Welcome back, HR leader.
          </p>
        </div>

        {/* Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "13px", fontWeight: 500, color: "#374151" }}>
            Email address
            <div style={{ position: "relative" }}>
              <Mail style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", width: "15px", height: "15px", color: "#9ca3af" }} />
              <input
                type="text"
                placeholder="emp1"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{
                  width: "100%", paddingLeft: "38px", paddingRight: "14px",
                  paddingTop: "10px", paddingBottom: "10px",
                  borderRadius: "10px", border: "1px solid #e5e7eb",
                  background: "#fafafa", fontSize: "14px", color: "#1f2937",
                  outline: "none", boxSizing: "border-box",
                  fontFamily: GEIST,
                }}
              />
            </div>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "13px", fontWeight: 500, color: "#374151" }}>
            Password
            <div style={{ position: "relative" }}>
              <Lock style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", width: "15px", height: "15px", color: "#9ca3af" }} />
              <input
                type="password"
                placeholder="emp123"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: "100%", paddingLeft: "38px", paddingRight: "14px",
                  paddingTop: "10px", paddingBottom: "10px",
                  borderRadius: "10px", border: "1px solid #e5e7eb",
                  background: "#fafafa", fontSize: "14px", color: "#1f2937",
                  outline: "none", boxSizing: "border-box",
                  fontFamily: GEIST,
                }}
              />
            </div>
          </label>
        </div>

        {/* Submit */}
        <button
          onClick={handleLogin}
          style={{
            marginTop: "20px",
            width: "100%",
            padding: "12px",
            borderRadius: "12px",
            border: "none",
            background: "linear-gradient(145deg, #2a2a2a 0%, #1a1a1a 50%, #111 100%)",
            color: "#fff",
            fontFamily: GEIST,
            fontWeight: 500,
            fontSize: "14px",
            cursor: "pointer",
            letterSpacing: "-0.01em",
            boxShadow: "inset -4px -6px 25px 0px rgba(201,201,201,0.08), inset 4px 4px 10px 0px rgba(29,29,29,0.24)",
            transition: "opacity 0.2s",
          }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = "0.88")}
          onMouseOut={(e)  => (e.currentTarget.style.opacity = "1")}
        >
          Login
        </button>

      </div>
    </div>
  );
}
