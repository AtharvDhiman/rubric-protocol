/**
 * Shared constants for the web app.
 *
 * The figures shown on the landing page live here rather than being inlined in
 * JSX, because they are PROTOCOL TARGETS during beta, not measured results. Any
 * screen that renders them must also render the qualifier - see `FIGURES_NOTE`.
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

/** Mirrors `MAX_BOUNTY` in the Rust program: 50 USDC in base units. */
export const MAX_BOUNTY_BASE_UNITS = 50_000_000;
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
 * Landing-page figures. TARGETS, not measurements. `FIGURES_NOTE` must be
 * rendered wherever these are - presenting a target as a result is a lie, and a
 * protocol whose whole pitch is verifiable claims cannot afford one.
 */
export const FIGURES = [
  { value: "41s", label: "Median time to verdict" },
  { value: "0.4s", label: "Payment finality on Solana" },
  { value: FEE_PERCENT_LABEL, label: "Flat protocol fee" },
  { value: "100%", label: "Of verdicts cite a sealed clause" },
] as const;

export const FIGURES_NOTE = "Figures are protocol targets during beta.";

export const MARQUEE_ITEMS = [
  "SEAL THE CLAUSES",
  "THE AI JUDGES",
  "SOLANA PAYS IN 0.4s",
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
