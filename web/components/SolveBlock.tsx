/**
 * THE SOLVE BLOCK - the centrepiece of /task/[id], and the whole thesis in one row.
 *
 *     CONF            THRESHOLD        Δ
 *      94                 70          +24        SOLVE LOCKED
 *
 * The judge's confidence is read as a SOLVE RESIDUAL and the protocol's
 * confidence threshold is the tolerance it is measured against. That is why the
 * threshold is printed beside the confidence rather than hidden in an env var: a
 * confidence figure with no baseline next to it is not evidence, it is a number.
 * Δ is the whole reading - it is what decides whether this matter could settle
 * automatically at all, and it makes the held state legible instead of an
 * unexplained badge.
 *
 * THREE VARIANTS, and the colour rules that separate them:
 *
 *   cleared   Δ positive. Fully achromatic. A pass is INK, not green - that is
 *             the highest-leverage decision in this design system, because it
 *             makes a green pixel mean "the chain paid" rather than "a check
 *             went well". A refunded matter with high confidence is `cleared`:
 *             the solve was good, the work was not.
 *
 *   held      Δ negative, or the matter is held for manual review for one of the
 *             other reasons `applyVerdictGuards` can produce. Reads
 *             "UNRESOLVED — HELD FOR REVIEW" in --warning, and the block's own
 *             border switches from 1px SOLID to 1px DASHED. That dash is
 *             load-bearing and consistent across the whole product: dotted is a
 *             hypothesis, solid is a measurement. The escrow is untouched -
 *             nobody was paid and nobody was refunded - and the block says so in
 *             words, because this is precisely the case where colour alone would
 *             lie: held is neither out-of-tolerance nor released.
 *
 *   released  The one green event on the screen, and it is green only because
 *             the chain actually moved money. Green marks the money: the Δ
 *             figure, the status mark and the words ESCROW RELEASED. The words
 *             SOLVE LOCKED stay in ink, because the solve clearing its tolerance
 *             is still just a passing check.
 *
 * STATUS IS NEVER CARRIED BY COLOUR ALONE. Every variant is distinguished four
 * ways at once - by a word, by a mark whose SHAPE differs (bare disc / struck
 * disc / hollow ring, the same vocabulary as the docket's status column), by the
 * SIGN of an integer, and only then by colour. --warning against --positive is
 * near-identical in greyscale and to a deuteranope, so the redundant channels
 * are not decoration; they are the accessible reading.
 *
 * PRECISION IS A TYPOGRAPHIC RULE. Confidence is an INTEGER 0-100 - that is what
 * `JudgePayloadSchema` in lib/verifier.ts constrains and what the model actually
 * reported. Rendering it as `0.94` would assert two decimal places of precision
 * that never existed, on a screen whose entire pitch is that what you see is
 * what was measured.
 *
 * Server component by design: no "use client", no hooks, no JavaScript shipped.
 * The verdict is the most important thing on the page and it renders complete in
 * the HTML - with the webfont blocked, with JS blocked, and through a hydration
 * failure.
 */

import { DEFAULT_CONFIDENCE_THRESHOLD } from "@/lib/constants";

export type SolveVariant = "cleared" | "held" | "released";

export interface SolveBlockProps {
  /**
   * The judge's confidence, an integer 0-100. `null` when nothing has been
   * judged yet (an OPEN or SUBMITTED matter), in which case this component
   * renders nothing at all rather than inventing a placeholder reading - there
   * is no residual until there has been a solve.
   */
  confidence: number | null;

  /**
   * The confidence threshold the judge ACTUALLY gated on.
   *
   * The real value is `confidenceThreshold()` in lib/verifier.ts, which reads a
   * server-only env var; a server component resolves it and passes it in. The
   * default here is the same documented constant that function falls back to, so
   * the number on screen cannot drift from the number that decided the matter.
   * It is deliberately not a literal in this file.
   */
  threshold?: number;

  /**
   * True when the chain actually released escrow to the worker (state SETTLED).
   * This is a FACT about the chain, so it outranks every inference below: if
   * money moved, this block may not print "escrow untouched", whatever the
   * confidence arithmetic says.
   */
  escrowReleased?: boolean;

