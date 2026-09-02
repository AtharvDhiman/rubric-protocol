import Link from "next/link";
import type { CSSProperties } from "react";

import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  FEE_PERCENT_LABEL,
  MAX_BOUNTY_BASE_UNITS,
  TAGLINE,
  USDC_DECIMALS,
} from "@/lib/constants";
import { demoTasks, type TaskState } from "@/lib/demo";

/**
 * THE PASS LIMIT - the signature footer.
 *
 * THE IDEA, IN TWO SENTENCES. Every verdict this protocol publishes is a
 * confidence measured against a limit that was fixed before the work started,
 * so the footer draws that limit as the one hard vertical rule on the page -
 * standing at the exact fraction of the width that its own value is, which
 * makes the number a POSITION rather than a claim - and hangs every judged
 * record on it as a reading. The two records that have not been judged get a
 * channel with nothing on it, because an instrument that plots a measurement it
 * has not taken is the precise lie this product exists to prevent.
 *
 * WHY THIS AND NOT A WORDMARK
 * ---------------------------
 * A giant name at the bottom of a page is a tone, and any company can wear it.
 * Only an escrow protocol with public verdicts can end its page with the number
 * that decides whether money moves, drawn to scale, with its own docket
 * registered against it. The wordmark is here - it is the brief - but it is the
 * masthead of a chart, not the subject of one.
 *
 * WHAT IS TRUE HERE, AND HOW YOU CAN CHECK IT
 * -------------------------------------------
 * - The five records, their numbers, titles, states and confidences come from
 *   `demoTasks()` in lib/demo.ts. Nothing is retyped and nothing is rounded.
 *   The plot says plainly that they are the sample docket, and it prints the
 *   real counts (5 records, 3 judged) rather than asserting a total.
 * - The pass limit is a prop so a server page can pass this deployment's real
 *   `CONFIDENCE_THRESHOLD`. Its default is `DEFAULT_CONFIDENCE_THRESHOLD`,
 *   which lib/constants.ts documents as the one place the default is written.
 * - The range line takes the bounty cap and the fee from lib/constants.ts,
 *   which mirror `MAX_BOUNTY` and `Config.fee_bps` in the Anchor program.
 * - There are no counters, no totals, no social links, and no claim about
 *   anyone using this. There is nothing here that a reader cannot verify by
 *   opening the docket.
 *
 * WHY THERE IS NO MOTION
 * ----------------------
 * The obvious animation is to sweep each mark from zero up to its reading.
 * That would draw a measurement of 0, then 17, then 46 - values the judge never
 * returned. DESIGN.md forbids a rig stating a fact that is not true, and a
 * needle sweeping for effect is exactly that, so this footer is still by
 * decision rather than by omission. Nothing here animates, so there is nothing
 * for `prefers-reduced-motion` to restructure: the complete document is what is
 * in the HTML, with JavaScript on or off.
 *
 * CONTRAST, MEASURED (sRGB, WCAG 2.x, against the ACTUAL computed ground)
 * ----------------------------------------------------------------------
 * The plot has two grounds, because the region below the limit is `--sunk`.
 * Every ink is stated against BOTH, and the --sunk figure is the worst case.
 *
 *   ink            on --surface #edefec   on --sunk #dde1de   used for
 *   --text              16.00 : 1             14.01 : 1       heads, wordmark
 *   --text-2            11.41 : 1              9.99 : 1       prose, titles
 *   --text-muted         7.35 : 1              6.44 : 1       labels, NO READING
 *   --accent             6.41 : 1              5.61 : 1       record numbers
 *   --positive           6.51 : 1              5.70 : 1       SETTLED
 *   --negative           6.28 : 1              5.50 : 1       REFUNDED
 *   --warning            8.01 : 1              7.01 : 1       HELD
 *
 * Graphics, against a 3:1 floor:
 *   --hairline on --surface 3.76:1, on --sunk 3.29:1 - tracks and ruler ticks
 *   --border and --text rules 16.00:1 and 14.01:1
 *   the status marks reuse the text inks above, all at or above 5.50:1
 * Reversed type:
 *   --surface on a --text fill = 16.00:1 - the limit flag
 *
 * `--sunk` against `--surface` is 1.15:1. That is a PLANE CHANGE and never an
 * information channel: the region is also named by the flag standing on its
 * edge and by the sentence under the plot, so nothing depends on seeing it.
 *
 * Colour never carries a status alone. Each ruling ships the word, a shape
 * (filled disc / filled square / hollow ring / flat bar), an integer (CONF 94,
 * or its explicit absence) and only then the colour - which is why this reads
 * correctly in greyscale and to a deuteranope, where --negative and --positive
 * are 1.04:1 apart.
 *
 * Green appears exactly once, on record 0042: the one matter where the chain
 * actually moved money.
 */

