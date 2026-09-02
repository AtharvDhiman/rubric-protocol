import Link from "next/link";

import { SolanaMark } from "@/components/SolanaMark";
import { TAGLINE } from "@/lib/constants";
import { demoTasks, isSampleTask, type DemoTask } from "@/lib/demo";
import { formatUsdc, truncateHash } from "@/lib/task-view";

/**
 * THE LEDGER TAIL — footer option A.
 *
 * WHY A LEDGER AND NOT A WORDMARK
 * -------------------------------
 * This product's single claim is that its verdicts are public and cite a clause
 * that was sealed before the work started. A footer that ends every page with
 * actually decided matters states that claim by exhibiting it; a decorative
 * wordmark only asserts it. It also gives a reader who has reached the bottom of
 * a page somewhere to go — which, per NN/g, is what people who reach a footer
 * are usually there for.
 *
 * So the bottom of the page is the tail of the record: the last few matters the
 * judge decided, ruled off, totalled, and signed. The name is the ledger's
 * masthead rather than a terminal flourish.
 *
 * WHAT IS TRUE HERE, AND HOW IT IS KEPT TRUE
 * ------------------------------------------
 * Every figure on this footer is derived from the record it sits beside. None
 * is typed in.
 *
 *   CLAUSES    — `task.clauses.length` is the sealed count; the passed count is
 *                the verdict's own per-clause results, filtered to indices that
 *                actually exist in the sealed set. If the judge returned more
 *                results than there were clauses, the extras are ignored rather
 *                than inflating the denominator.
 *   ESCROW     — `formatUsdc(task.bountyAmount)`, the same function every other
 *                money figure in the app uses. The column is headed ESCROW, not
 *                "paid to worker", because the protocol takes a fee on release
 *                and this component does not know it: the escrow of 25.00 USDC
 *                was released is true, "the worker received 25.00 USDC" is not.
 *   RUBRIC     — `task.rubricHash`, the SHA-256 of the canonical clause set,
 *                truncated. It is here because it is the one figure in the row
 *                a reader can check for themselves: the record page this row
 *                links to shows the same digest in full beside the clauses it
 *                was taken from.
 *   TO VERDICT — `decidedAt - submittedAt`. A difference of two stored instants,
 *                so it is identical on the server and on the client and cannot
 *                drift between them. No absolute timestamp and no "x hours ago"
 *                is printed anywhere, precisely because those go stale in a
 *                statically rendered page and a stale fact here is a lie.
 *   TOTALS     — computed from the rows above them and scoped to those rows in
 *                words. A footer total that sums something wider than what the
 *                reader can add up by eye is a vanity metric.
 *
 * PROVENANCE IS A COLUMN OF ITS OWN, EFFECTIVELY
 * ----------------------------------------------
 * `lib/demo.ts` is candid that its records are seeded samples whose rubric
 * hashes are genuine and whose addresses, signatures and amounts are
 * illustrative. Showing those without saying so would be exactly the substitution
 * this protocol exists to prevent, so every sample row carries a mark, the
 * masthead carries a SOURCE readout, and the footnote states the split. A
 * deployment with real decided matters passes them in as `records` and all three
 * change on their own.
 *
 * COLOUR
 * ------
 * The three dispositions are the three permitted inks, and each carries four
 * channels rather than one: the word (RELEASED / REFUNDED / HELD), a shape
 * (filled disc / hollow ring / filled square), an integer (the clause tally),
 * and the colour. The single green figure on the page is a matter where the
 * chain actually moved money. HELD additionally takes a dashed row rule, because
 * product-wide dashed means inferred and a verdict the system refused to act on
 * is a hypothesis.
 *
 * MOTION
 * ------
 * There is none, and that is a decision. A ledger that animates is a widget
 * pretending to be a record, and this is the one page element whose argument is
 * that nothing here is theatre. Nothing to gate on `prefers-reduced-motion`
 * because nothing moves.
 */

/* ==========================================================================
   PUBLIC API
   ========================================================================== */

/** The three dispositions a decided matter can have. There is no fourth. */
export type LedgerDisposition = "RELEASED" | "REFUNDED" | "HELD";

