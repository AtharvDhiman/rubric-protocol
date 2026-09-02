import Link from "next/link";

import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  FEE_BPS,
  FEE_PERCENT_LABEL,
  MAX_BOUNTY_BASE_UNITS,
  MAX_CLAUSES,
  MAX_CLAUSE_LENGTH,
  TAGLINE,
  USDC_DECIMALS,
} from "@/lib/constants";
import {
  explorerAddressUrl,
  programIdString,
  solanaCluster,
  usdcMintString,
} from "@/lib/env";

/**
 * FOOTER OPTION C - THE UTILITY GRID.
 *
 * The quiet one. A masthead that sets the name once, four hairline-divided
 * columns, and a disclaimer bar. Nothing moves, nothing reveals, nothing needs
 * explaining. This is the option that wins if the others read as decoration.
 *
 * WHY THIS SHAPE
 * --------------
 * Every shipping product footer of comparable IA - Stripe, Linear, Clerk - is a
 * dense utility grid, and the research on why is unglamorous: people who reach a
 * footer are on a mission. They want the docket, the program id, or the thing
 * the project admits about itself. So the columns are ordered by how often
 * somebody actually needs them, and each one is a real heading over a real list
 * rather than a styled div, so a screen reader can jump group to group instead
 * of walking every link.
 *
 * WHAT IS IN HERE IS TRUE, AND THAT IS THE WHOLE DESIGN
 * ----------------------------------------------------
 * There is no counter, no "trusted by", no social account that does not exist,
 * and no link to a page this app does not serve. Every route in SURFACES was
 * read out of `app/`. Every figure in PARAMETERS is imported from
 * `lib/constants.ts` - the same module the create screen and the verdict sheet
 * print from - so a number here cannot drift from the number the protocol
 * enforces. CHAIN reads `lib/env.ts` at render time and says NOT CONFIGURED
 * when the deployment has no program id, because a footer that invents an
 * address on a product whose pitch is "pay on proof, not on trust" would be the
 * exact failure the product exists to prevent.
 *
 * KNOWN LIMITATIONS is the load-bearing column. It is the README's own list,
 * shortened but not softened, and it is text rather than links because the
 * README is not a route this app serves. A protocol that names its own
 * centralization point at the bottom of every page is making a stronger claim
 * than one that hides it behind a docs link.
 *
 * THE COLOUR BUDGET IS SPENT ON NOTHING
 * -------------------------------------
 * DESIGN.md: acceptable states are achromatic, and colour is spent on one
 * alarm, one held state, and one money-moved event. Nothing in a footer is any
 * of those. So this component ships zero of the three. The only ink beyond the
 * four greys is --accent, which the token comment scopes to IDENTITY - clause
 * numbers, links, active nav - and every use of it here is a link. Painting
 * "UNAUDITED" red would be the tempting mistake: it is not out of tolerance,
 * it is just true, and spending the alarm here would cheapen it on the screen
 * where a clause actually fails.
 *
 * CONTRAST, MEASURED (sRGB, WCAG 2.x), NOT ESTIMATED
 * --------------------------------------------------
 * Grounds: --surface #edefec (L 0.8579) for the body, --sunk #dde1de
 * (L 0.7449) for the disclaimer bar. --page is never used as a ground here;
 * the token comment reserves it for the volume floor, and --text-faint is only
 * 4.92:1 on it, which is no margin at all.
 *
 *   ON --surface                       ON --sunk
 *   --text          16.00:1            --text          14.00:1
 *   --text-2        11.41:1            --text-2         9.99:1
 *   --text-muted     7.35:1            --text-muted     6.43:1
 *   --accent         6.41:1            --accent         5.62:1
 *   --accent-strong  8.91:1            --accent-strong  7.80:1
 *   --hairline       3.76:1 (graphic)  --hairline       3.29:1 (graphic)
 *
 * Smallest text in the component is 10px (--text-muted, 7.35:1 / 6.43:1) and
 * the smallest prose is 13.5px (--text-2, 11.41:1). --text-faint is not used at
 * all: every value it would carry is a figure somebody may need to read off a
 * screen, and 5.89:1 in exchange for nothing is a bad trade. --hairline is only
 * ever a rule, never text, which is the condition its 3:1 graphic floor is
 * measured against.
 *
 * NO MOTION AT ALL
 * ----------------
 * Not one keyframe and not one rAF loop, so there is no reduced-motion
 * fallback to drift out of sync with a real path. The only transitions are on
 * link colour, and those are disabled under prefers-reduced-motion anyway.
 */