/* ==========================================================================
   DATA - read once at module scope. Every value below comes out of the repo.
   ========================================================================== */

interface Lane {
  /** The on-chain task id, zero-padded exactly as the docket prints it. */
  n: string;
  title: string;
  state: TaskState;
  /** The judge's integer confidence, or null when nothing has been judged. */
  confidence: number | null;
}

/**
 * Ordered by record number rather than by date. A ledger is read down its
 * index, and ordering is the one thing here that is a presentation choice
 * rather than a fact - dates are deliberately not rendered at all, so this
 * component has no time-dependent output and cannot drift between a server
 * render and a client one.
 */
const LANES: Lane[] = demoTasks()
  .map((task) => ({
    n: task.onchainTaskId.toString().padStart(4, "0"),
    title: task.title,
    state: task.state,
    confidence: task.confidence,
  }))
  .sort((a, b) => a.n.localeCompare(b.n));

const JUDGED = LANES.filter((lane) => lane.confidence !== null).length;

/** Mirrors `MAX_BOUNTY` in the Anchor program: 50 USDC, held in base units. */
const MAX_BOUNTY_USDC = MAX_BOUNTY_BASE_UNITS / 10 ** USDC_DECIMALS;

/**
 * The ruling word. `SUBMITTED` prints as IN REVIEW because that is what the
 * state means to a reader, and it is the wording the stamp already uses.
 */
const RULING: Record<TaskState, string> = {
  OPEN: "OPEN",
  SUBMITTED: "IN REVIEW",
  HELD: "HELD",
  SETTLED: "SETTLED",
  REFUNDED: "REFUNDED",
};

const HEADING_ID = "fsig-pass-limit";

/* ==========================================================================
   STYLE - every rule scoped under .fsig, injected from inside the component.
   ========================================================================== */