export interface LedgerRecord {
  /** Record id, used for the link target and for the sample check. */
  id: string;
  /** The on-chain task id, printed as the matter number. */
  matterNo: string;
  /** The human-written title. The only prose in a row. */
  title: string;
  /**
   * The SHA-256 of the canonical rubric, as hex.
   *
   * Printed truncated under the title, and it is the one figure in the row that
   * a reader can independently check: the full digest and the clauses it was
   * taken from are both on the record page this row links to, and `lib/hash.ts`
   * produced it from those clauses. That is why it earns a line here — a hash
   * nobody can reproduce would be texture pretending to be evidence.
   */
  rubricHash: string;
  /** How many clauses were sealed. */
  clauseCount: number;
  /** How many of them the judge passed. Never exceeds `clauseCount`. */
  passedCount: number;
  /** Escrow amount in USDC, already formatted (e.g. "25.00"). */
  escrowUsdc: string;
  /** What happened to that escrow. */
  disposition: LedgerDisposition;
  /** Seconds between submission and verdict. */
  verdictSeconds: number;
  /** True for a seeded sample record rather than a sealed one. */
  sample: boolean;
  /** Escrow in base units — used only for the released total. */
  escrowBaseUnits: bigint;
}

export interface FooterLedgerProps {
  /**
   * The decided matters to print, most recently decided first.
   *
   * Defaults to the seeded sample docket so the footer has a record to show in
   * a deployment with no data behind it. Those rows are marked as samples
   * wherever they appear — see the file header.
   */
  records?: LedgerRecord[];
}

/** How many rows the tail prints. A tail, not a table of contents. */
const MAX_ROWS = 4;

/* ==========================================================================
   DERIVATION
   ========================================================================== */

/**
 * A decided matter, or null.
 *
 * A record only enters the ledger when the judge actually returned a verdict on
 * it: OPEN and SUBMITTED matters have no verdict and no elapsed time, and
 * printing a blank row for them would suggest the judge declined rather than
 * that it has not looked yet.
 */
function toRecord(task: DemoTask): LedgerRecord | null {
  const verdict = task.verdictJson;
  if (!verdict || !task.decidedAt || !task.submittedAt) return null;

  const disposition: LedgerDisposition | null =
    task.state === "SETTLED"
      ? "RELEASED"
      : task.state === "REFUNDED"
        ? "REFUNDED"
        : task.state === "HELD"
          ? "HELD"
          : null;
  if (!disposition) return null;

  const clauseCount = task.clauses.length;
  // The sealed clause set is the denominator. A verdict entry pointing outside
  // it is discarded rather than counted.
  const passedCount = verdict.clauses.filter(
    (c) => c.passed && c.index >= 0 && c.index < clauseCount
  ).length;

  const verdictSeconds = Math.max(
    0,
    Math.round((task.decidedAt.getTime() - task.submittedAt.getTime()) / 1000)
  );

  return {
    id: task.id,
    matterNo: task.onchainTaskId.toString(),
    title: task.title,
    rubricHash: task.rubricHash,
    clauseCount,
    passedCount: Math.min(passedCount, clauseCount),
    escrowUsdc: formatUsdc(task.bountyAmount),
    escrowBaseUnits: task.bountyAmount,
    disposition,
    verdictSeconds,
    sample: isSampleTask(task.id),
  };
}

/** The seeded sample docket, reduced to decided matters, newest verdict first. */
function defaultRecords(): LedgerRecord[] {
  return demoTasks()
    .map((task) => ({ task, record: toRecord(task) }))
    .filter(
      (entry): entry is { task: DemoTask; record: LedgerRecord } =>
        entry.record !== null
    )
    .sort(
      (a, b) =>
        (b.task.decidedAt?.getTime() ?? 0) - (a.task.decidedAt?.getTime() ?? 0)
    )
    .map((entry) => entry.record);
}