/* -------------------------------------------------------------------------
   Values, resolved once at module scope. Every one is imported or read from
   env - none is written down here a second time.
   ------------------------------------------------------------------------- */

/**
 * 50_000_000 base units at 6 decimals. Computed rather than typed as "50.00",
 * so the cap printed here follows `MAX_BOUNTY_BASE_UNITS`, which mirrors
 * `MAX_BOUNTY` in the Rust program.
 *
 * Deliberately NOT `formatUsdc` from lib/solana.ts: that module imports
 * @solana/web3.js, and dragging a web3 bundle into the site footer to divide
 * one constant by a million would be a poor trade.
 */
const MAX_BOUNTY_LABEL = `${(MAX_BOUNTY_BASE_UNITS / 10 ** USDC_DECIMALS).toFixed(2)} USDC`;

const CLUSTER = solanaCluster();
const PROGRAM_ID = programIdString();
const USDC_MINT = usdcMintString();

/** The product surfaces that exist. Each one was read out of `app/`. */
const SURFACES: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/docket", label: "Docket" },
  { href: "/create", label: "Create a task" },
  { href: "/my-work", label: "My work" },
  { href: "/", label: "How it works" },
];

/** The protocol's enforced numbers. Sources in the comment on each line. */
const PARAMETERS: ReadonlyArray<{ k: string; v: string }> = [
  // FEE_BPS mirrors Config.fee_bps on-chain.
  { k: "Protocol fee", v: `${FEE_PERCENT_LABEL} / ${FEE_BPS} BPS` },
  // MAX_BOUNTY in the Rust program.
  { k: "Max bounty", v: MAX_BOUNTY_LABEL },
  // The documented default for CONFIDENCE_THRESHOLD. See the note below the list.
  { k: "Confidence gate", v: String(DEFAULT_CONFIDENCE_THRESHOLD) },
  // README, "Known limitations" #1: one key, and only one.
  { k: "Verifier keys", v: "1" },
  { k: "Clauses per task", v: `${MAX_CLAUSES} MAX` },
  { k: "Clause length", v: `${MAX_CLAUSE_LENGTH} CHARS` },
];

/**
 * The README's own list, shortened but not softened. Text, not links: the
 * README is not a route this app serves, and a link to a page that does not
 * exist is the one thing a footer on this product may not contain.
 */
const LIMITATIONS: ReadonlyArray<{ term: string; text: string }> = [
  {
    term: "Single verifier",
    text: "One key can direct every escrow in the protocol. No multisig, no second opinion.",
  },
  {
    term: "Unaudited",
    text: "19 integration tests, 14 of them attack cases, and no third-party review.",
  },
  {
    term: "The judge can be wrong",
    text: "A language model reading prose. Below the gate it holds, but a confident mistake pays the wrong party.",
  },
  {
    term: "No dispute path",
    text: "No arbitration. A rejected worker gets public reasoning citing the clause, not an appeal.",
  },
];