const FSIG_CSS = `
.fsig {
  position: relative;
  background: var(--surface);
  border-top: 1px solid var(--border);
  color: var(--text);
}

.fsig-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 36px 32px 28px;
}

/* --- THE MASTHEAD ------------------------------------------------------- */

.fsig-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 32px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}

/* Solid, not outlined. The name is the masthead of a chart, so it is set once,
   at a size that carries the block, and then it stops. */
.fsig-name {
  display: inline-block;
  margin: 0;
  font-family: var(--font-sans);
  font-size: clamp(42px, 9vw, 74px);
  font-variation-settings: "wdth" 112;
  font-weight: 700;
  letter-spacing: -0.05em;
  line-height: 0.94;
  color: var(--text);
  text-decoration: none;
}

.fsig-tagline {
  margin: 0;
  max-width: 34ch;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-2);
}

/* --- THE PLOT HEAD ------------------------------------------------------ */

.fsig-plothead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 24px;
  margin-top: 26px;
}

.fsig-h {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.14em;
  line-height: 1.4;
  text-transform: uppercase;
  color: var(--text);
}

.fsig-provenance {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}

/* --- THE COORDINATE BOX -------------------------------------------------
   One box owns the 0-100 axis, and the ruler, the limit, the sub-limit region
   and every mark are positioned inside it as percentages of the same width.
   That is why the flag standing at 70% is not an illustration OF the pass
   limit - it IS the pass limit, drawn to the scale printed beneath it.
   ----------------------------------------------------------------------- */

.fsig-plot {
  position: relative;
  padding-top: 24px;
  margin-top: 14px;
}

/* The region below the limit. --sunk is "a well cut into a sheet", which is
   exactly what this is: the part of the scale where nothing moves. */
.fsig-region {
  position: absolute;
  top: 24px;
  bottom: 0;
  left: 0;
  width: var(--fsig-limit);
  background: var(--sunk);
  z-index: 0;
}

/* THE ONE HARD LINE. 2px, --text, floor to ceiling of the plot. */
.fsig-limit {
  position: absolute;
  top: 21px;
  bottom: 0;
  left: var(--fsig-limit);
  width: 2px;
  margin-left: -1px;
  background: var(--text);
  z-index: 2;
}

/* The limit flag: the only figure above the ruler, and the only reversed type
   in the footer. --surface on a --text fill measures 16.00:1. */
.fsig-flag {
  position: absolute;
  top: 0;
  left: var(--fsig-limit);
  transform: translateX(-50%);
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 7px;
  background: var(--text);
  color: var(--surface);
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.1em;
  white-space: nowrap;
}

/* THE RULER. Minor ticks every 2 and major ticks every 10 of the SAME 0-100
   axis - the repeat period is a percentage, not a pixel count, so the ruler
   cannot drift out of register with the limit or the marks at any width. */
.fsig-ruler {
  position: relative;
  z-index: 1;
  height: 11px;
  background-image:
    repeating-linear-gradient(90deg, var(--hairline) 0 1px, transparent 1px 10%),
    repeating-linear-gradient(90deg, var(--hairline) 0 1px, transparent 1px 2%);
  background-size: 100% 11px, 100% 6px;
  background-repeat: no-repeat, no-repeat;
  background-position: 0 0, 0 0;
}

/* The two datum ends. A repeating gradient begins a period at 100% and never
   paints it, so the right-hand end of the scale is drawn explicitly. */
.fsig-ruler::before,
.fsig-ruler::after {
  content: "";
  position: absolute;
  top: 0;
  width: 1px;
  height: 11px;
  background: var(--text);
}
.fsig-ruler::before { left: 0; }
.fsig-ruler::after { right: 0; }

.fsig-scale {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.1em;
  color: var(--text-muted);
}

/* --- THE CHANNELS ------------------------------------------------------- */

.fsig-lanes {
  position: relative;
  z-index: 3;
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
}

.fsig-lane { padding-top: 10px; }
.fsig-lane + .fsig-lane { margin-top: 2px; }

.fsig-cap {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) 84px 116px;
  gap: 0 12px;
  align-items: baseline;
}

/* The column heads. Same grid, so a head always sits over its own column.

   position/z-index are load-bearing, not tidiness. A positioned element with
   z-index 0 - which is what the sub-limit region is - paints ABOVE in-flow
   non-positioned content, so without this the region silently covered the two
   heads that fall to the left of the limit and left the other two showing. */
.fsig-caphead {
  position: relative;
  z-index: 1;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--hairline);
}

.fsig-caphead > span {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}

/* The record number, in the identity ink and padded to four, exactly as the
   docket prints it - the same record, addressed the same way. */
.fsig-n {
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  color: var(--accent);
}

/* A human wrote this as a phrase, so it takes the prose face. It is also the
   only elastic cell in the row, so it is the one that clips - structurally,
   via min-width 0 on a minmax(0,1fr) track, so a long title can never widen
   the grid and push the page sideways. */
.fsig-title {
  min-width: 0;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fsig-read {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--text);
}

/* An absent reading is stated, never implied by a blank cell. */
.fsig-read--nil { color: var(--text-muted); }

.fsig-ruling {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  justify-self: end;
  font-family: var(--font-mono);
  font-size: 10px;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  white-space: nowrap;
}

/* The shape channel. A disc and a ring are the two curves this system's status
   vocabulary allows; every BOX in the footer is still radius 0. */
.fsig-glyph {
  flex: none;
  width: 9px;
  height: 9px;
  background: currentColor;
}

.fsig-lane--settled .fsig-ruling { color: var(--positive); }
.fsig-lane--settled .fsig-glyph { border-radius: 50%; }

.fsig-lane--refunded .fsig-ruling { color: var(--negative); }

.fsig-lane--held .fsig-ruling { color: var(--warning); }
.fsig-lane--held .fsig-glyph {
  border: 2px solid currentColor;
  border-radius: 50%;
  background: none;
}

/* Nothing is WRONG with a record that has not been judged, so it stays
   achromatic and its shape is a flat bar: no reading taken. */
.fsig-lane--open .fsig-glyph,
.fsig-lane--submitted .fsig-glyph {
  height: 3px;
  align-self: center;
}

/* --- THE TRACK ---------------------------------------------------------- */

.fsig-track {
  position: relative;
  height: 22px;
  margin-top: 4px;
}

.fsig-track::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: 1px solid var(--hairline);
}

/* Dashed means inferred, product-wide. A held matter is a hypothesis the
   system refused to act on, so its channel is drawn as one. */
.fsig-lane--held .fsig-track::before { border-top-style: dashed; }

/* THE READING. A recorder tick through a status shape, standing at the exact
   confidence the judge returned. */
.fsig-mark {
  position: absolute;
  top: 50%;
  left: var(--fsig-at);
  width: 11px;
  height: 11px;
  margin: -6px 0 0 -6px;
  background: currentColor;
  color: var(--text-muted);
}

.fsig-mark::before {
  content: "";
  position: absolute;
  left: 5px;
  top: -6px;
  bottom: -6px;
  width: 1px;
  background: currentColor;
}

.fsig-lane--settled .fsig-mark { color: var(--positive); border-radius: 50%; }
.fsig-lane--refunded .fsig-mark { color: var(--negative); }
.fsig-lane--held .fsig-mark {
  color: var(--warning);
  border: 2px solid currentColor;
  border-radius: 50%;
  background: none;
}

/* The empty channel, and the whole point of the drawing. Left-aligned inside
   the sub-limit region so it always sits on --sunk, where --text-muted
   measures 6.44:1, and always clear of the limit rule. */
.fsig-nil {
  position: absolute;
  top: 50%;
  left: 8px;
  transform: translateY(-50%);
  font-family: var(--font-mono);
  font-size: 10px;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  white-space: nowrap;
}

/* --- WHAT THE LINE MEANS ------------------------------------------------ */

.fsig-say {
  margin: 26px 0 0;
  max-width: 66ch;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.55;
  color: var(--text-2);
}

.fsig-note {
  margin: 10px 0 0;
  max-width: 74ch;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
}

/* --- THE RANGE RAIL ----------------------------------------------------- */

.fsig-rail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin-top: 26px;
  padding-top: 14px;
  border-top: 1px solid var(--hairline);
}

.fsig-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 22px;
}

.fsig-links a {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  text-decoration: none;
  border-bottom: 1px solid transparent;
}

.fsig-links a:hover {
  color: var(--text);
  border-bottom-color: var(--accent);
}

/* An instrument states its range. Both figures mirror the Anchor program. */
.fsig-range {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}

/* --- NARROW -------------------------------------------------------------
   The caption is four fixed-ish columns, which is right on a desk and
   impossible at 375px. Below 620px it becomes two lines - the number, the
   reading and the ruling on the first, the title on the second, where it is
   allowed to wrap rather than clip. The column heads go, because they no
   longer sit above anything, and every value stays self-describing.
   ----------------------------------------------------------------------- */

@media (max-width: 620px) {
  .fsig-caphead { display: none; }

  .fsig-cap {
    grid-template-columns: 54px minmax(0, 1fr) auto;
    gap: 3px 10px;
  }
  .fsig-cap > .fsig-n { grid-area: 1 / 1; }
  .fsig-cap > .fsig-read { grid-area: 1 / 2; }
  .fsig-cap > .fsig-ruling { grid-area: 1 / 3; }
  .fsig-cap > .fsig-title {
    grid-area: 2 / 1 / 3 / 4;
    white-space: normal;
    overflow: visible;
  }
}

@media (max-width: 700px) {
  .fsig-inner { padding: 26px 16px 22px; }
  .fsig-tagline { font-size: 14px; }
  .fsig-say { font-size: 14px; }
}

/* A phone is touched, not pointed at. Gated on pointer type rather than width
   alone, so a tablet in portrait is covered too. These links are standalone
   controls in a rail, not words inside a sentence, so none of them takes the
   WCAG 2.5.8 prose exemption. */
@media (max-width: 760px), (pointer: coarse) {
  .fsig-links a,
  .fsig-name {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
}
`;

