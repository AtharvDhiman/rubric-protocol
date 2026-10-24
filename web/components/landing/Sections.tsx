"use client";

/**
 * Everything below the hero fold. Plain, dense, and animated only on scroll -
 * `useInView` fires each section once when it arrives, rather than everything
 * firing at mount.
 */

import Link from "next/link";
import { SolanaMark } from "../SolanaMark";
import { useInView } from "../useInView";
import { FIGURES, FIGURE_TAGS, FIGURES_NOTE, MARQUEE_ITEMS } from "@/lib/constants";
import {
  EXAMPLE_HEADING,
  LOG_BODY,
  LOG_CAPTION,
  LOG_HEADING,
  LOG_LINES,
  STEPS,
} from "@/lib/landing-content";

// ---------------------------------------------------------------------------
// Marquee
// ---------------------------------------------------------------------------

export function Marquee() {
  // Duplicated once so the -50% translate loops seamlessly.
  const items = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {items.map((item, i) => (
          <span
            key={i}
            className="label label-11"
            style={{ color: "var(--text-faint)", letterSpacing: "0.18em" }}
          >
            {item}
            <span style={{ color: "var(--text-faint)", marginLeft: 48 }}>◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

// The steps are in lib/landing-content.ts, where a test checks that no timing is
// stated as a fact.

export function HowItWorks() {
  const { ref, inView } = useInView<HTMLElement>();

  return (
    <section
      id="how-it-works"
      ref={ref}
      className="plate-section"
      style={{ background: "var(--surface)", padding: "96px 56px" }}
    >
      <h2 style={{ fontSize: 36, letterSpacing: "-0.02em", color: "var(--text)" }}>
        How it works
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 15, margin: "12px 0 56px" }}>
        Three steps. One of them is yours.
      </p>

      <div
        className="cols-3 divide-x"
        style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 48 }}
      >
        {STEPS.map((step, i) => (
          <div
            key={step.n}
            className={`reveal ${inView ? "in" : ""}`}
            style={{
              animationDelay: `${0.1 * (i + 1)}s`,
              borderLeft: i === 0 ? "none" : "1px solid var(--border)",
              paddingLeft: i === 0 ? 0 : 48,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              {/* Step number. This used to carry a section mark; the owner asked
                  for that symbol gone from the site, so the numeral does the work
                  on its own - same Martian Mono, same single accent. */}
              <span
                className="data"
                style={{
                  fontSize: 26,
                  fontWeight: 600,
                  lineHeight: 1,
                  letterSpacing: "-0.01em",
                  color: "var(--accent)",
                }}
              >
                {step.n}
              </span>
              <h3 style={{ fontSize: 20, color: "var(--text)", margin: 0 }}>
                {step.title}
              </h3>
            </div>
            <p
              style={{
                fontSize: 15,
                lineHeight: 1.65,
                color: "var(--text-muted)",
                marginTop: 16,
              }}
            >
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The verdict log
// ---------------------------------------------------------------------------

// The lines are in lib/landing-content.ts. This is an ILLUSTRATION: see LOG_CAPTION.

export function VerdictLog() {
  const { ref, inView } = useInView<HTMLElement>();

  return (
    <section
      id="verdict-log"
      ref={ref}
      className="plate-section"
      style={{ background: "var(--page)", padding: "96px 56px" }}
    >
      <div
        className="cols"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "start" }}
      >
        <div className={`reveal ${inView ? "in" : ""}`}>
          <h2 style={{ fontSize: 36, letterSpacing: "-0.02em", color: "var(--text)" }}>
            {LOG_HEADING}
          </h2>
          <p
            style={{
              fontSize: 15,
              lineHeight: 1.65,
              color: "var(--text-muted)",
              marginTop: 20,
              maxWidth: 460,
            }}
          >
            {LOG_BODY}
          </p>
        </div>

        <div
          className={`reveal ${inView ? "in" : ""}`}
          style={{
            animationDelay: "0.15s",
            background: "var(--sunk)",
            border: "1px solid var(--hairline)",
            borderRadius: 2,
            padding: "20px 24px",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            lineHeight: 2,
            overflowX: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              paddingBottom: 12,
              borderBottom: "1px solid var(--border)",
              marginBottom: 12,
            }}
          >
            <SolanaMark size={14} />
            {/* An EXAMPLE, said first and plainly. This used to read "MATTER 0042" and
                "LIVE" beside a pulsing green dot: a seeded sample presented as a feed,
                in the one colour the design reserves for "the chain paid". Nothing on
                this page is real activity, so nothing here is green. */}
            <span
              className="label"
              style={{ color: "var(--text-muted)", letterSpacing: "0.16em" }}
            >
              {EXAMPLE_HEADING}
            </span>
          </div>

          {LOG_LINES.map((line, i) => {
            const isFinal = i === LOG_LINES.length - 1;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 16,
                  alignItems: "baseline",
                  opacity: inView ? undefined : 0,
                  animation: inView
                    ? `logIn 0.4s ease-out ${0.2 + i * 0.5}s both`
                    : undefined,
                  borderLeft: isFinal ? "2px solid var(--text-faint)" : undefined,
                  paddingLeft: isFinal ? 12 : undefined,
                  marginTop: isFinal ? 8 : undefined,
                }}
              >
                <span style={{ color: "var(--text-faint)" }}>{line.time}</span>
                <span style={{ color: "var(--text-muted)", flex: 1 }}>{line.body}</span>
                {line.verdict && (
                  <span style={{ color: "var(--text)", fontWeight: 500 }}>{line.verdict}</span>
                )}
              </div>
            );
          })}

          {/* A sentence, so Archivo, not the ledger's mono. */}
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--text-muted)",
              marginTop: 16,
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
            }}
          >
            {LOG_CAPTION}
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

export function Figures() {
  const { ref, inView } = useInView<HTMLElement>();

  return (
    <section
      ref={ref}
      className="plate-section"
      style={{ background: "var(--surface)", padding: "72px 56px" }}
    >
      <div
        className="cols-4"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 40 }}
      >
        {FIGURES.map((figure, i) => (
          <div
            key={figure.label}
            className={`reveal ${inView ? "in" : ""}`}
            style={{
              animationDelay: `${0.08 * i}s`,
              borderLeft: i === 0 ? "none" : "1px solid var(--border)",
              paddingLeft: i === 0 ? 0 : 40,
            }}
          >
            <div
              className="data"
              style={{ fontSize: 30, fontWeight: 600, color: "var(--text)" }}
            >
              {figure.value}
            </div>
            <div style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 8 }}>
              {figure.label}
            </div>
            {/* Beside EVERY figure, not in a footnote: a target and a property of
                the code are different statements, and neither is a measurement. */}
            <div
              className="label"
              style={{ color: "var(--text-faint)", marginTop: 8, letterSpacing: "0.16em" }}
            >
              {FIGURE_TAGS[figure.kind]}
            </div>
          </div>
        ))}
      </div>

      {/* Targets are not results. Saying so is not optional for a protocol
          whose entire pitch is verifiable claims. */}
      <p
        className="label"
        style={{ color: "var(--text-faint)", marginTop: 40, letterSpacing: "0.16em" }}
      >
        {FIGURES_NOTE}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA + footer
// ---------------------------------------------------------------------------

export function FinalCta() {
  const { ref, inView } = useInView<HTMLElement>();

  return (
    <section
      ref={ref}
      className="plate-section"
      style={{
        background: "var(--page)",
        padding: "112px 56px",
        textAlign: "center",
      }}
    >
      <div className={`reveal ${inView ? "in" : ""}`}>
        <h2 style={{ fontSize: 34, letterSpacing: "-0.02em", color: "var(--text)" }}>
          Post your first rubric
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: 15, margin: "12px 0 32px" }}>
          Three clauses, about two minutes.
        </p>
        <Link href="/create" className="btn btn-primary">
          Seal and fund a rubric
        </Link>
      </div>
    </section>
  );
}

