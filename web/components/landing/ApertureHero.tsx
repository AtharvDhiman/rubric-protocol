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
              <stop offset="0%" stopColor="#9945FF" stopOpacity="0.14" />
              <stop offset="55%" stopColor="#9945FF" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#9945FF" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="bladeFace" x1="0" y1="0" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="48%" stopColor="#f1f3f8" />
              <stop offset="100%" stopColor="#e2e6f0" />
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
            ["--d" as string]: "0.2s",
          }}
          className="appear appear--scale"
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
            ["--d" as string]: "0.3s",
          }}
          className="appear appear--soft"
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
        {/* The badge is a lit chip, not a label: a left-to-right metal ramp
            with a sparkle that snaps in ahead of the headline. */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 15px",
            border: 0,
            borderRadius: 5,
            background:
              "linear-gradient(90deg, #7d7d7d 0%, #2a2a2a 52%, #0a0a0a 100%)",
            color: "#f2f2f2",
            fontSize: 12.5,
            fontWeight: 400,
            letterSpacing: "-0.01em",
            ["--d" as string]: "1.4s",
          }}
          className="appear appear--pop"
        >
          <svg
            width="18"
            height="20"
            viewBox="0 0 24 24"
            fill="#ffffff"
            aria-hidden="true"
            style={{
              filter: "drop-shadow(0 0 3px rgba(255,255,255,0.45))",
              flex: "none",
            }}
          >
            <path d="M12 2.6C12.55 2.6 12.88 3.15 13.08 4.7c.62 4.7 1.52 5.6 6.22 6.22 1.55.2 2.1.53 2.1 1.08s-.55.88-2.1 1.08c-4.7.62-5.6 1.52-6.22 6.22-.2 1.55-.53 2.1-1.08 2.1s-.88-.55-1.08-2.1c-.62-4.7-1.52-5.6-6.22-6.22C3.15 12.88 2.6 12.55 2.6 12s.55-.88 2.1-1.08c4.7-.62 5.6-1.52 6.22-6.22C11.12 3.15 11.45 2.6 12 2.6Z" />
          </svg>
          AI-judged escrow on Solana
        </span>

        <h1
          style={{
            fontSize: "clamp(44px, 7vw, 88px)",
            lineHeight: 1.12,
            letterSpacing: "-0.045em",
            fontWeight: 500,
            color: "var(--text)",
            margin: "22px 0 0",
          }}
        >
          <span className="line-mask">
            <span style={{ animationDelay: "1.5s" }}>Pay on proof,</span>
          </span>
          <span className="line-mask">
            <span style={{ animationDelay: "1.62s" }}>
              not on <em className="accent-phrase">trust</em>.
            </span>
          </span>
        </h1>

        <p
          style={{
            maxWidth: 560,
            fontSize: 17,
            lineHeight: 1.55,
            letterSpacing: "-0.015em",
            color: "var(--d-muted)",
            margin: "20px 0 0",
            ["--d" as string]: "1.95s",
            animationDuration: "1.25s",
          }}
          className="appear appear--soft"
        >
          Rubric locks the acceptance criteria on-chain before work begins. An AI
          judge checks each submission against those sealed clauses, and Solana
          releases the payment the moment it passes.
        </p>

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 28,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <Link
            href="/docket"
            className="btn btn-primary appear appear--btn"
            style={{ ["--d" as string]: "2.1s" }}
          >
            Open the docket
          </Link>
          <a
            href="#how-it-works"
            className="btn appear appear--side"
            style={{ ["--d" as string]: "2.24s" }}
          >
            Read the docs
          </a>
        </div>
      </div>

    </section>
  );
}

const navLink: React.CSSProperties = {
  fontSize: 14,
  color: "var(--d-muted)",
  textDecoration: "none",
};
