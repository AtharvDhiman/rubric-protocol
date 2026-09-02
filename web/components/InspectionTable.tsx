/**
 * The per-clause inspection table on /task/[id].
 *
 * Columns: Nº | RULING | OUTTOL | STATUS, plus a Σ row that states the
 * consequence. This is the artefact the whole product exists to publish, so a
 * few properties are load-bearing rather than stylistic:
 *
 * 1. IT SERVER-RENDERS COMPLETE, AND IT NEVER WAITS.
 *    This is a server component. There is no "use client", no state, no effect
 *    and no rAF anywhere in this file. Every STATUS cell, every OUTTOL cell and
 *    the Σ row are in the HTML at first byte. That means the finished verdict is
 *    what a crawler sees, what renders with JavaScript blocked, what survives a
 *    hydration failure, and what an assistive technology reads at parse time.
 *    The inspection arm animates OVER this table (see the DOM contract below);
 *    the table does not animate itself and does not depend on the arm existing.
 *    Every other approach — build-up, skeleton rows, an aria-live region that
 *    fills in — makes "did I get paid" conditional on a rAF loop, and that is
 *    the single largest risk on this screen.
 *
 * 2. STATUS SURVIVES GREYSCALE AND COLOUR BLINDNESS.
 *    --negative against --positive is 1.04:1 and --negative against --text is
 *    2.55:1, so colour on its own conveys nothing here. Every state therefore
 *    carries four independent channels: the WORD (PASS / FAIL / ——), a SHAPE
 *    (filled disc / filled square / hollow ring), an INTEGER (OUTTOL 0 / 1 / ——)
 *    and a RULE WEIGHT (1px hairline / 2px --negative / 1px dashed). Colour is
 *    the fourth channel, never the first.
 *
 * 3. A REJECTION CITES ITS CLAUSE, OR THE HOLE IS VISIBLE.
 *    "Every rejection must cite a specific sealed clause. A rejection that
 *    cannot cite a clause is a bug." So the citation is a coordinate: the
 *    failing row carries its own Nº, and the Σ row names the first blocking
 *    clause in full. If a record is REFUNDED with no failing clause, the Σ row
 *    says so in the alarm colour rather than quietly printing a total. A missing
 *    citation is rendered as a hole, never smoothed over.
 *
 * 4. GREEN IS NOT THE COLOUR OF A PASS.
 *    A passing clause is ink. --positive is reserved for the one place per
 *    screen where the chain actually moved money, which on this page is the
 *    receipt — so the Σ row's RELEASED is --text, not green. An acceptable
 *    state is achromatic and the marks you were looking for are the only
 *    coloured things on the sheet.
 *
 * 5. THIS IS A LIGHT-PLATE COMPONENT.
 *    It lives on the metrology plate, never inside a `.volume`. The volume-only
 *    tokens (--marker, --rig-line, --rig-solved, --v-*, --d-*, --ghost-vol,
 *    --grid) are FORBIDDEN in this file: --marker measures 1.26:1 on --page.
 *    Only the light family is used below.
 *
 * ---------------------------------------------------------------------------
 * DOM CONTRACT FOR THE RIG THAT ANNOTATES THIS TABLE
 * ---------------------------------------------------------------------------
 * The arm owns the choreography; this table owns the truth. The arm may rewind
 * and re-register cells by writing to the DOM, and everything it needs to do
 * that — including how to put the table back — is already in the markup, so the
 * arm never needs the verdict object and its watchdog never needs to re-render.
 *
 *   [data-inspection-table]      the root element
 *     data-clause-count          integer, how many rows exist
 *     data-verdict               "1" when a verdict exists, "0" when none does
 *
 *   tr[data-clause-index]        one per clause, ZERO-BASED, matching
 *                                ClauseRuling.index from the verifier
 *     data-status                LIVE value: "PASS" | "FAIL" | "PENDING".
 *                                All visual state keys off this attribute, so
 *                                setting it is enough to change the shape mark,
 *                                the rule weight and the colour.
 *     data-final-status          the terminal value. NEVER mutate this.
 *     data-final-outtol          the terminal OUTTOL text. NEVER mutate this.
 *     data-blocking="1"          on the FIRST failing row — where the arm parks
 *
 *   [data-datum]                 the 5px datum dot on the row's left edge; this
 *                                is the point the probe tip actually touches.
 *   [data-status-text]           the span whose textContent is the status word
 *   [data-outtol-text]           the span whose textContent is the OUTTOL figure
 *   tr[data-sigma]               the Σ row (absent when there is no verdict)
 *     id                         `sigmaRowId(tableId)`, exported below, so the
 *                                arm's `sigmaRowId` prop can park an all-pass
 *                                run exactly on the total
 *     data-cited-clause          the padded Nº of the blocking clause, if any
 *
 * To rewind a row:  set data-status="PENDING" and write NOT_RULED into both
 *                   text spans.
 * To register it:   copy data-final-status / data-final-outtol back into them
 *                   and restore data-status from data-final-status.
 * The 6 s watchdog is therefore a loop over rows copying two attributes — it
 * cannot desynchronise from the verdict because it reads the verdict's own
 * server-rendered values.
 *
 * A rig may report beats through `onRegister(index, passed)` and
 * `onRewind()` rather than reaching in here itself, so the wiring is a handful
 * of lines in a small client wrapper that does the two attribute copies above.
 * Deliberately NOT React state: a parent that re-rendered this table per beat
 * would make the finished sheet conditional on the animation completing, which
 * is the one failure mode this component exists to rule out. If that wrapper is
 * never written, the table is already correct and complete — which is the
 * point.
 */

