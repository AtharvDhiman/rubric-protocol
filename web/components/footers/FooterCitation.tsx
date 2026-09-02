import Link from "next/link";

import { demoTasks, type DemoTask, type DemoVerdict } from "@/lib/demo";

/**
 * THE CITATION - footer option F.
 *
 * THE IDEA, IN TWO SENTENCES. This project's stated invariant is that every
 * rejection must cite a specific sealed clause, and that a rejection which
 * cannot cite one is a bug; so the footer ends every page by exhibiting one
 * real refusal in full - the clause that was sealed, the submission's own
 * account of the work, and the ruling that connects them. Nothing else in this
 * product can be put at the bottom of a page: a table of matters shows THAT
 * verdicts exist, and this shows WHAT one is made of.
 *
 * WHY THIS AND NOT ANOTHER RECORD TABLE
 * -------------------------------------
 * The landing already carries a verdict log, and the docket is a table of
 * matters. A second table at the bottom of every page would be the same
 * information at a lower resolution. The interesting object was never the list;
 * it is the single ruling, quoted at depth, where the submission's own words are
 * what condemn it against a clause that was hashed on-chain before the work
 * began. That is the product's whole argument in one exhibit.
 *
 * The layout is a citation bar: one heavy vertical rule with three labelled
 * bands hung off it. The bar is not decoration - it is the blocking clause
 * drawn as a line, the same idea as the arrested probe on the verdict sheet.
 *
 * NOTHING HERE IS WRITTEN FOR THE FOOTER
 * --------------------------------------
 * Every string is read from lib/demo.ts at render: the clause text, the
 * submission, the judge's reasoning, the amount, the confidence. If the seeded
 * record changes, this changes. If no refused record exists, the component
 * renders the invariant as a statement and no exhibit, rather than inventing
 * one - a footer that fabricates a refusal on a product whose pitch is "pay on
 * proof" would be the exact failure it is describing.
 *
 * CONTRAST, measured on --page:
 *   --text        13.36:1   the clause text and the wordmark
 *   --text-2       9.53:1   quoted prose
 *   --text-muted   6.14:1   labels and the ruling
 *   --negative     5.25:1   the outcome marker, the one alarm
 *   --hairline     3.14:1   rules, as a graphic
 * The bar is --text at 13.36:1. No volume ink appears; none is legal here.
 */

/** The first refused matter that carries a citable failing clause. */
interface Exhibit {
  task: DemoTask;
  verdict: DemoVerdict;
  clauseIndex: number;
  clause: string;
  reason: string;
}

function findRefusal(tasks: DemoTask[]): Exhibit | null {
  for (const task of tasks) {
    const verdict = task.verdictJson;
    if (task.state !== "REFUNDED" || !verdict) continue;
    const failed = verdict.clauses.find((c) => !c.passed);
    // A refusal whose clause text is missing is not citable, and an uncitable
    // refusal is precisely what this component exists to say cannot happen.
    // Skip it rather than print half an exhibit.
    if (!failed) continue;
    const clause = task.clauses[failed.index];
    if (!clause) continue;
    return { task, verdict, clauseIndex: failed.index, clause, reason: failed.reason };
  }
  return null;
}

/** Base units to a display amount. The mint is 6-decimal USDC. */
const usdc = (base: bigint): string => (Number(base) / 1e6).toFixed(2);

