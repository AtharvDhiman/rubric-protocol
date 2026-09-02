import { demoTasks } from "@/lib/demo";
import { FooterReveal } from "@/components/FooterReveal";

/**
 * THE STATEMENT - the landing page footer.
 *
 * A full-viewport-height closing panel on a twelve-column grid, with its blocks
 * staggered in as it arrives.
 *
 * WHERE IT COMES FROM
 * -------------------
 * unionspaces.co.uk, measured rather than described: footer height 860px
 * against an inner height of 860, so exactly 100vh; twelve equal 83.7px
 * columns; and one link in the whole element, closing on prose and an address
 * instead of a sitemap.
 *
 * What it is NOT, and this was worth measuring twice: there is no sticky
 * reveal. The footer is `position: static`. The page above it does not slide
 * off a pinned panel - the blocks are simply parked and brought in as the
 * footer is scrolled to. A `div.pin-spacer` does sit before it, so GSAP pins
 * something on that page, but it is not this.
 *
 * That matters here for a structural reason as well as a factual one. This site
 * runs a full-bleed shader field at `position: fixed; inset: 0`, and a sticky
 * reveal needs the page content to be OPAQUE so it can hide the footer until it
 * is revealed - which is exactly what would hide the field. The two are
 * mutually exclusive, and the reference does not ask for the one that loses.
 *
 * WHY THIS AND NOT A DEVICE
 * -------------------------
 * The candidates it beat were all concept-led - a hash panel, a confidence
 * plot, a cited refusal, a ledger - and each was a clever thing. None of them
 * was making an argument about presence. This one uses the full height of the
 * screen as its material, which is a different kind of claim and the one the
 * bottom of a page is actually good at.
 *
 * A full screen of height still has to be earned, so it is not an empty panel
 * with a wordmark in it: the left column carries the claim at reading size and
 * the right carries the record.
 *
 * It is on the landing page ONLY. It was briefly mounted in AppShell, which put
 * a full screen of closing argument underneath the docket - and somebody
 * scanning a table of matters is on a task, not being persuaded.
 *
 * The name rises out of a mask rather than fading in, and there are no links in
 * the baseline: the header already carries the whole nav, and three more copies
 * of it under a 168px wordmark was a sitemap arguing with a statement.
 *
 * NOTHING IS WRITTEN INTO IT
 * --------------------------
 * Every figure is COUNTED from lib/demo.ts at render - matters on record,
 * judged, escrow released, median seconds to verdict - so none of them can
 * drift from what the docket actually contains.
 *
 * CONTRAST on --page: --text 13.36:1 - --text-2 9.53:1 - --text-muted 6.14:1 -
 * --accent 5.36:1 - --hairline 3.14:1 as a graphic. No volume ink appears; none
 * is legal on this ground.
 */