/** The six states the schema can hold. Prisma's enum and lib/demo's both assign. */
export type InspectionTaskState =
  | "PENDING"
  | "OPEN"
  | "SUBMITTED"
  | "HELD"
  | "SETTLED"
  | "REFUNDED";

/** One per-clause ruling, exactly as `ClauseRulingSchema` in lib/verifier.ts. */
export interface InspectionRuling {
  /** Zero-based index of the clause this ruling is about. */
  index: number;
  passed: boolean;
  reason: string;
}

/**
 * What an unmeasured cell prints. Two em dashes, not a zero: OUTTOL 0 is a
 * measurement that says "this clause blocks nothing", and printing it before
 * the judge has ruled would assert a result that does not exist. An OPEN task
 * has no verdict, so it gets no integers and no Σ row.
 */
export const NOT_RULED = "——";

type RowStatus = "PASS" | "FAIL" | "PENDING";

type SigmaState = "RELEASED" | "BLOCKED" | "HELD" | "UNDECIDED" | "ANOMALY";

export interface InspectionRow {
  /** Zero-based, matching the sealed clause order and the ruling index. */
  index: number;
  /** The displayed clause number, zero-padded: "01". */
  n: string;
  /** The RULING column: the judge's reason, or the sealed clause when unruled. */
  ruling: string;
  status: RowStatus;
  /** "0", "1", or NOT_RULED. Binary by construction; never three decimals. */
  outtol: string;
  /** True on the FIRST failing clause — the one the escrow is blocked at. */
  blocking: boolean;
  /** What a screen reader hears in place of the shape and the colour. */
  speech: string;
}

