"use client";

/**
 * The hero: a mechanical iris that opens on load with the Solana mark igniting
 * in its core.
 *
 * This is the only ornamental thing on the entire site, and it earns its place
 * because an aperture is a thing that examines - which is what the protocol
 * does. Everything is inline SVG animated with CSS keyframes: no framer-motion,
 * no GSAP, no three.js, no stock imagery.
 *
 * The whole visual is aria-hidden. The page's meaning lives in the real <h1>
 * and the copy beneath it, and under prefers-reduced-motion the aperture simply
 * sits still - the page is complete with zero motion.
 */

import Link from "next/link";
import { SolanaMark } from "../SolanaMark";

const BLADE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

export function ApertureHero() {
  return (
    <section className="hero on-dark">
      {/* ---- LAYERS 1-3 + 5: the machine ---- */}
      <div className="hero-stage" aria-hidden="true">
        {/* Layer 2a - outer counter-rotating ring */}
        <svg className="ring-outer" viewBox="0 0 800 800" fill="none">
          <circle
            cx="400"
            cy="400"
            r="352"
            stroke="rgba(153,69,255,.28)"
            strokeWidth="0.9"
            strokeDasharray="2 14"
          />
          <circle
            cx="400"
            cy="400"
            r="374"
            stroke="rgba(20,241,149,.14)"
            strokeWidth="0.9"
            strokeDasharray="60 420"
            strokeLinecap="round"
          />
        </svg>

        {/* Layer 2b - inner ring, the other way */}
        <svg className="ring-inner" viewBox="0 0 800 800" fill="none">
          <circle
            cx="400"
            cy="400"
            r="330"
            stroke="rgba(244,244,245,.08)"
            strokeWidth="0.8"
            strokeDasharray="1 22"
          />
        </svg>

        {/* Layer 1 - the aperture itself */}
        <svg className="aperture" viewBox="0 0 800 800" fill="none">
          <defs>
            <radialGradient id="haze">
              <stop offset="0%" stopColor="#9945FF" stopOpacity="0.26" />
              <stop offset="55%" stopColor="#9945FF" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#9945FF" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="bladeFace" x1="0" y1="0" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#23232b" />
              <stop offset="48%" stopColor="#17171d" />
              <stop offset="100%" stopColor="#0e0e12" />
            </linearGradient>
            <linearGradient id="bladeEdge" x1="0" y1="0" x2="100%" y2="0">
              <stop offset="0%" stopColor="#9945FF" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#14F195" stopOpacity="0.45" />
            </linearGradient>
          </defs>

          <circle cx="400" cy="400" r="390" fill="url(#haze)" />

          {BLADE_ANGLES.map((angle) => (
            <path
              key={angle}
              d="M400,132 L556,224 L472,352 L400,310 Z"
              fill="url(#bladeFace)"
              stroke="url(#bladeEdge)"
              strokeWidth="1.2"
              transform={`rotate(${angle} 400 400)`}
            />
          ))}

          <circle
            cx="400"
            cy="400"
            r="112"
            stroke="#9945FF"
            strokeOpacity="0.5"
            strokeWidth="1.1"
          />
          <circle
            cx="400"
            cy="400"
            r="120"
            stroke="#14F195"
            strokeOpacity="0.2"
            strokeWidth="0.8"
          />
        </svg>

        {/* Layer 3 - the core glow */}
        <div className="core-glow" />

        {/* Layer 4 - the mark, igniting bar by bar */}
        <div className="core-mark">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              width: 128,
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  height: 14,
                  width: "100%",
                  background:
                    i === 1
                      ? "linear-gradient(90deg,#14F195,#9945FF)"
                      : "linear-gradient(90deg,#9945FF,#14F195)",
                  clipPath:
                    i === 1
                      ? "polygon(0 0, 78% 0, 100% 100%, 22% 100%)"
                      : "polygon(22% 0, 100% 0, 78% 100%, 0 100%)",
                  boxShadow:
                    i === 1
                      ? "0 0 24px rgba(20,241,149,.55)"
                      : "0 0 24px rgba(153,69,255,.55)",
                  animation: `barIn 0.9s cubic-bezier(0.19,1,0.22,1) ${
                    [0.95, 1.08, 1.21][i]
                  }s both`,
                }}
              />
            ))}
          </div>
        </div>

        {/* Layer 5 - atmosphere. The vignette is a legibility device. */}
        <div className="vignette" />
        <div className="scanlines" />
      </div>

      {/* ---- LAYER 6: nav ---- */}
      <nav
        style={{
          position: "relative",
          zIndex: 3,
          height: 84,
          padding: "0 56px",
          display: "flex",
          alignItems: "center",
          gap: 32,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            textDecoration: "none",
            color: "var(--d-text)",
            fontWeight: 600,
            fontSize: 20,
            letterSpacing: "-0.01em",
            animation: "fadeUp 0.7s cubic-bezier(0.19,1,0.22,1) 0.2s both",
          }}
        >
          <SolanaMark size={18} />
          Rubric
        </Link>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 28,
            animation: "fadeUp 0.7s cubic-bezier(0.19,1,0.22,1) 0.3s both",
          }}
        >
          <a href="#how-it-works" style={navLink}>
            How it works
          </a>
          <Link href="/docket" style={navLink}>
            The docket
          </Link>
          <a href="#verdict-log" style={navLink}>
            Docs
          </a>
          <Link href="/docket" className="btn" style={{ height: 40, padding: "0 18px", fontSize: 14 }}>
            Connect wallet
          </Link>
        </div>
      </nav>

      {/* ---- LAYER 7: the copy ---- */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 24px",
        }}
      >
        <p
          className="label label-11"
          style={{
            color: "var(--d-muted)",
            letterSpacing: "0.18em",
            margin: 0,
            animation: "fadeUp 0.7s cubic-bezier(0.19,1,0.22,1) 1.4s both",
          }}
        >
          AI-JUDGED ESCROW ON SOLANA
        </p>

        <h1
          style={{
            fontSize: "clamp(48px, 7.5vw, 96px)",
            lineHeight: 1.02,
            letterSpacing: "-0.03em",
            fontWeight: 700,
            color: "var(--d-text)",
            margin: "24px 0 0",
          }}
        >
          <span className="line-mask">
            <span style={{ animationDelay: "1.5s" }}>Pay on proof,</span>
          </span>
          <span className="line-mask">
            <span style={{ animationDelay: "1.62s" }}>not on trust.</span>
          </span>
        </h1>

        <p
          style={{
            maxWidth: 620,
            fontSize: 18,
            color: "var(--d-muted)",
            margin: "24px 0 0",
            animation: "fadeUp 0.7s cubic-bezier(0.19,1,0.22,1) 1.95s both",
          }}
        >
          Rubric locks the acceptance criteria on-chain before work begins. An AI
          judge checks each submission against those sealed clauses, and Solana
          releases the payment the moment it passes.
        </p>

        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 32,
            flexWrap: "wrap",
            justifyContent: "center",
            animation: "fadeUp 0.7s cubic-bezier(0.19,1,0.22,1) 2.1s both",
          }}
        >
          <Link href="/docket" className="btn btn-primary">
            Open the docket
          </Link>
          <a href="#how-it-works" className="btn" style={{ padding: "0 26px" }}>
            Read the docs
          </a>
        </div>
      </div>

      {/* ---- LAYER 8: scroll cue ---- */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: 28,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          animation: "fadeUp 0.7s cubic-bezier(0.19,1,0.22,1) 2.4s both",
        }}
      >
        <span
          style={{
            position: "relative",
            width: 1,
            height: 40,
            background: "rgba(244,244,245,.14)",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: 0,
              width: 1,
              height: 16,
              background: "var(--sol-green)",
              animation: "scrollCue 2.4s ease-in-out infinite",
            }}
          />
        </span>
        <span
          className="label"
          style={{ color: "var(--d-faint)", letterSpacing: "0.18em" }}
        >
          Scroll
        </span>
      </div>
    </section>
  );
}

const navLink: React.CSSProperties = {
  fontSize: 14,
  color: "var(--d-muted)",
  textDecoration: "none",
};