const FOOTER_CSS = `
.fs {
  display: flex;
  flex-direction: column;
  /* svh, not vh: on mobile Safari vh is the LARGEST viewport, so a 100vh footer
     is taller than the screen whenever the toolbar is showing and its baseline
     sits below the fold. */
  min-height: 100svh;
  background: var(--page);
  border-top: 1px solid var(--border);
}

.fs-inner {
  flex: 1;
  display: grid;
  /* Twelve columns, as the reference. minmax(0, 1fr) rather than 1fr: a bare
     1fr takes its content as an automatic minimum, which is how a wide child
     silently forces horizontal overflow on the whole document. */
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 0 24px;
  align-content: space-between;
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
  padding: 56px 32px 32px;
}

.fs-eyebrow {
  grid-column: 1 / -1;
  margin: 0 0 auto;
  color: var(--text-muted);
}

.fs-claim { grid-column: 1 / span 7; margin: 48px 0 0; }
.fs-record { grid-column: 9 / -1; margin: 48px 0 0; }

.fs-lede {
  margin: 0;
  font-family: var(--font-sans);
  font-size: clamp(24px, 3.4vw, 42px);
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

.fs-figures { display: grid; gap: 0; margin: 0; }
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

/* THE NAME, AND ITS RISE.

   The wrapper is the mask. It clips, and the word inside starts below the clip
   line and travels up into place - so the letters are revealed by the edge
   rather than faded in. That is why the wrapper exists at all; without
   overflow: hidden the word would simply slide up from the figures above it,
   which reads as a slip rather than as a reveal.

   The bottom padding is not spacing. line-height 0.86 pulls the line box
   tighter than the capitals, so at 168px the glyph bottoms sit within a pixel
   or two of the box edge and the mask shaves them. 0.08em of clearance puts the
   clip line just below the baseline where it belongs. */
.fs-namewrap {
  grid-column: 1 / -1;
  margin: 56px 0 0;
  overflow: hidden;
  padding-bottom: 0.08em;
}

.fs-name {
  display: block;
  font-family: var(--font-sans);
  /* clamp(), never raw vw. A viewport unit ignores the root font size, so a
     reader who has zoomed the page gets no larger type at all. */
  font-size: clamp(64px, 13vw, 168px);
  font-variation-settings: "wdth" 118;
  font-weight: 700;
  letter-spacing: -0.05em;
  line-height: 0.86;
  color: var(--text);

}

/* THE RISE, AND THE DARKENING.

   Both are read off one number: --fr-p, the share of the way the footer has
   come into view, written by FooterReveal on every block. Because it is a
   position rather than a trigger, the whole thing is reversible for free -
   scroll toward the footer and the name climbs out of the mask and deepens,
   scroll away and it goes back down and pales, at exactly the speed the reader
   is moving.

   data-reveal sits on the NAME rather than on the mask around it. Arming the
   wrapper while animating the child meant two elements had to agree about one
   move, and the previous trigger's own cycle raced against it.

   Only the DISTANCE and the COLOUR are overridden here. When it moves and how
   far through it is stay with FooterReveal.

   104% rather than 100%: at this letter-spacing the glyph box and the ink do
   not quite agree, and a whole 100% still leaves a hairline of the R showing
   at the clip. */
.fr-host .fs-name[data-reveal] {
  /* Never fades. This block is revealed by the mask edge, and a fade on top of
     that reads as two effects applied to one object. */
  opacity: 1;
  transform: translateY(calc((1 - var(--fr-p, 1)) * 104%));

  /* THE DARKENING. Pale as it clears the mask, full ink once it lands - so the
     word appears to gain weight on the way up rather than simply arriving.
     Both ends are real tokens: --text-faint is 4.92:1 on the plate and --text
     is 13.36:1, so the type never passes through a value that would fail on
     its own, and the resting state is the one the rest of the page uses.

     color-mix is the whole mechanism, so on an engine without it the
     declaration is dropped and the name is simply --text throughout. Dimmer
     for a moment on the way in is the only thing lost. */
  color: color-mix(
    in srgb,
    var(--text) calc(var(--fr-p, 1) * 100%),
    var(--text-faint)
  );

  /* Transform and colour only - never a height, a margin or a font-size - so
     the move runs on the compositor and can never reflow the page behind it. */
  /* Matches FooterReveal's catch-up exactly. The name is the heaviest thing
     here and the most obviously wrong if it drifts out of step with the blocks
     around it, so the duration and the curve are the same numbers rather than
     a second opinion about them. */
  transition:
    transform 700ms cubic-bezier(0.65, 0, 0.35, 1),
    color 700ms cubic-bezier(0.65, 0, 0.35, 1);
}

.fs-base {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  /* The links are gone, so the colophon sits at the end of the rule on its own
     rather than drifting to the left of a full-width line. */
  justify-content: flex-end;
  gap: 14px 28px;
  flex-wrap: wrap;
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.fs-base .label { color: var(--text-muted); }

@media (max-width: 900px) {
  /* Seven columns of claim beside four of record leaves both too narrow to
     read, so they stop being columns. */
  .fs-claim, .fs-record { grid-column: 1 / -1; }
  .fs-record { margin-top: 32px; }
  .fs-inner { padding: 40px 24px 26px; }
  .fs-name { margin-top: 40px; }
}

@media (max-width: 700px) {
  .fs-inner { padding: 32px 16px 20px; }
  /* A full screen of height is mostly empty room once the type has come down. */
  .fs { min-height: 0; }
}
`;

export function SiteFooter() {
  const tasks = demoTasks();
  const judged = tasks.filter((t) => t.verdictJson !== null);
  const settled = tasks.filter((t) => t.state === "SETTLED");

  // Median seconds from submission to decision, over records actually decided.
  // Median rather than mean: across a handful of records one slow verdict drags
  // a mean to a value no individual record ever had.
  const gaps = judged
    .filter((t) => t.submittedAt && t.decidedAt)
    .map((t) => (t.decidedAt!.getTime() - t.submittedAt!.getTime()) / 1000)
    .sort((a, b) => a - b);
  const median = gaps.length
    ? Math.round(gaps[Math.floor((gaps.length - 1) / 2)])
    : null;

  return (
    <footer className="fs">
      <style>{FOOTER_CSS}</style>

      <FooterReveal>
        <div className="fs-inner">
          <p className="label fs-eyebrow" data-reveal>
            RUBRIC PROTOCOL · AI-JUDGED ESCROW ON SOLANA
          </p>

          <div className="fs-claim" data-reveal>
            <p className="fs-lede">
              The criteria are sealed before the work starts.
            </p>
            <p className="fs-sub">
              A poster writes the acceptance criteria, hashes them on-chain and
              funds the escrow. Nobody can edit them afterwards — not the
              poster, not the platform. An AI judge rules on each sealed clause
              in the open, and the program pays or refunds on that verdict
              alone.
            </p>
          </div>

          <div className="fs-record" data-reveal>
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

          <div className="fs-namewrap">
            <p className="fs-name" data-reveal>
              RUBRIC
            </p>
          </div>

          <div className="fs-base" data-reveal>
            <span className="label">
              BUILT ON SOLANA · USDC ESCROW · SEEDED SAMPLE
            </span>
          </div>
        </div>
      </FooterReveal>
    </footer>
  );
}

export default SiteFooter;