/** Seconds, printed at the precision actually measured. */
function formatDuration(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/* ==========================================================================
   THE ROW MARK
   Shape is the channel that survives greyscale and a deuteranope's screen.
   Drawn as SVG geometry rather than a border-radius, because radius is 0
   everywhere in this system and a disc made of one would be the exception that
   starts the drift.
   ========================================================================== */

function DispositionMark({ disposition }: { disposition: LedgerDisposition }) {
  return (
    <svg
      className="flg-mark-glyph"
      viewBox="0 0 8 8"
      width="8"
      height="8"
      aria-hidden="true"
      focusable="false"
    >
      {disposition === "RELEASED" && (
        /* filled disc — the chain moved money */
        <circle cx="4" cy="4" r="3.4" fill="currentColor" />
      )}
      {disposition === "REFUNDED" && (
        /* hollow ring — out of tolerance */
        <circle
          cx="4"
          cy="4"
          r="2.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      )}
      {disposition === "HELD" && (
        /* filled square — unresolved, escrow untouched */
        <rect x="0.8" y="0.8" width="6.4" height="6.4" fill="currentColor" />
      )}
    </svg>
  );
}

/* ==========================================================================
   THE COMPONENT
   ========================================================================== */

export function FooterLedger({ records }: FooterLedgerProps = {}) {
  const all = records ?? defaultRecords();
  const rows = all.slice(0, MAX_ROWS);

  const sealedClauses = rows.reduce((n, r) => n + r.clauseCount, 0);
  const passedClauses = rows.reduce((n, r) => n + r.passedCount, 0);
  const sampleCount = rows.filter((r) => r.sample).length;

  const releasedBase = rows
    .filter((r) => r.disposition === "RELEASED")
    .reduce((sum, r) => sum + r.escrowBaseUnits, 0n);

  // Every clause of this line is scoped to the rows printed above it, so a
  // reader can check the arithmetic against what is on screen.
  const totals: string[] = [
    `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`,
    `${passedClauses} of ${sealedClauses} sealed clauses passed`,
  ];
  if (releasedBase > 0n) {
    totals.push(`${formatUsdc(releasedBase)} USDC released`);
  }
  if (rows.length > 0) {
    totals.push(
      `median ${formatDuration(median(rows.map((r) => r.verdictSeconds)))} to verdict`
    );
  }

  const source =
    rows.length === 0
      ? "NO ENTRIES"
      : sampleCount === rows.length
        ? "SEEDED SAMPLE"
        : sampleCount === 0
          ? "SEALED RECORDS"
          : "MIXED";

  return (
    <footer className="flg">
      <style>{LEDGER_CSS}</style>

      <div className="flg-inner">
        {/* ---------------------------------------------------------------
            MASTHEAD. The name at the head of the record, the way a ledger
            book is headed, with the ledger's own counts ruled off to the
            right. Not a terminal wordmark — the table under it is the point.
            --------------------------------------------------------------- */}
        <div className="flg-head">
          <div className="flg-headname">
            <p className="flg-name">
              <span className="flg-datum" aria-hidden="true" />
              RUBRIC
            </p>
            <p className="flg-claim">{TAGLINE}</p>
          </div>

          <dl className="flg-meta">
            <div className="flg-meta-cell">
              <dt className="label">SHOWN</dt>
              <dd className="data flg-fig">{rows.length}</dd>
            </div>
            <div className="flg-meta-cell">
              <dt className="label">CLAUSES</dt>
              <dd className="data flg-fig">{sealedClauses}</dd>
            </div>
            <div className="flg-meta-cell">
              <dt className="label">SOURCE</dt>
              <dd className="data flg-fig flg-fig-word">{source}</dd>
            </div>
          </dl>
        </div>

        {rows.length === 0 ? (
          /* Degrading honestly: no invented row, no skeleton, no "coming
             soon". The ledger says what it is — empty — and the reader is
             pointed at the docket, which is where a first matter comes from. */
          <p className="flg-empty">
            No matter has been decided yet. This ledger begins at the first
            verdict, and every entry it takes will name the sealed clauses the
            judge ruled on.
          </p>
        ) : (
          <table className="flg-table">
            <caption className="flg-caption">
              The last matters decided against clauses that were sealed on-chain
              before the work began — most recently decided first.
            </caption>

            <colgroup>
              <col />
              <col className="flg-col-clauses" />
              <col className="flg-col-escrow" />
              <col className="flg-col-time" />
            </colgroup>

            <thead>
              <tr>
                <th scope="col" className="label flg-th">
                  Matter
                </th>
                <th scope="col" className="label flg-th flg-num">
                  Clauses
                </th>
                <th scope="col" className="label flg-th flg-num">
                  Escrow
                </th>
                <th scope="col" className="label flg-th flg-num">
                  To verdict
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`flg-row flg-row--${r.disposition}`}>
                  <th scope="row" className="flg-matter">
                    <Link href={`/task/${r.id}`} className="flg-link">
                      <span className="data flg-no">
                        No. {r.matterNo}
                        {r.sample && (
                          <>
                            <span aria-hidden="true" className="flg-star">
                              *
                            </span>
                            <span className="sr-only">
                              {" "}
                              (seeded sample record)
                            </span>
                          </>
                        )}
                      </span>
                      <span className="flg-title">{r.title}</span>
                      <span className="data flg-hash">
                        <span className="sr-only">Rubric hash </span>
                        {truncateHash(r.rubricHash)}
                      </span>
                    </Link>
                  </th>

                  <td className="flg-num">
                    <span className="data flg-fig">
                      {r.passedCount} / {r.clauseCount}
                    </span>
                  </td>

                  <td className="flg-num flg-escrow">
                    <span className="data flg-fig flg-amount">
                      {r.escrowUsdc} USDC
                    </span>
                    <span className="flg-word">
                      <DispositionMark disposition={r.disposition} />
                      {r.disposition}
                    </span>
                  </td>

                  <td className="flg-num">
                    <span className="data flg-fig">
                      {formatDuration(r.verdictSeconds)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr>
                <td colSpan={4} className="flg-totals">
                  <span className="label flg-totals-key">Totals</span>
                  <span className="flg-totals-val">{totals.join(" · ")}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {sampleCount > 0 && (
          <p className="flg-note">
            <span aria-hidden="true" className="flg-star flg-star--note">
              *
            </span>
            Seeded sample record. Its clauses and their SHA-256 rubric hash are
            genuine, produced by the same function the protocol seals with;
            wallet addresses, signatures and amounts are illustrative. Nothing
            here is a real escrow.
          </p>
        )}

        {/* ---------------------------------------------------------------
            THE SIGNING LINE. Where to go from the bottom of the page.
            --------------------------------------------------------------- */}
        <div className="flg-tail">
          <nav aria-label="Footer">
            <ul className="flg-nav">
              <li>
                <Link href="/docket">Docket</Link>
              </li>
              <li>
                <Link href="/create">Create</Link>
              </li>
              <li>
                <Link href="/my-work">My work</Link>
              </li>
            </ul>
          </nav>

          <p className="flg-chain">
            <SolanaMark size={14} />
            <span className="label">BUILT ON SOLANA · USDC ESCROW</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

export default FooterLedger;

/* ==========================================================================
   STYLES

   Scoped under .flg, injected here so this component is one file. Every colour
   is a token by name; no hex literal for a design colour appears below.

   MEASURED CONTRAST — every text/background pair in this component.
   Ground is --surface (#edefec) throughout; there is no second ground and no
   hatch, so each figure below is the actual computed pair.

     --text        on --surface   15.99:1   name, titles, clause tallies, times
     --text-2      on --surface   11.41:1   the claim line, the empty-state line
     --text-muted  on --surface    7.35:1   column heads, totals, note, chain line
     --accent      on --surface    6.41:1   matter numbers, footer links
     --positive    on --surface    6.51:1   RELEASED amount + word  (large/graphic
                                            floor 3:1 also cleared)
     --negative    on --surface    6.28:1   REFUNDED amount + word
     --warning     on --surface    8.00:1   HELD amount + word
     --hairline    on --surface    3.76:1   row rules and link underlines, as
                                            graphics (floor 3:1)

   Body floor is 4.5:1 and the lowest text pair here is --hairline, which is
   never used as text — only as a 1px rule and as an underline colour, both
   graphics. --text-faint is deliberately not used anywhere in this component.
   ========================================================================== */

const LEDGER_CSS = `
.flg {
  position: relative;
  background: var(--surface);
  border-top: 1px solid var(--border);
  color: var(--text);
}

.flg .flg-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 44px 32px 34px;
}

/* --------------------------------------------------------------------------
   MASTHEAD
   -------------------------------------------------------------------------- */

.flg .flg-head {
  display: grid;
  /* minmax(0, 1fr), never a bare 1fr: a bare 1fr takes its content's width as
     an automatic minimum, which is how a long name forces the page sideways. */
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 22px 40px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}

.flg .flg-headname { min-width: 0; }

.flg .flg-name {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 0;
  font-family: var(--font-sans);
  /* clamp() rather than a raw vw, so the reader's root font size still scales it. */
  font-size: clamp(34px, 6.4vw, 54px);
  font-variation-settings: "wdth" 112;
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 0.96;
  color: var(--text);
}

/* The datum mark from the header nameplate, at masthead scale. A square, not a
   logo: it is the origin everything below is ruled from. */
.flg .flg-datum {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  background: var(--accent);
}

.flg .flg-claim {
  margin: 12px 0 0;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-2);
  max-width: 46ch;
}

.flg .flg-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px 30px;
  margin: 0;
}

.flg .flg-meta-cell { min-width: 0; text-align: right; }
.flg .flg-meta dt { margin: 0 0 5px; }
.flg .flg-meta dd { margin: 0; font-size: 13px; color: var(--text); }

@media (max-width: 820px) {
  .flg .flg-head {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }
  .flg .flg-meta { justify-content: flex-start; }
  .flg .flg-meta-cell { text-align: left; }
}

/* --------------------------------------------------------------------------
   THE TABLE
   A real record: fixed columns, hairline rules, figures right-aligned and
   tabular so a column can be read down. No cards, no fills, no hover lift.
   -------------------------------------------------------------------------- */

.flg .flg-table {
  width: 100%;
  /* Fixed layout is what guarantees the 375px case: the numeric columns are
     declared and the matter column takes exactly what is left, so no cell can
     widen the table past its container. */
  table-layout: fixed;
  border-collapse: collapse;
  margin-top: 24px;
}

.flg .flg-caption {
  caption-side: top;
  text-align: left;
  padding: 0 0 16px;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-muted);
  max-width: 74ch;
}

.flg .flg-col-clauses { width: 96px; }
.flg .flg-col-escrow { width: 132px; }
.flg .flg-col-time { width: 104px; }

.flg .flg-th {
  padding: 0 0 9px 12px;
  text-align: left;
  vertical-align: bottom;
  white-space: normal;
  line-height: 1.35;
  border-bottom: 1px solid var(--border);
  /* Structural, not stylistic: a column head is set inside a declared column
     width, so if a font falls back to wider metrics than Martian's the word
     clips at its own column edge instead of sliding under its neighbour. */
  overflow: hidden;
}
.flg .flg-table thead .flg-th:first-child { padding-left: 0; }
.flg .flg-th.flg-num { text-align: right; }

/* Same guard on the figure columns. Clipping rather than an ellipsis is the
   house rule for a readout: a truncated figure that still looks complete is
   worse than one that visibly ran out of room. Nothing clips at any width this
   ships at - this is the floor under a font fallback. */
.flg .flg-num { text-align: right; overflow: hidden; }

.flg .flg-row { border-bottom: 1px solid var(--hairline); }
/* Dashed means hypothesis, solid means measurement - product-wide. A held
   matter is a verdict the system refused to act on, so its rule is dashed. */
.flg .flg-row--HELD { border-bottom-style: dashed; }
.flg .flg-table tbody tr:last-child { border-bottom: 0; }

.flg .flg-table tbody th,
.flg .flg-table tbody td {
  padding: 13px 0 13px 12px;
  vertical-align: top;
}
.flg .flg-table tbody th { padding-left: 0; font-weight: 400; text-align: left; }

/* The matter cell ------------------------------------------------------- */

.flg .flg-matter { min-width: 0; }

.flg .flg-link {
  display: block;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.flg .flg-no {
  display: block;
  font-size: 11px;
  font-variation-settings: "wdth" 87.5;
  letter-spacing: 0.06em;
  color: var(--accent);
}

.flg .flg-star { font-family: var(--font-mono); color: var(--accent); }

.flg .flg-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  margin-top: 4px;
  font-family: var(--font-sans);
  font-size: 14.5px;
  line-height: 1.35;
  color: var(--text);
  /* Underlined by default. The rule colour is the hairline, which clears the
     3:1 graphic floor; hover promotes it to the identity ink. */
  text-decoration: underline;
  text-decoration-color: var(--hairline);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.flg .flg-link:hover .flg-title { text-decoration-color: var(--accent); }

/* The sealed digest, truncated the way every other identifier in this app is
   truncated. wdth 75 is the whole reason the mono family has a width axis:
   it keeps the figure one unbroken, selectable token at 375px. */
.flg .flg-hash {
  display: block;
  margin-top: 5px;
  font-size: 10px;
  font-variation-settings: "wdth" 75;
  letter-spacing: 0.02em;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
}

/* Figures ---------------------------------------------------------------- */

/* Condensed against the .data default of wdth 100, so "25.00 USDC" holds one
   line inside a 92px column at 375px. */
.flg .flg-fig {
  font-variation-settings: "wdth" 87.5;
  font-size: 13px;
  white-space: nowrap;
}
.flg .flg-fig-word { letter-spacing: 0.06em; font-size: 11px; }

.flg .flg-escrow .flg-amount { display: block; }

.flg .flg-word {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  margin-top: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.1em;
  color: var(--text-muted);
}

.flg .flg-mark-glyph { flex: 0 0 auto; display: block; }

/* The three permitted inks. Each ships with the word, the shape and the
   integer beside it, so none of them is carrying meaning alone. */
.flg .flg-row--RELEASED .flg-amount,
.flg .flg-row--RELEASED .flg-word { color: var(--positive); }
.flg .flg-row--REFUNDED .flg-amount,
.flg .flg-row--REFUNDED .flg-word { color: var(--negative); }
.flg .flg-row--HELD .flg-amount,
.flg .flg-row--HELD .flg-word { color: var(--warning); }

/* Totals ----------------------------------------------------------------- */

.flg .flg-totals {
  padding: 13px 0 0;
  border-top: 1px solid var(--border);
  text-align: left;
}

.flg .flg-totals-key { display: inline; margin-right: 10px; }

.flg .flg-totals-val {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

/* --------------------------------------------------------------------------
   NOTE, EMPTY STATE, SIGNING LINE
   -------------------------------------------------------------------------- */

.flg .flg-empty {
  margin: 26px 0 0;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.55;
  color: var(--text-2);
  max-width: 62ch;
}

.flg .flg-note {
  display: flex;
  gap: 6px;
  margin: 16px 0 0;
  font-family: var(--font-sans);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-muted);
  max-width: 78ch;
}

.flg .flg-star--note { flex: 0 0 auto; line-height: 1.4; }

.flg .flg-tail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 28px;
  margin-top: 26px;
  padding-top: 18px;
  border-top: 1px solid var(--hairline);
}

.flg .flg-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 24px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.flg .flg-nav a {
  display: inline-flex;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: var(--hairline);
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
}

.flg .flg-nav a:hover { text-decoration-color: var(--accent); }

.flg .flg-chain {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  margin: 0;
}

/* --------------------------------------------------------------------------
   NARROW
   The numeric columns shrink rather than disappear - a record that drops a
   column on a phone is a different record. At 375px this leaves ~131px for the
   matter column, which holds two clamped lines of a title.
   -------------------------------------------------------------------------- */

@media (max-width: 700px) {
  .flg .flg-inner { padding: 34px 16px 28px; }
  .flg .flg-col-clauses { width: 60px; }
  .flg .flg-col-escrow { width: 92px; }
  .flg .flg-col-time { width: 62px; }
  /* Tracking, not size: the column heads stay at the app-wide 10px and give up
     letter-spacing instead, which is what buys "CLAUSES" its 60px column at
     375px. Measured at 47px against a 52px content box. */
  .flg .flg-th { padding-left: 8px; letter-spacing: 0.02em; }
  .flg .flg-table tbody td { padding-left: 8px; }
  .flg .flg-fig { font-size: 12px; }
  .flg .flg-fig-word { font-size: 10px; }
  .flg .flg-title { font-size: 13.5px; }
  .flg .flg-tail { justify-content: flex-start; }
}

/* --------------------------------------------------------------------------
   TOUCH
   Gated on pointer type, not on viewport width: a tablet in portrait reports a
   768px viewport and is still a pure touch device. Links inside running prose
   keep the WCAG 2.5.8 exemption; there are none in this footer.
   -------------------------------------------------------------------------- */

@media (pointer: coarse) {
  .flg .flg-link { min-height: 44px; }
  .flg .flg-nav a { min-height: 44px; }
}
`;