  /**
   * True when the matter is held for manual review (state HELD). Passed
   * explicitly rather than inferred from Δ alone, because `applyVerdictGuards`
   * can hold a matter at high confidence - a ruling that contradicts its own
   * clause table, or a rejection that cites no failed clause, is held with Δ
   * positive. Inferring "cleared" from the arithmetic in that case would be a
   * lie about the state of the escrow.
   */
  held?: boolean;
}

/**
 * Print a figure with exactly the precision it has, and no more.
 *
 * Confidence is always an integer. The threshold is env-tunable and could in
 * principle arrive as 70.5, so a fractional value keeps one decimal rather than
 * being silently rounded into a different tolerance than the one enforced.
 */
function figure(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** The status mark. Three distinguishable SHAPES, not three colours. */
function StatusMark({ variant }: { variant: SolveVariant }) {
  // 12px box, 1px stroke, no radius anywhere - the same drawing weight as every
  // other rule in the system. `currentColor` so the mark inherits the variant
  // colour set once in CSS instead of being restated here.
  return (
    <svg
      className="solve-mark"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      {variant === "released" ? (
        // A struck disc: the ring is the tolerance, the filled centre is the
        // event that landed inside it.
        <>
          <circle
            cx="6"
            cy="6"
            r="5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
          <circle cx="6" cy="6" r="3" fill="currentColor" />
        </>
      ) : variant === "held" ? (
        // A hollow ring: the docket's HELD mark. Nothing has landed in it.
        <circle
          cx="6"
          cy="6"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      ) : (
        // A bare disc: tracked and measured, nothing more claimed.
        <circle cx="6" cy="6" r="4" fill="currentColor" />
      )}
    </svg>
  );
}

export function SolveBlock({
  confidence,
  threshold = DEFAULT_CONFIDENCE_THRESHOLD,
  escrowReleased = false,
  held = false,
}: SolveBlockProps) {
  // No verdict, no residual. An OPEN or SUBMITTED matter has not been measured,
  // and rendering nothing is more honest than a dashed placeholder that looks
  // like a value which failed to load.
  if (confidence === null) return null;

  // Belt and braces. `JudgePayloadSchema` already constrains this to an integer
  // in 0-100, so this clamp should never bite. It rounds rather than formatting
  // a fraction on purpose: if a caller ever passes 0.94, the screen shows a
  // visibly wrong `1` instead of quietly rendering `0.94` as though the model
  // had reported two decimal places.
  const conf = Math.round(Math.min(100, Math.max(0, confidence)));
  const delta = conf - threshold;

  // Order matters. A released escrow is an observed on-chain fact and outranks
  // the threshold arithmetic; only then does a held flag or a negative residual
  // decide between held and cleared.
  const variant: SolveVariant = escrowReleased
    ? "released"
    : held || delta < 0
      ? "held"
      : "cleared";

  // U+2212 MINUS SIGN, not a hyphen: it is the same width as the digits in a
  // monospace face and reads as arithmetic rather than as punctuation. The sign
  // is the integer channel that carries the status without colour.
  const deltaText =
    delta > 0
      ? `+${figure(delta)}`
      : delta < 0
        ? `−${figure(Math.abs(delta))}`
        : "0";

  const statusWord =
    variant === "held" ? "UNRESOLVED — HELD FOR REVIEW" : "SOLVE LOCKED";

  const note =
    variant === "released"
      ? "ESCROW RELEASED"
      : variant === "held"
        ? "ESCROW UNTOUCHED"
        : null;

  // One clean spoken reading of the whole block. The visual cells are hidden
  // from assistive technology and replaced by this, so a screen reader gets a
  // sentence instead of five disconnected fragments and a bare Greek capital.
  const spokenDelta =
    delta === 0
      ? "Delta zero."
      : `Delta ${delta > 0 ? "plus" : "minus"} ${figure(Math.abs(delta))}.`;

  const spokenState =
    variant === "released"
      ? "Solve locked, and the escrow released to the worker."
      : variant === "held"
        ? "Unresolved and held for review. The escrow is untouched: nobody was paid and nobody was refunded."
        : "Solve locked: the ruling cleared the threshold.";

  const spoken = `Solve residual. Confidence ${figure(
    conf
  )} out of 100, against a settle threshold of ${figure(
    threshold
  )}. ${spokenDelta} ${spokenState}`;

  return (
    <section className={`solve solve--${variant}`}>
      {/* React 19 hoists this to <head> and de-duplicates it by `href`, so a
          page may render more than one SolveBlock without repeating the rules.
          These live with the component rather than in globals.css deliberately:
          the block's whole meaning is the solid/dashed border swap and the
          single green event, and splitting that across two files is how a
          variant quietly loses its dash in a later edit.

          Every colour here is a token by NAME. Not one volume-only ink
          (--marker, --rig-*, --v-*, --d-*, --grid) appears: this block sits on
          the light plate, where --marker measures 1.26:1 and would be
          invisible. The tokens used are also the ones `.volume` remaps, so if
          this block is ever placed inside a viewport panel it resolves to the
          dark-legal equivalents on its own. */}
      <style href="rubric-solve-block" precedence="default">{`
.solve {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px 40px;
  padding: 24px;
  /* Borders, never shadows. Radius 0. The solid rule is the measurement. */
  border: 1px solid var(--border);
  /* No background of its own: --raised is reserved for state committed
     on-chain, and a held matter has committed nothing. Inheriting the plate it
     is placed on keeps that reservation intact. */
  background: transparent;
}

/* Dotted is a hypothesis, solid is a measurement. A held matter has not been
   resolved, so its frame stops claiming to be one. */
.solve--held {
  border: 1px dashed var(--warning);
}

.solve-row {
  display: flex;
  align-items: flex-end;
  gap: 40px;
  margin: 0;
}

.solve-cell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}

.solve-cell .label {
  margin: 0;
}

/* Scoped under .solve so these win over .data regardless of the order in which
   globals.css and this hoisted sheet land in <head>. */
.solve .solve-figure {
  margin: 0;
  font-size: 34px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text);
}

.solve .solve-figure--secondary {
  font-size: 20px;
}

/* The one green event: it marks money that actually moved. */
.solve--released .solve-delta {
  color: var(--positive);
}

.solve--held .solve-delta {
  color: var(--warning);
}

.solve-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 0 auto;
}

.solve-state-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.solve-mark {
  flex: none;
  display: block;
  color: var(--text);
}

/* .label is --text-muted by default; the status word is not an annotation. */
.solve .solve-word {
  color: var(--text);
}

.solve .solve-note {
  margin: 0;
  color: var(--text-muted);
}

.solve--released .solve-mark,
.solve--released .solve-note {
  color: var(--positive);
}

/* Held takes --warning across the whole status cluster, matching the delta
   figure and the dashed frame. */
.solve--held .solve-mark,
.solve--held .solve-word,
.solve--held .solve-note {
  color: var(--warning);
}

.solve-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* 375px and under: CONF / THRESHOLD / delta stack vertically at 34 -> 28 and
   20 -> 16, so the three figures never compress or wrap mid-number on a phone. */
@media (max-width: 375px) {
  .solve {
    padding: 16px;
    gap: 16px;
  }

  .solve-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .solve .solve-figure {
    font-size: 28px;
  }

  .solve .solve-figure--secondary {
    font-size: 16px;
  }

  .solve-state {
    margin-left: 0;
  }
}
      `}</style>

      <p className="solve-sr">{spoken}</p>

      <div className="solve-row" aria-hidden="true">
        <div className="solve-cell">
          <span className="label">CONF</span>
          <span className="data solve-figure">{figure(conf)}</span>
        </div>

        <div className="solve-cell">
          <span className="label">THRESHOLD</span>
          <span className="data solve-figure solve-figure--secondary">
            {figure(threshold)}
          </span>
        </div>

        <div className="solve-cell">
          {/* The delta glyph, not the word: this is a readout, and the spoken
              version above already says "delta" in full. */}
          <span className="label">{"Δ"}</span>
          <span className="data solve-figure solve-figure--secondary solve-delta">
            {deltaText}
          </span>
        </div>
      </div>

      <div className="solve-state" aria-hidden="true">
        <p className="solve-state-line">
          <StatusMark variant={variant} />
          <span className="label label-11 solve-word">{statusWord}</span>
        </p>
        {note !== null && <p className="label solve-note">{note}</p>}
      </div>
    </section>
  );
}