const CITATION_CSS = `
.fc {
  background: var(--page);
  border-top: 1px solid var(--border);
}
.fc-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 34px 32px 26px;
}

/* Masthead: the name, and what the exhibit below is for. */
.fc-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px 32px;
  flex-wrap: wrap;
}
.fc-name {
  margin: 0;
  font-family: var(--font-sans);
  font-size: clamp(30px, 4.6vw, 46px);
  font-variation-settings: "wdth" 112;
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1;
  color: var(--text);
}
.fc-claim { margin: 0; font-size: 15px; color: var(--text-2); }

.fc-rule {
  margin: 22px 0 0;
  border: 0;
  border-top: 1px solid var(--border);
}

.fc-caption {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px 24px;
  flex-wrap: wrap;
  padding: 14px 0 18px;
}
.fc-caption .label { color: var(--text-muted); }

/* THE CITATION BAR.

   One heavy vertical rule with the bands hung off it. It is the blocking
   clause drawn as a line - the same idea as the probe coming to rest against
   the clause that arrested it on the verdict sheet. */
.fc-exhibit {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: 0;
  border-left: 3px solid var(--text);
  padding-left: 0;
}
.fc-band {
  display: contents;
}
.fc-key {
  padding: 12px 18px 12px 20px;
  border-bottom: 1px solid var(--hairline);
  color: var(--text-muted);
}
.fc-val {
  padding: 12px 0 12px 0;
  border-bottom: 1px solid var(--hairline);
  min-width: 0;
}
.fc-band:last-of-type .fc-key,
.fc-band:last-of-type .fc-val { border-bottom: 0; }

/* The sealed clause is the one thing set at reading size: it is the text the
   whole judgment turns on. */
.fc-clause {
  margin: 0;
  font-size: clamp(17px, 2.1vw, 21px);
  line-height: 1.45;
  color: var(--text);
  text-wrap: balance;
}
.fc-quote {
  margin: 0;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-2);
  max-width: 74ch;
}
.fc-ruling {
  margin: 0;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-muted);
  max-width: 74ch;
}

/* The outcome. --negative and nothing else on this page carries it, and the
   word and the square carry the same information for anyone who cannot see
   the colour. */
.fc-outcome {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 18px;
  color: var(--negative);
}
.fc-outcome-mark {
  width: 9px;
  height: 9px;
  background: currentColor;
  flex: none;
}
.fc-outcome-note {
  margin-left: auto;
  color: var(--text-muted);
}

.fc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px 24px;
  flex-wrap: wrap;
  margin-top: 26px;
  padding-top: 16px;
  border-top: 1px solid var(--hairline);
}
.fc-links { display: flex; gap: 20px; flex-wrap: wrap; }
.fc-links a {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid var(--hairline);
}
.fc-links a:hover { border-bottom-color: var(--accent); }
.fc-foot .label { color: var(--text-muted); }

@media (max-width: 760px), (pointer: coarse) {
  .fc-links a {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
}

@media (max-width: 700px) {
  .fc-inner { padding: 26px 16px 20px; }
  /* The key column stops being a column: at this width 104px of label beside
     the clause leaves the clause too narrow to read as a sentence. */
  .fc-exhibit { grid-template-columns: minmax(0, 1fr); }
  .fc-key {
    padding: 14px 0 4px 16px;
    border-bottom: 0;
  }
  .fc-val { padding: 0 0 14px 16px; }
}
`;

export function FooterCitation() {
  const exhibit = findRefusal(demoTasks());

  return (
    <footer className="fc">
      <style>{CITATION_CSS}</style>

      <div className="fc-inner">
        <div className="fc-head">
          <p className="fc-name">RUBRIC</p>
          <p className="fc-claim">Pay on proof, not on trust.</p>
        </div>

        <hr className="fc-rule" />

        {exhibit ? (
          <>
            <div className="fc-caption">
              <span className="label">EVERY REFUSAL CITES A CLAUSE</span>
              <span className="label">
                MATTER Nº{" "}
                {exhibit.task.onchainTaskId.toString().padStart(4, "0")} ·{" "}
                {usdc(exhibit.task.bountyAmount)} USDC · CONFIDENCE{" "}
                {exhibit.verdict.confidence}
              </span>
            </div>

            <div className="fc-exhibit">
              <div className="fc-band">
                <div className="fc-key label">
                  CLAUSE {String(exhibit.clauseIndex + 1).padStart(2, "0")}
                </div>
                <div className="fc-val">
                  <p className="fc-clause">{exhibit.clause}</p>
                </div>
              </div>

              <div className="fc-band">
                <div className="fc-key label">SUBMITTED</div>
                <div className="fc-val">
                  <p className="fc-quote">
                    {exhibit.task.submissionContent}
                  </p>
                </div>
              </div>

              <div className="fc-band">
                <div className="fc-key label">RULING</div>
                <div className="fc-val">
                  <p className="fc-ruling">{exhibit.reason}</p>
                </div>
              </div>
            </div>

            <p className="fc-outcome">
              <span className="fc-outcome-mark" aria-hidden="true" />
              <span className="label" style={{ color: "inherit" }}>
                OUT OF TOLERANCE · ESCROW RETURNED TO THE POSTER
              </span>
              <span className="label fc-outcome-note">
                SEEDED SAMPLE · NOT A LIVE MATTER
              </span>
            </p>
          </>
        ) : (
          // No refused record to cite. The invariant is still true, and saying
          // it without an exhibit is the only honest option - inventing a
          // refusal here would be the failure this component describes.
          <p className="fc-ruling" style={{ padding: "18px 0" }}>
            Every rejection this protocol issues cites a specific clause that was
            sealed on-chain before the work began. No refused matter is on record
            yet.
          </p>
        )}

        <div className="fc-foot">
          <span className="fc-links">
            <Link href="/docket">The docket</Link>
            <Link href="/create">Create a task</Link>
            <Link href="/my-work">My work</Link>
          </span>
          <span className="label">BUILT ON SOLANA · USDC ESCROW</span>
        </div>
      </div>
    </footer>
  );
}

export default FooterCitation;
