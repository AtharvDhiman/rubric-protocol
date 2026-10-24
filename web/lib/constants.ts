/**
 * Shared constants for the web app.
 *
 * The figures shown on the landing page live here rather than being inlined in
 * JSX, because each is either a beta TARGET or a BY-DESIGN property, never a measured
 * result. Any screen that renders them must also render the qualifier - see
 * `FIGURES` and `FIGURES_NOTE`.
 */

export const PROTOCOL_NAME = "Rubric";
export const TAGLINE = "Pay on proof, not on trust.";

/**
 * The documented default for `CONFIDENCE_THRESHOLD`, and the ONLY place the
 * number is written down in the web app.
 *
 * It lives here rather than in `lib/verifier.ts` because the UI has to print it
 * (`CONF 94 / THRESHOLD 70 / Δ +24`) and `lib/verifier.ts` pulls in the
 * Anthropic and Google SDKs, which must never be dragged into a screen's
 * bundle. `confidenceThreshold()` in the verifier imports this constant for its
 * fallback, so the number a screen prints and the number the judge actually
 * gates on cannot drift apart.
 *
 * Deliberately NOT re-derived from a `NEXT_PUBLIC_` twin of the env var: two
 * variables that are meant to agree eventually disagree, and a screen stating a
 * threshold the judge did not apply is exactly the fabricated fact this product
 * exists to rule out. Server components read the real value with
 * `confidenceThreshold()` and pass it down as a prop.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 70;

/** Protocol fee in basis points. Mirrors `Config.fee_bps` on-chain. */
export const FEE_BPS = 200;
export const FEE_PERCENT_LABEL = "2%";

/**
 * The bounty cap a deployment is LAUNCHED with: 50 USDC in base units.
 *
 * This is no longer a mirror of anything in the program. The cap lives on-chain in
 * the `Limits` account and the admin can change it, so the UI and the API read it
 * from there (see lib/limits.ts). This constant is only the value the setup
 * scripts pass to `initialize_limits`, i.e. the number we deliberately start low
 * with. Do NOT use it to validate input.
 */
export const LAUNCH_MAX_BOUNTY_BASE_UNITS = 50_000_000;
export const USDC_DECIMALS = 6;

/** Mirrors `MAX_CLAUSES` / `MAX_CLAUSE_LENGTH` in lib/hash.ts. */
export const MAX_CLAUSES = 8;
export const MAX_CLAUSE_LENGTH = 280;
export const CLAUSE_COUNTER_VISIBLE_FROM = 240;

/** Work windows offered on /create, in seconds. */
export const WORK_WINDOWS = [
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "72 hours", seconds: 72 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
] as const;

export const CATEGORIES = [
  "Labeling",
  "Code",
  "Content",
  "Verification",
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Landing-page figures. Every one is tagged with WHAT KIND of statement it is, and the
 * tag is rendered beside it, because the two kinds must never be mistaken for each
 * other - or for a measurement. A protocol whose whole pitch is verifiable claims
 * cannot afford a number that reads as a result and is not one.
 *
 *  - "target":  a goal for the beta. Nothing has measured it. Shown as TARGET.
 *  - "design":  a property of the code or the program, true by construction rather
 *               than by statistics. Shown as BY DESIGN.
 *
 * There is deliberately no "measured" kind. When real figures exist (the docket
 * computes them from real verdicts) they belong next to what they measure, not in a
 * marketing strip.
 *
 * Two figures that used to be here are gone on purpose. "0.4s payment finality" was a
 * slot time worded as finality, which is a different and much longer thing. And "100%
 * of verdicts cite a sealed clause" overclaimed: the judge's code refuses a rejection
 * it cannot tie to a clause, but the program does not check it, so it is not a
 * property of the chain.
 */
export const FIGURES = [
  { value: "41s", label: "Median time to verdict", kind: "target" },
  { value: "1", label: "Transaction to rule and pay", kind: "design" },
  { value: FEE_PERCENT_LABEL, label: "Flat protocol fee", kind: "design" },
  { value: "0", label: "Clauses editable after sealing", kind: "design" },
] as const;

export type FigureKind = (typeof FIGURES)[number]["kind"];

export const FIGURE_TAGS: Record<FigureKind, string> = {
  target: "TARGET",
  design: "BY DESIGN",
};

export const FIGURES_NOTE =
  "TARGET figures are goals for the beta, not measurements. BY DESIGN figures are properties of the code, not statistics.";

export const MARQUEE_ITEMS = [
  "SEAL THE CLAUSES",
  "THE AI JUDGES",
  "VERDICT AND PAYOUT IN ONE TRANSACTION",
  "RECEIPTS FOREVER",
] as const;

/** The four steps of a transaction, rendered by <TxFlow>. */
export const TX_STEPS = [
  "preparing",
  "awaiting-signature",
  "confirming",
  "done",
] as const;
export type TxStep = (typeof TX_STEPS)[number];
