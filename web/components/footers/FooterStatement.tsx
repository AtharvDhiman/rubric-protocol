import Link from "next/link";

import { demoTasks } from "@/lib/demo";

/**
 * THE STATEMENT - footer option G.
 *
 * A full-viewport-height closing panel on a twelve-column grid, revealed by the
 * page sliding off it rather than by scrolling to it.
 *
 * WHERE IT COMES FROM, AND WHAT WAS NOT TAKEN
 * -------------------------------------------
 * The reference is unionspaces.co.uk, whose footer measures exactly 100vh, runs
 * a twelve-column grid, and closes on prose and a single address rather than a
 * link farm. Measured on the live site: footer height 860px against an inner
 * height of 860, twelve equal 83.7px columns, and one link in the entire
 * element.
 *
 * The one thing NOT taken is how it moves. That site pins with GSAP - the
 * element before its footer is a `div.pin-spacer`, which is ScrollTrigger's
 * signature - and GSAP is banned here. It is also unnecessary: the reveal is
 * `position: sticky` on the footer with the page content above it carrying an
 * opaque background and a higher stacking order. No library, no scroll
 * listener, no JavaScript at all, and it degrades to an ordinary footer on any
 * engine that does not do sticky.
 *
 * WHY THIS IS DIFFERENT FROM THE OTHER OPTIONS
 * --------------------------------------------
 * Every other candidate is concept-led: a hash, a plot, a citation, a ledger.
 * Each is a clever device. This one is scale-led - it is the only one that uses
 * the FULL HEIGHT of the screen as the material, and presence is a real design
 * argument that none of the others were making.
 *
 * It still has to earn the space, so it is not an empty panel with a wordmark
 * in it. The left column carries the claim at reading size, the right carries
 * the record - counts taken from lib/demo.ts, never written here - and the
 * baseline carries the routes.
 *
 * CONTRAST on --page: --text 13.36 - --text-2 9.53 - --text-muted 6.14 -
 * --accent 5.36 - --hairline 3.14 as a graphic. No volume ink; none is legal
 * on this ground.
 */

const STAT_CSS = `
.fs {
  /* THE REVEAL. Sticky at the bottom with the page above it opaque and higher
     in the stacking order, so the content slides up and off rather than the
     footer scrolling into view. Zero JavaScript. On an engine without sticky
     this is simply a tall footer, which is a correct fallback and not a broken
     one. */
  position: sticky;
  bottom: 0;
  z-index: 0;
  display: flex;
  flex-direction: column;
  min-height: 100svh;
  background: var(--page);
  border-top: 1px solid var(--border);
}

.fs-inner {
  flex: 1;
  display: grid;
  /* Twelve columns, like the reference. minmax(0,1fr) rather than 1fr: a bare
     1fr takes its content as an automatic minimum, which is how a wide child
     silently forces horizontal overflow. */
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 0 24px;
  align-content: space-between;
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
  padding: 56px 32px 32px;
}

/* --- the top band: eyebrow across the full measure --- */
.fs-eyebrow {
  grid-column: 1 / -1;
  margin: 0 0 auto;
  color: var(--text-muted);
}

/* --- the middle band --- */
.fs-claim { grid-column: 1 / span 7; margin: 48px 0 0; }
.fs-record { grid-column: 9 / -1; margin: 48px 0 0; }

.fs-lede {
  margin: 0;
  font-family: var(--font-sans);
  font-size: clamp(24px, 3.4vw, 42px);
  font-variation-settings: "wdth" 100;
  font-weight: 500;
  line-height: 1.18;
  letter-spacing: -0.03em;
  color: var(--text);
  text-wrap: balance;
  max-width: 20ch;
}
.fs-sub {
  margin: 22px 0 0;
  max-width: 46ch;
  font-size: 15px;
  line-height: 1.62;
  color: var(--text-2);
}

.fs-figures {
  display: grid;
  gap: 0;
  margin: 0;
}
.fs-fig {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--hairline);
}
.fs-fig:first-child { border-top: 1px solid var(--hairline); }
.fs-fig dt { color: var(--text-muted); }
.fs-fig dd { margin: 0; font-size: 19px; color: var(--text); }

/* --- the name, at the size the panel exists to allow --- */
.fs-name {
  grid-column: 1 / -1;
  margin: 56px 0 0;
  font-family: var(--font-sans);
  /* Capped with clamp rather than raw vw: a viewport unit ignores the root font
     size, so a reader who has zoomed gets no larger type at all. */
  font-size: clamp(64px, 13vw, 168px);
  font-variation-settings: "wdth" 118;
  font-weight: 700;
  letter-spacing: -0.05em;
  line-height: 0.86;
  color: var(--text);
}

/* --- the baseline --- */
.fs-base {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px 28px;
  flex-wrap: wrap;
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.fs-links { display: flex; gap: 22px; flex-wrap: wrap; }
.fs-links a {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid var(--hairline);
}
.fs-links a:hover { border-bottom-color: var(--accent); }
.fs-base .label { color: var(--text-muted); }

@media (max-width: 760px), (pointer: coarse) {
  .fs-links a { min-height: 44px; display: inline-flex; align-items: center; }
}

@media (max-width: 900px) {
  /* The two middle blocks stop being columns. At this width seven columns of
     claim beside four of record leaves both too narrow to read. */
  .fs-claim, .fs-record { grid-column: 1 / -1; }
  .fs-record { margin-top: 32px; }
  .fs-inner { padding: 40px 24px 26px; }
  .fs-name { margin-top: 40px; }
}

@media (max-width: 700px) {
  .fs-inner { padding: 32px 16px 20px; }
  /* A full screen height is a lot of empty room on a phone once the type has
     come down; let it be as tall as it needs to be instead. */
  .fs { min-height: 0; }
}
`;