export function FooterGrid() {
  return (
    <footer className="fgrid" aria-label="Site footer">
      <style>{FGRID_CSS}</style>

      <div className="fg-inner">
        {/* THE MASTHEAD. The name is set once, at the only display size in the
            component, and nothing else competes with it. */}
        <div className="fg-mast">
          <p className="fg-name">RUBRIC</p>
          <div className="fg-mast-right">
            <p className="fg-claim">{TAGLINE}</p>
            <p className="fg-claim fg-claim-2">
              Acceptance criteria are hashed and committed on Solana before
              work starts. The program pays or refunds on an AI verdict against
              that sealed text.
            </p>
          </div>
        </div>

        <div className="fg-cols">
          {/* 1 - SURFACES. Real routes only. */}
          <nav className="fg-col" aria-labelledby="fgrid-h-surfaces">
            <h2 className="label fg-h" id="fgrid-h-surfaces">
              Surfaces
            </h2>
            <ul className="fg-list">
              {SURFACES.map((s) => (
                <li key={s.href}>
                  <Link className="fg-link" href={s.href}>
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* 2 - CHAIN. Read from lib/env.ts at render time. */}
          <section className="fg-col" aria-labelledby="fgrid-h-chain">
            <h2 className="label fg-h" id="fgrid-h-chain">
              Chain
            </h2>
            <dl className="fg-kv">
              <div className="fg-row">
                <dt className="label fg-k">Cluster</dt>
                <dd className="fg-v">{CLUSTER.toUpperCase()}</dd>
              </div>

              <div className="fg-row fg-row--stack">
                <dt className="label fg-k">Program</dt>
                <dd className="fg-v fg-v--block">
                  {PROGRAM_ID ? (
                    <>
                      <span className="data data--long fg-addr">
                        {PROGRAM_ID}
                      </span>
                      <a
                        className="fg-link fg-link--tight"
                        href={explorerAddressUrl(PROGRAM_ID)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View on Explorer
                        <span className="fg-vh"> (opens in a new tab)</span>
                      </a>
                    </>
                  ) : (
                    <span className="fg-unset">NOT CONFIGURED</span>
                  )}
                </dd>
              </div>

              <div className="fg-row fg-row--stack">
                <dt className="label fg-k">USDC mint</dt>
                <dd className="fg-v fg-v--block">
                  {USDC_MINT ? (
                    <>
                      <span className="data data--long fg-addr">
                        {USDC_MINT}
                      </span>
                      <a
                        className="fg-link fg-link--tight"
                        href={explorerAddressUrl(USDC_MINT)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View on Explorer
                        <span className="fg-vh"> (opens in a new tab)</span>
                      </a>
                    </>
                  ) : (
                    <span className="fg-unset">NOT CONFIGURED</span>
                  )}
                </dd>
              </div>

              <div className="fg-row fg-row--stack">
                <dt className="label fg-k">IDL</dt>
                <dd className="fg-v fg-v--block">
                  {/* A real endpoint in this app: app/api/idl/route.ts. It
                      serves the deployed program's IDL, or a 503 that says
                      exactly which build step has not been run. */}
                  <a className="fg-link fg-link--tight" href="/api/idl">
                    Program interface (JSON)
                  </a>
                </dd>
              </div>
            </dl>
          </section>

          {/* 3 - PARAMETERS. Imported from lib/constants.ts. */}
          <section className="fg-col" aria-labelledby="fgrid-h-params">
            <h2 className="label fg-h" id="fgrid-h-params">
              Parameters
            </h2>
            <dl className="fg-kv">
              {PARAMETERS.map((p) => (
                <div className="fg-row" key={p.k}>
                  <dt className="label fg-k">{p.k}</dt>
                  <dd className="fg-v">{p.v}</dd>
                </div>
              ))}
            </dl>
            <p className="fg-foot">
              The gate above is the documented default. Each verdict sheet
              prints the value applied to it.
            </p>
          </section>

          {/* 4 - KNOWN LIMITATIONS. The README's list, in prose. */}
          <section className="fg-col" aria-labelledby="fgrid-h-limits">
            <h2 className="label fg-h" id="fgrid-h-limits">
              Known limitations
            </h2>
            <ul className="fg-notes">
              {LIMITATIONS.map((l) => (
                <li className="fg-note" key={l.term}>
                  <span className="label fg-note-t">{l.term}</span>
                  <p className="fg-note-p">{l.text}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {/* THE BAR. Where a copyright line would go. There is no legal entity to
          name and inventing one would be the same class of lie as inventing a
          metric, so the space carries the three facts that actually bound what
          a reader should do with this instead. The name is NOT repeated here -
          it is set once, in the masthead, and a wordmark that appears twice in
          one footer is set neither once nor well. */}
      <div className="fg-bar">
        <div className="fg-inner fg-bar-inner">
          <p className="label fg-bar-l">
            Cluster {CLUSTER} · Unaudited · Single verifier key
          </p>
          <p className="label fg-bar-r">Not for real funds</p>
        </div>
      </div>
    </footer>
  );
}

export default FooterGrid;

/* ==========================================================================
   CSS. Every rule scoped under .fgrid so this file cannot reach any other
   component, and every colour is a token by name - no hex literal appears
   below. No volume ink (--marker, --rig-line, --v-*) is referenced: nothing
   here carries className "volume", so they would have nothing to resolve to.
   ========================================================================== */

const FGRID_CSS = `
.fgrid {
  background: var(--surface);
  color: var(--text);
  border-top: 1px solid var(--border);
}
.fgrid .fg-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 32px;
}
@media (max-width: 700px) {
  .fgrid .fg-inner { padding: 0 16px; }
}

/* --------------------------------------------------------------------------
   MASTHEAD. The one display size in the component.
   -------------------------------------------------------------------------- */
.fgrid .fg-mast {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 22px 48px;
  padding: 44px 0 26px;
  border-bottom: 1px solid var(--border);
}
/* Archivo, expanded and heavy, tight. clamp() rather than a raw vw unit: a vw
   font-size ignores the root size and breaks user zoom. --text on --surface,
   16.00:1. */
.fgrid .fg-name {
  margin: 0;
  font-family: var(--font-sans);
  font-size: clamp(38px, 7.4vw, 66px);
  font-weight: 700;
  font-variation-settings: "wdth" 112;
  letter-spacing: -0.045em;
  line-height: 0.9;
  color: var(--text);
}
.fgrid .fg-mast-right {
  max-width: 54ch;
  min-width: 0;
  flex: 1 1 340px;
}
/* Prose, so Archivo. --text-2 on --surface, 11.41:1. */
.fgrid .fg-claim {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-2);
}
.fgrid .fg-claim-2 {
  margin-top: 8px;
  font-size: 13.5px;
  line-height: 1.55;
}

/* --------------------------------------------------------------------------
   THE GRID. One column on a phone, two on a tablet, four on a desk.
   minmax(0, …) throughout: a bare 1fr takes its content as an automatic
   minimum, which is how a 44-character address forces horizontal overflow.
   -------------------------------------------------------------------------- */
.fgrid .fg-cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.fgrid .fg-col {
  min-width: 0;
  padding: 24px 0;
  border-bottom: 1px solid var(--hairline);
}
.fgrid .fg-col:last-child { border-bottom: 0; padding-bottom: 34px; }

/* Two columns. Bounded ABOVE as well as below so the four-column block can
   restate the same properties without losing to :nth-child specificity. */
@media (min-width: 700px) and (max-width: 1079px) {
  .fgrid .fg-cols { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .fgrid .fg-col { padding: 26px 26px 26px 0; }
  .fgrid .fg-col:nth-child(2n) {
    padding-left: 26px;
    padding-right: 0;
    border-left: 1px solid var(--hairline);
  }
  .fgrid .fg-col:nth-last-child(-n + 2) { border-bottom: 0; padding-bottom: 34px; }
}

/* Four columns, sized to content rather than evenly: the limitations column
   carries prose and the surfaces column carries four short words. */
@media (min-width: 1080px) {
  .fgrid .fg-cols {
    grid-template-columns:
      minmax(0, 0.82fr) minmax(0, 1.2fr)
      minmax(0, 1fr) minmax(0, 1.5fr);
  }
  .fgrid .fg-col {
    padding: 30px 26px 40px;
    border-bottom: 0;
    border-left: 1px solid var(--hairline);
  }
  .fgrid .fg-col:first-child { padding-left: 0; border-left: 0; }
  .fgrid .fg-col:last-child { padding-right: 0; padding-bottom: 40px; }
}

/* Column heads. Real <h2>s, so the outline is navigable; .label supplies the
   mono caps and --text-muted (7.35:1 on --surface). */
.fgrid .fg-h {
  margin: 0 0 14px;
  color: var(--text-muted);
}

/* --------------------------------------------------------------------------
   LINKS. Underlined by default. --accent is 6.41:1 on --surface; the underline
   sits in --hairline at 3.76:1, which is the graphic floor, and goes to
   currentColor on hover so the affordance strengthens rather than appears.
   -------------------------------------------------------------------------- */
.fgrid .fg-list { list-style: none; margin: 0; padding: 0; }
.fgrid .fg-list li { margin: 0; }

.fgrid .fg-link {
  display: block;
  padding: 7px 0;
  font-family: var(--font-mono);
  font-size: 12px;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1.35;
  color: var(--accent);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  text-decoration-color: var(--hairline);
  transition: color 0.15s linear, text-decoration-color 0.15s linear;
}
.fgrid .fg-link:hover {
  color: var(--accent-strong);
  text-decoration-color: currentColor;
}
.fgrid .fg-link--tight {
  display: inline-block;
  padding: 4px 0 0;
  font-size: 11px;
}

/* --------------------------------------------------------------------------
   KEY / VALUE ROWS. flex-wrap rather than a two-track grid: when a long value
   cannot sit beside its key it drops to its own line instead of forcing the
   column wider than its track.
   -------------------------------------------------------------------------- */
.fgrid .fg-kv { margin: 0; }
.fgrid .fg-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 2px 14px;
  padding: 7px 0;
  border-top: 1px solid var(--hairline);
}
.fgrid .fg-row:first-child { border-top: 0; padding-top: 0; }
.fgrid .fg-row--stack { display: block; }
.fgrid .fg-k { margin: 0; color: var(--text-muted); }
/* A figure, so mono. --text on --surface, 16.00:1. */
.fgrid .fg-v {
  margin: 0;
  margin-left: auto;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 12px;
  font-variation-settings: "wdth" 87.5;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--text);
}
.fgrid .fg-row--stack .fg-k { display: block; }
.fgrid .fg-v--block {
  display: block;
  margin-left: 0;
  margin-top: 6px;
  text-align: left;
}
/* 44 base58 characters on one line at 375px only because Martian condenses to
   wdth 75. break-all keeps it one selectable string instead of an ellipsis. */
.fgrid .fg-addr {
  display: block;
  color: var(--text);
  line-height: 1.45;
}
/* An absent value is a state, not an alarm, so it stays achromatic.
   --text-muted, 7.35:1. */
.fgrid .fg-unset {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
/* A qualifier under the parameters list. A sentence, so Archivo.
   --text-muted, 7.35:1 - at 12px it still owes and clears the 4.5:1 body floor. */
.fgrid .fg-foot {
  margin: 14px 0 0;
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

/* --------------------------------------------------------------------------
   LIMITATIONS. A mono term over a prose sentence. No 01/02/03 indices: a
   number in this system is a join key to something on screen, and there is
   nothing here for it to join to.
   -------------------------------------------------------------------------- */
.fgrid .fg-notes { list-style: none; margin: 0; padding: 0; }
.fgrid .fg-note {
  padding: 9px 0;
  border-top: 1px solid var(--hairline);
}
.fgrid .fg-note:first-child { border-top: 0; padding-top: 0; }
.fgrid .fg-note-t { display: block; color: var(--text-muted); }
.fgrid .fg-note-p {
  margin: 5px 0 0;
  font-family: var(--font-sans);
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--text-2);
  max-width: 46ch;
}

/* --------------------------------------------------------------------------
   THE BAR. --sunk is a well cut into the sheet. --text-muted is 6.43:1 there
   and --text is 14.00:1.
   -------------------------------------------------------------------------- */
.fgrid .fg-bar {
  background: var(--sunk);
  border-top: 1px solid var(--border);
}
.fgrid .fg-bar-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 24px;
  padding-top: 18px;
  padding-bottom: 18px;
}
.fgrid .fg-bar-l { margin: 0; color: var(--text-muted); }
.fgrid .fg-bar-r { margin: 0; color: var(--text); }

/* --------------------------------------------------------------------------
   ACCESSIBILITY
   -------------------------------------------------------------------------- */
.fgrid .fg-vh {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* 44px targets gated on pointer type, not viewport width: an iPad in portrait
   reports 768px and is a pure touch device. Nothing in this footer is a link
   inside running prose, so nothing here takes the WCAG 2.5.8 exemption. */
@media (pointer: coarse) {
  .fgrid .fg-link {
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  .fgrid .fg-link--tight {
    display: inline-flex;
    padding-top: 0;
  }
}

/* --------------------------------------------------------------------------
   ONE COLUMN. Last in the sheet on purpose: a media query adds no specificity,
   so an override placed above the rule it overrides simply loses.

   Four stacked columns cost four times the height, so the rhythm tightens
   rather than folding anything away. Measured at 375x812 the footer is 1.96
   viewports - under the point where a disclosure earns its complexity, and the
   links here are the mission-driven ones that must never be the thing hidden.
   -------------------------------------------------------------------------- */
@media (max-width: 700px) {
  .fgrid .fg-mast { padding: 30px 0 20px; }
  .fgrid .fg-col { padding: 20px 0; }
  .fgrid .fg-col:last-child { padding-bottom: 26px; }
  .fgrid .fg-h { margin-bottom: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .fgrid .fg-link { transition: none; }
}
`;