/* ==========================================================================
   COMPONENT
   ========================================================================== */

export interface FooterSignatureProps {
  /**
   * The pass limit this deployment actually gates on, 0-100.
   *
   * A prop rather than a constant so a server component can pass down the real
   * `CONFIDENCE_THRESHOLD`. The default is the documented one from
   * lib/constants.ts, which is the only place that number is written down in
   * the web app.
   */
  threshold?: number;
}

export function FooterSignature({
  threshold = DEFAULT_CONFIDENCE_THRESHOLD,
}: FooterSignatureProps = {}) {
  // Clamped before it is drawn. A limit outside 0-100 has no position on this
  // scale, and a plot running off its own axis would be worse than no plot.
  const limit = Math.min(100, Math.max(0, Math.round(threshold)));

  const plotVars = { "--fsig-limit": `${limit}%` } as CSSProperties;

  return (
    <footer className="fsig">
      <style>{FSIG_CSS}</style>

      <div className="fsig-inner">
        <div className="fsig-head">
          <Link className="fsig-name" href="/">
            RUBRIC
          </Link>
          <p className="fsig-tagline">{TAGLINE}</p>
        </div>

        <section aria-labelledby={HEADING_ID}>
          <div className="fsig-plothead">
            <h2 className="fsig-h" id={HEADING_ID}>
              The pass limit
            </h2>
            <span className="fsig-provenance">
              SAMPLE DOCKET · {LANES.length} RECORDS · {JUDGED} JUDGED
            </span>
          </div>

          <div className="fsig-plot" style={plotVars}>
            {/* Geometry. Every word it could carry is printed as real text
                elsewhere in this block, so none of it is announced. */}
            <div className="fsig-region" aria-hidden="true" />
            <div className="fsig-limit" aria-hidden="true" />
            <div className="fsig-flag" aria-hidden="true">
              PASS LIMIT {limit}
            </div>
            <div className="fsig-ruler" aria-hidden="true" />

            <div className="fsig-scale" aria-hidden="true">
              <span>0</span>
              <span>CONFIDENCE</span>
              <span>100</span>
            </div>

            <div className="fsig-cap fsig-caphead" aria-hidden="true">
              <span>Record</span>
              <span>Matter</span>
              <span>Reading</span>
              <span style={{ justifySelf: "end" }}>Ruling</span>
            </div>

            <ol className="fsig-lanes">
              {LANES.map((lane) => {
                const measured = lane.confidence !== null;
                const markVars = measured
                  ? ({ "--fsig-at": `${lane.confidence}%` } as CSSProperties)
                  : undefined;

                return (
                  <li
                    key={lane.n}
                    className={`fsig-lane fsig-lane--${lane.state.toLowerCase()}`}
                  >
                    <div className="fsig-cap">
                      <span className="fsig-n">{lane.n}</span>
                      <span className="fsig-title">{lane.title}</span>
                      <span
                        className={
                          measured ? "fsig-read" : "fsig-read fsig-read--nil"
                        }
                      >
                        {measured ? `CONF ${lane.confidence}` : "NO CONF"}
                      </span>
                      <span className="fsig-ruling">
                        <span className="fsig-glyph" aria-hidden="true" />
                        {RULING[lane.state]}
                      </span>
                    </div>

                    {/* The channel. The reading is already stated as a figure
                        in the row above, so the drawing adds nothing a reader
                        could only get by looking at it. */}
                    <div className="fsig-track" aria-hidden="true">
                      {measured ? (
                        <span className="fsig-mark" style={markVars} />
                      ) : (
                        <span className="fsig-nil">NO READING</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <p className="fsig-say">
            Below the line the escrow is untouched and a person reviews the
            matter. At or above it the verdict executes on-chain: approve pays
            the worker, reject refunds the poster.
          </p>

          {/* No figure in this sentence, deliberately. The counts belong to
              the mono provenance line above, where they are read as data and
              are derived from the records rather than typed out - a hand-written
              "two of five" here would be a fact that stops being true the
              moment the docket changes. */}
          <p className="fsig-note">
            Readings come from the sample docket this build ships with. The
            records that have not been judged carry no mark on their channel —
            the instrument does not plot a measurement it has not taken.
          </p>
        </section>

        <div className="fsig-rail">
          <nav className="fsig-links" aria-label="Rubric">
            <Link href="/docket">Docket</Link>
            <Link href="/create">Seal a rubric</Link>
            <Link href="/my-work">My work</Link>
          </nav>
          <span className="fsig-range">
            USDC escrow on Solana · Max bounty {MAX_BOUNTY_USDC} USDC · Protocol
            fee {FEE_PERCENT_LABEL}
          </span>
        </div>
      </div>
    </footer>
  );
}

export default FooterSignature;