export function FooterStatement() {
  const tasks = demoTasks();
  const judged = tasks.filter((t) => t.verdictJson !== null);
  const settled = tasks.filter((t) => t.state === "SETTLED");

  // Median seconds from submission to decision, over the records that were
  // actually decided. Median rather than mean: with a handful of records one
  // slow verdict drags a mean somewhere no individual record ever was.
  const gaps = judged
    .filter((t) => t.submittedAt && t.decidedAt)
    .map((t) => (t.decidedAt!.getTime() - t.submittedAt!.getTime()) / 1000)
    .sort((a, b) => a - b);
  const median = gaps.length
    ? Math.round(gaps[Math.floor((gaps.length - 1) / 2)])
    : null;

  return (
    <footer className="fs">
      <style>{STAT_CSS}</style>

      <div className="fs-inner">
        <p className="label fs-eyebrow">RUBRIC PROTOCOL · AI-JUDGED ESCROW ON SOLANA</p>

        <div className="fs-claim">
          <p className="fs-lede">
            The criteria are sealed before the work starts.
          </p>
          <p className="fs-sub">
            A poster writes the acceptance criteria, hashes them on-chain and
            funds the escrow. Nobody can edit them afterwards — not the poster,
            not the platform. An AI judge rules on each sealed clause in the
            open, and the program pays or refunds on that verdict alone.
          </p>
        </div>

        <div className="fs-record">
          {/* Every figure is counted from the seeded records at render. None of
              them is written into this component, so none of them can drift
              away from what the docket actually contains. */}
          <dl className="fs-figures">
            <div className="fs-fig">
              <dt className="label">MATTERS ON RECORD</dt>
              <dd className="data">{tasks.length}</dd>
            </div>
            <div className="fs-fig">
              <dt className="label">JUDGED</dt>
              <dd className="data">{judged.length}</dd>
            </div>
            <div className="fs-fig">
              <dt className="label">ESCROW RELEASED</dt>
              <dd className="data">{settled.length}</dd>
            </div>
            {median !== null && (
              <div className="fs-fig">
                <dt className="label">MEDIAN TO VERDICT</dt>
                <dd className="data">{median}s</dd>
              </div>
            )}
          </dl>
        </div>

        <p className="fs-name">RUBRIC</p>

        <div className="fs-base">
          <span className="fs-links">
            <Link href="/docket">The docket</Link>
            <Link href="/create">Create a task</Link>
            <Link href="/my-work">My work</Link>
          </span>
          <span className="label">
            BUILT ON SOLANA · USDC ESCROW · SEEDED SAMPLE
          </span>
        </div>
      </div>
    </footer>
  );
}

export default FooterStatement;