export interface InspectionSummary {
  rows: InspectionRow[];
  /** False for OPEN / SUBMITTED: no STATUS integers and no Σ row. */
  hasVerdict: boolean;
  /** Count of failing clauses. Null when there is no verdict. */
  sigma: number | null;
  /** The first failing row, which is the clause a rejection must cite. */
  firstFailure: InspectionRow | null;
  sigmaState: SigmaState;
  /** The terminal word in the Σ row's STATUS cell. */
  sigmaWord: string;
  /** The Σ row's RULING cell: what the total actually meant for the escrow. */
  sigmaNote: string;
  /** True only when the chain moved money. Drives the --raised plate. */
  onchain: boolean;
  /** The whole Σ statement as one sentence, for assistive technology. */
  sigmaSpeech: string;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * The DOM id of the Σ row, so a caller can hand it straight to
 * a rig's `sigmaRowId` prop, so an all-pass run can park exactly on
 * the total rather than at the foot of the rail. Derived rather than guessed:
 * the arm and the table must agree on this string or the park lands nowhere.
 */
export const sigmaRowId = (tableId = "inspection"): string =>
  `${tableId}-sigma`;

/**
 * Derive everything the table shows from the sealed clauses, the rulings and
 * the on-chain state. Exported and pure so the arm, a test, or a future
 * summary line can reuse the same derivation rather than re-deriving OUTTOL
 * and getting a different answer.
 *
 * Rulings are matched to clauses BY INDEX, not by array position. A short,
 * reordered or duplicated ruling array then leaves a visible PENDING row
 * instead of silently shifting every reason onto the wrong clause — which on a
 * sheet whose whole claim is "this reasoning belongs to that sealed clause"
 * would be the worst possible failure mode.
 */
export function summariseInspection(
  clauses: readonly string[],
  rulings: readonly InspectionRuling[] | null | undefined,
  state: InspectionTaskState
): InspectionSummary {
  const byIndex = new Map<number, InspectionRuling>();
  for (const ruling of rulings ?? []) {
    // Last write wins, but a duplicate index is already a malformed verdict;
    // the row it displaces surfaces as PENDING, which is the visible hole.
    if (Number.isInteger(ruling.index)) byIndex.set(ruling.index, ruling);
  }

  const hasVerdict = byIndex.size > 0;

  const rows: InspectionRow[] = clauses.map((clause, i) => {
    const ruling = byIndex.get(i);
    const n = pad2(i + 1);

    if (!ruling) {
      return {
        index: i,
        n,
        // With no ruling there is no reason to show, so the column shows the
        // sealed clause itself: the row exists because the clause exists.
        ruling: clause,
        status: "PENDING",
        outtol: NOT_RULED,
        blocking: false,
        speech: `Clause ${n} has not been ruled on.`,
      };
    }

    const status: RowStatus = ruling.passed ? "PASS" : "FAIL";
    return {
      index: i,
      n,
      ruling: ruling.reason,
      status,
      // OUTTOL is derived deterministically from the boolean the schema
      // actually returns: a passing clause blocks 0 of the escrow, a failing
      // one blocks 1. It is not a measurement and is not dressed up as one.
      outtol: ruling.passed ? "0" : "1",
      blocking: false,
      speech: ruling.passed
        ? `Clause ${n} passed. Out of tolerance 0.`
        : `Clause ${n} failed. Out of tolerance 1. This clause blocks the escrow.`,
    };
  });

  // The blocking clause is the FIRST failing one: the coordinate a rejection
  // has to cite, and the row the inspection arm drives back up to and parks at.
  // Flagged after the map rather than inside it so there is exactly one place
  // that decides which clause is the citation.
  const cited: InspectionRow | null = rows.find((r) => r.status === "FAIL") ?? null;
  if (cited) cited.blocking = true;

  if (!hasVerdict) {
    return {
      rows,
      hasVerdict: false,
      sigma: null,
      firstFailure: null,
      sigmaState: "UNDECIDED",
      sigmaWord: "",
      sigmaNote: "",
      onchain: false,
      sigmaSpeech: "",
    };
  }

  const sigma = rows.filter((r) => r.status === "FAIL").length;

  let sigmaState: SigmaState;
  let sigmaWord: string;
  let sigmaNote: string;
  let onchain: boolean;

  if (state === "SETTLED") {
    onchain = true;
    sigmaWord = "RELEASED";
    if (sigma === 0) {
      sigmaState = "RELEASED";
      sigmaNote = "ALL CLAUSES WITHIN TOLERANCE";
    } else {
      // Approved with a failing clause contradicts the protocol's own rule
      // that `approved` is true only if every clause passed. Say so on the
      // sheet rather than printing a tidy total over the top of it.
      sigmaState = "ANOMALY";
      sigmaNote = `INCONSISTENT · CLAUSE ${cited?.n ?? "??"} FAILED`;
    }
  } else if (state === "REFUNDED") {
    onchain = true;
    sigmaWord = "REFUNDED";
    if (cited) {
      sigmaState = "BLOCKED";
      sigmaNote = `BLOCKED AT CLAUSE ${cited.n}`;
    } else {
      // The stated product invariant, enforced in the render: a rejection that
      // cannot name a clause is a bug, and it is shown as one.
      sigmaState = "ANOMALY";
      sigmaNote = "NO CLAUSE CITED · RECORD INCOMPLETE";
    }
  } else if (state === "HELD") {
    // Held is not rejected. Nobody was paid and nobody was refunded, so the Σ
    // row must not claim either, and it never gets the --raised on-chain plate.
    onchain = false;
    sigmaState = "HELD";
    sigmaWord = "HELD";
    sigmaNote = cited
      ? `ESCROW UNTOUCHED · BLOCKED AT CLAUSE ${cited.n}`
      : "ESCROW UNTOUCHED · BELOW CONFIDENCE THRESHOLD";
  } else {
    // A verdict exists but the settle transaction has not landed. Real, and
    // briefly visible; the escrow has not moved, so nothing is claimed.
    onchain = false;
    sigmaState = "UNDECIDED";
    sigmaWord = "UNDECIDED";
    sigmaNote = "VERDICT RECORDED · ESCROW UNTOUCHED";
  }

  // The screen copy is set in caps because mono chrome is caps in this system.
  // A screen reader would spell caps out letter by letter on some voices, so
  // the spoken version of the Σ statement is rebuilt as an ordinary sentence.
  const spoken = (caps: string): string => {
    const lower = caps.replace(/ · /g, ", ").toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  const sigmaSpeech =
    `Total out of tolerance: ${sigma} of ${rows.length} ` +
    `${rows.length === 1 ? "clause" : "clauses"}. ` +
    `${spoken(sigmaWord)}: ${spoken(sigmaNote)}.`;

  return {
    rows,
    hasVerdict: true,
    sigma,
    firstFailure: cited,
    sigmaState,
    sigmaWord,
    sigmaNote,
    onchain,
    sigmaSpeech,
  };
}

export interface InspectionTableProps {
  /** The sealed clause text, in clause order. One row per clause, always. */
  clauses: readonly string[];
  /** The judge's per-clause rulings, or null when nothing has been judged. */
  rulings?: readonly InspectionRuling[] | null;
  /** The on-chain state. Decides what the Σ row is allowed to claim. */
  state: InspectionTaskState;
  /** Only needed if two inspection tables ever share one page. */
  id?: string;
}

export function InspectionTable({
  clauses,
  rulings = null,
  state,
  id = "inspection",
}: InspectionTableProps) {
  const model = summariseInspection(clauses, rulings, state);
  const captionId = `${id}-caption`;

  // A sealed task always has between one and eight clauses. Zero means the
  // record itself is broken, and a table with no rows would hide that.
  if (model.rows.length === 0) {
    return (
      <div className="itbl" data-inspection-table data-clause-count={0} data-verdict={0}>
        <style href="rubric-inspection-table" precedence="medium">
          {CSS}
        </style>
        <p className="itbl__empty data">NO SEALED CLAUSES · RECORD INCOMPLETE</p>
      </div>
    );
  }

  return (
    <div
      className="itbl"
      data-inspection-table
      data-clause-count={model.rows.length}
      data-verdict={model.hasVerdict ? 1 : 0}
    >
      {/* React hoists this into <head> and dedupes it by href, so the rules
          ship with the server render and never arrive after first paint. */}
      <style href="rubric-inspection-table" precedence="medium">
        {CSS}
      </style>

      {/* Explicit ARIA roles are NOT redundant here. Below 620px the rows
          become a CSS grid so the RULING column can stack, and a browser drops
          the implicit table semantics the moment `display` stops being a
          table-* value. Stating the roles keeps the sheet a table for a screen
          reader at every width. */}
      <table className="itbl__table" role="table" aria-labelledby={captionId}>
        <caption id={captionId} className="itbl-sr">
          Per-clause inspection. Each row gives the clause number, the judge&rsquo;s
          ruling, an out-of-tolerance count of 0 or 1, and a status of pass or
          fail.
        </caption>

        {/* Fixed widths, in pixels. Martian Mono is a wide face and now sets
            most of the glyphs on this page; a percentage or ch-based grid would
            reflow if the width axis failed to load, and a reflowing table stops
            lining up with the arm that annotates it. */}
        <colgroup>
          <col className="itbl__col--n" />
          <col className="itbl__col--ruling" />
          <col className="itbl__col--outtol" />
          <col className="itbl__col--status" />
        </colgroup>

        <thead role="rowgroup">
          <tr role="row" className="itbl__headrow">
            <th role="columnheader" scope="col" className="itbl__th itbl__th--n label">
              N&ordm;
            </th>
            <th
              role="columnheader"
              scope="col"
              className="itbl__th itbl__th--ruling label"
            >
              RULING
            </th>
            <th
              role="columnheader"
              scope="col"
              className="itbl__th itbl__th--outtol label"
            >
              OUTTOL
            </th>
            <th
              role="columnheader"
              scope="col"
              className="itbl__th itbl__th--status label"
            >
              STATUS
            </th>
          </tr>
        </thead>

        <tbody role="rowgroup">
          {model.rows.map((row) => (
            <tr
              key={row.index}
              role="row"
              className="itbl__row"
              data-clause-index={row.index}
              data-status={row.status}
              data-final-status={row.status}
              data-final-outtol={row.outtol}
              {...(row.blocking ? { "data-blocking": "1" } : {})}
            >
              <td role="cell" className="itbl__cell itbl__cell--n">
                {/* The datum. The probe tip lands on this exact dot, so it is a
                    real element with a real box the arm can measure, not a
                    ::before the arm would have to guess the position of. */}
                <span className="itbl__datum" data-datum aria-hidden="true" />
                <span className="data itbl__n">{row.n}</span>
              </td>

              <td role="cell" className="itbl__cell itbl__cell--ruling">
                {row.ruling}
              </td>

              <td role="cell" className="itbl__cell itbl__cell--outtol">
                <span className="data itbl__outtol" data-outtol-text>
                  {row.outtol}
                </span>
              </td>

              <td role="cell" className="itbl__cell itbl__cell--status">
                <span className="itbl__status">
                  {/* Channel two: shape. Filled disc = pass, filled square =
                      fail, hollow ring = not ruled. Readable in greyscale, and
                      readable to a deuteranope, with the colour removed. */}
                  <span className="itbl__mark" aria-hidden="true" />
                  <span className="data itbl__status-word" data-status-text>
                    {row.status === "PENDING" ? NOT_RULED : row.status}
                  </span>
                </span>
                <span className="itbl-sr">{row.speech}</span>
              </td>
            </tr>
          ))}
        </tbody>

        {/* No verdict, no Σ row. A total over rows that were never ruled on
            would be an invented measurement. */}
        {model.hasVerdict && model.sigma !== null && (
          <tfoot role="rowgroup">
            <tr
              id={sigmaRowId(id)}
              role="row"
              className="itbl__sigma"
              data-sigma
              data-sigma-state={model.sigmaState}
              data-onchain={model.onchain ? "1" : "0"}
              {...(model.firstFailure
                ? { "data-cited-clause": model.firstFailure.n }
                : {})}
            >
              <td role="cell" className="itbl__cell itbl__cell--n">
                <span className="data itbl__n itbl__sigma-glyph" aria-hidden="true">
                  &Sigma;
                </span>
              </td>

              {/* The consequence, in the widest column and right-aligned so it
                  butts against the total it explains. This is where the
                  citation is spelled out: "BLOCKED AT CLAUSE 02". */}
              <td role="cell" className="itbl__cell itbl__cell--ruling">
                <span className="data itbl__sigma-note">{model.sigmaNote}</span>
              </td>

              <td role="cell" className="itbl__cell itbl__cell--outtol">
                <span className="data itbl__outtol itbl__sigma-total">
                  {model.sigma}
                </span>
              </td>

              <td role="cell" className="itbl__cell itbl__cell--status">
                <span className="data itbl__sigma-word">{model.sigmaWord}</span>
                <span className="itbl-sr">{model.sigmaSpeech}</span>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * Every rule is prefixed with `.itbl` so it carries at least two class
 * selectors' worth of specificity. That makes the sheet independent of whether
 * React hoists it above or below globals.css — nothing here can be beaten by a
 * single-class utility such as `.data`, and nothing here reaches outside the
 * table to affect anything else.
 */
const CSS = `
.itbl { margin: 0; }

/* A screen-reader-only utility, defined locally on purpose: two components in
   this repo use the class name sr-only, but globals.css never defines it, so
   any text relying on it is currently visible. This component owns its own. */
.itbl .itbl-sr,
.itbl caption.itbl-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  white-space: nowrap;
  clip-path: inset(50%);
  border: 0;
}

.itbl .itbl__table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 14px;
}

.itbl .itbl__col--n      { width: 44px; }
.itbl .itbl__col--outtol { width: 72px; }
.itbl .itbl__col--status { width: 104px; }

/* ---- column heads ---------------------------------------------------- */

.itbl .itbl__th {
  padding: 0 8px 8px 0;
  text-align: left;
  vertical-align: bottom;
  white-space: nowrap;
  border-bottom: 1px solid var(--border);
}
.itbl .itbl__th--outtol { text-align: right; padding-right: 12px; }
.itbl .itbl__th--n      { padding-left: 14px; }

/* ---- body rows -------------------------------------------------------- */

.itbl .itbl__cell {
  padding: 12px 8px 12px 0;
  vertical-align: top;
  border-bottom: 1px solid var(--hairline);
}

.itbl .itbl__cell--n {
  position: relative;
  padding-left: 14px;
  white-space: nowrap;
}

.itbl .itbl__cell--ruling {
  /* Prose. The judge wrote this as a sentence, so it takes the sans face that
     the body already sets; every figure in the row is mono. */
  color: var(--text-2);
  line-height: 1.5;
}

.itbl .itbl__cell--outtol { text-align: right; padding-right: 12px; }
.itbl .itbl__cell--status { white-space: nowrap; }

/* The datum dot the probe touches. --accent is the identity ink, the same one
   the clause numbers take, which is what makes the dot read as "this clause"
   rather than as a bullet. */
.itbl .itbl__datum {
  position: absolute;
  left: 0;
  top: 18px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}

.itbl .itbl__n {
  font-size: 13px;
  color: var(--accent);
}

.itbl .itbl__outtol {
  font-size: 13px;
  color: var(--text);
}

.itbl .itbl__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* Channel two. Radius 0 is the system-wide rule for BOXES; the disc and the
   ring here are a shape channel carrying status, not a rounded corner. */
.itbl .itbl__mark {
  flex: none;
  width: 8px;
  height: 8px;
}

.itbl .itbl__status-word {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
}

/* PASS — filled disc, and the word in INK. A passing clause is not an event;
   green in this system means the chain moved money and nothing else. */
.itbl .itbl__row[data-status="PASS"] .itbl__mark {
  background: var(--text);
  border-radius: 50%;
}
.itbl .itbl__row[data-status="PASS"] .itbl__status-word { color: var(--text); }

/* FAIL — filled square, the alarm ink, a doubled 2px row rule and a non-zero
   integer. Four channels; remove any three and the row still reads as failed. */
.itbl .itbl__row[data-status="FAIL"] .itbl__mark {
  background: var(--negative);
  border-radius: 0;
}
.itbl .itbl__row[data-status="FAIL"] .itbl__status-word { color: var(--negative); }
.itbl .itbl__row[data-status="FAIL"] .itbl__outtol {
  color: var(--negative);
  font-weight: 600;
}
.itbl .itbl__row[data-status="FAIL"] > .itbl__cell {
  border-bottom: 2px solid var(--negative);
}

/* PENDING — hollow ring and a DASHED rule. Dotted is hypothesis and solid is
   measurement, everywhere in this product; nothing has been measured here. */
.itbl .itbl__row[data-status="PENDING"] .itbl__mark {
  background: transparent;
  border: 1px solid var(--text-muted);
  border-radius: 50%;
}
.itbl .itbl__row[data-status="PENDING"] .itbl__status-word,
.itbl .itbl__row[data-status="PENDING"] .itbl__outtol {
  color: var(--text-muted);
}
.itbl .itbl__row[data-status="PENDING"] > .itbl__cell {
  border-bottom-style: dashed;
}

/* ---- the sigma row ---------------------------------------------------- */

.itbl .itbl__sigma > .itbl__cell {
  padding-top: 16px;
  padding-bottom: 12px;
  /* An accounting underline beneath the total. The rule ABOVE it is the last
     body row's own bottom border, which is why nothing is drawn here for it —
     two adjacent rules would just be a thick smudge. */
  border-top: none;
  border-bottom: 2px solid var(--rule-strong);
}

.itbl .itbl__sigma-glyph { color: var(--text); }

.itbl .itbl__sigma-note {
  display: block;
  text-align: right;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.itbl .itbl__sigma-total {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.itbl .itbl__sigma-word {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text);
}

/* The escrow actually moved, so the Σ row sits on the --raised plate that
   means "committed on-chain" everywhere else in the product. HELD deliberately
   does not get it: nothing was committed. */
.itbl .itbl__sigma[data-onchain="1"] > .itbl__cell { background: var(--raised); }

.itbl .itbl__sigma[data-sigma-state="BLOCKED"] > .itbl__cell,
.itbl .itbl__sigma[data-sigma-state="ANOMALY"] > .itbl__cell {
  border-bottom-color: var(--negative);
}
.itbl .itbl__sigma[data-sigma-state="BLOCKED"] .itbl__sigma-word,
.itbl .itbl__sigma[data-sigma-state="BLOCKED"] .itbl__sigma-note,
.itbl .itbl__sigma[data-sigma-state="BLOCKED"] .itbl__sigma-total,
.itbl .itbl__sigma[data-sigma-state="ANOMALY"] .itbl__sigma-word,
.itbl .itbl__sigma[data-sigma-state="ANOMALY"] .itbl__sigma-note,
.itbl .itbl__sigma[data-sigma-state="ANOMALY"] .itbl__sigma-total {
  color: var(--negative);
}

/* Held is unresolved, not failed, so it takes the cold blue and the dashed
   rule rather than the alarm. The escrow is untouched and the sheet says so. */
.itbl .itbl__sigma[data-sigma-state="HELD"] > .itbl__cell,
.itbl .itbl__sigma[data-sigma-state="UNDECIDED"] > .itbl__cell {
  border-bottom: 1px dashed var(--warning);
}
.itbl .itbl__sigma[data-sigma-state="HELD"] .itbl__sigma-word,
.itbl .itbl__sigma[data-sigma-state="HELD"] .itbl__sigma-note,
.itbl .itbl__sigma[data-sigma-state="UNDECIDED"] .itbl__sigma-word,
.itbl .itbl__sigma[data-sigma-state="UNDECIDED"] .itbl__sigma-note {
  color: var(--warning);
}

/* ---- the broken-record case ------------------------------------------ */

.itbl .itbl__empty {
  margin: 0;
  padding: 12px 0;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--negative);
  border-top: 1px solid var(--border);
  border-bottom: 2px solid var(--negative);
}

/* ---- mobile ------------------------------------------------------------
   Below 620px the RULING column becomes a stacked line above each row and the
   grid drops to Nº | OUTTOL | STATUS. Width, not pointer type: a coarse
   pointer on a 1024px tablet has room for four columns, and stacking it there
   would throw away the scan the column exists for. The header keeps the same
   three tracks so the figures below still line up under their labels.
   ---------------------------------------------------------------------- */

@media (max-width: 620px) {
  .itbl .itbl__table,
  .itbl .itbl__table > thead,
  .itbl .itbl__table > tbody,
  .itbl .itbl__table > tfoot {
    display: block;
  }

  .itbl .itbl__headrow,
  .itbl .itbl__row,
  .itbl .itbl__sigma {
    display: grid;
    grid-template-columns: 44px 1fr 104px;
    grid-template-areas:
      "ruling ruling ruling"
      "n      outtol status";
    align-items: baseline;
    column-gap: 8px;
  }

  .itbl .itbl__headrow {
    grid-template-areas: "n outtol status";
  }

  /* Clipped rather than display:none, so the column head stays in the
     accessibility tree and the stacked line still has a header to belong to. */
  .itbl .itbl__th--ruling {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    white-space: nowrap;
    clip-path: inset(50%);
    border: 0;
    padding: 0;
  }

  .itbl .itbl__cell--n,
  .itbl .itbl__th--n { grid-area: n; }
  .itbl .itbl__cell--ruling,
  .itbl .itbl__th--ruling { grid-area: ruling; }
  .itbl .itbl__cell--outtol,
  .itbl .itbl__th--outtol { grid-area: outtol; }
  .itbl .itbl__cell--status,
  .itbl .itbl__th--status { grid-area: status; }

  /* The row's rule now belongs to the row, not to four separate cells. */
  .itbl .itbl__row > .itbl__cell,
  .itbl .itbl__sigma > .itbl__cell {
    border-bottom: none;
    border-top: none;
    background: none;
    padding: 4px 0;
  }
  .itbl .itbl__row {
    padding: 12px 0;
    border-bottom: 1px solid var(--hairline);
  }
  .itbl .itbl__row[data-status="FAIL"] { border-bottom: 2px solid var(--negative); }
  .itbl .itbl__row[data-status="PENDING"] { border-bottom-style: dashed; }

  .itbl .itbl__sigma {
    padding: 12px 0;
    border-bottom: 2px solid var(--rule-strong);
  }
  .itbl .itbl__sigma[data-onchain="1"] { background: var(--raised); }
  .itbl .itbl__sigma[data-sigma-state="BLOCKED"],
  .itbl .itbl__sigma[data-sigma-state="ANOMALY"] {
    border-bottom-color: var(--negative);
  }
  .itbl .itbl__sigma[data-sigma-state="HELD"],
  .itbl .itbl__sigma[data-sigma-state="UNDECIDED"] {
    border-bottom: 1px dashed var(--warning);
  }

  /* The datum dot keeps its own left edge on the second line, where the
     clause number now sits. */
  .itbl .itbl__datum { top: 10px; }
  .itbl .itbl__sigma-note { text-align: left; }
}

/* A row is not interactive, so it owes no 44px hit area — but it is read by
   thumb on a phone, and 44px of row height is what makes the scan work. */
@media (pointer: coarse) {
  .itbl .itbl__row,
  .itbl .itbl__sigma { min-height: 44px; }
}
`;
