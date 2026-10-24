/**
 * The landing page's copy, as data, so it can be tested.
 *
 * WHY THIS IS NOT JUST JSX
 * ------------------------
 * This page is the first thing a person sees and the one place with no real data
 * behind it, so it is where a number can most easily be mistaken for a result. Three
 * things went wrong here at once, and each is now a test rather than a good intention:
 *
 *  - A scripted ruling was headed "LIVE", with a pulsing dot, as if it were a feed. It
 *    was a seeded sample. On mainnet that is a depiction of activity that did not
 *    happen, which is exactly what this protocol exists to rule out.
 *  - "Median verdict: 41 seconds" and "in under a second" were stated as fact outside
 *    the figures that carried a "targets" note.
 *  - "finality 0.4s" named a slot time as finality.
 *
 * Nothing here is a measurement. Where a number is a goal it says TARGET, and where it
 * is a property of the code it is under BY DESIGN (lib/constants.ts, FIGURES).
 *
 * `unlabelledTimingClaims` is the check, and `landingStrings` is everything the page
 * says in words that lives here or in the constants.
 */

import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  FIGURES,
  FIGURE_TAGS,
  FIGURES_NOTE,
  MARQUEE_ITEMS,
} from "./constants";

/** What the illustrated ruling is called, wherever it appears. */
export const EXAMPLE_HEADING = "EXAMPLE";

/**
 * The words that mark an illustration as an illustration, shown directly under it. It
 * must never be possible to read the log as a feed or as a real matter.
 */
export const LOG_CAPTION =
  "An illustration of one ruling. It is not a live feed and it is not a real matter.";

export const STEPS = [
  {
    n: 1,
    title: "Seal",
    body: "Write the clauses that define what counts as done, and fund the bounty. Both lock at a Solana address the moment you seal. Nobody can move the goalposts afterward, including us.",
  },
  {
    n: 2,
    title: "Judge",
    body: "A worker, human or AI agent, submits. The judge reads only the sealed clauses and rules on each one in the open: pass, fail, and why. If it is not confident enough, nothing moves and the task is held. Target median verdict: 41 seconds.",
  },
  {
    n: 3,
    title: "Paid",
    body: "Approval releases the escrow in the same transaction as the verdict and records an on-chain attestation. Rejection refunds the poster, with the reasoning attached.",
  },
] as const;

/**
 * The illustrated ruling. Deliberately no timing on the payout line: how fast a payout
 * confirms is a claim about Solana, not something this page can show.
 */
export const LOG_LINES: ReadonlyArray<{ time: string; body: string; verdict?: string }> = [
  { time: "14:02:41", body: "submission received — 500 of 500 labels" },
  { time: "14:02:42", body: "clause 1 sampled 50, focus check", verdict: "PASS" },
  { time: "14:02:53", body: "clause 2 twelve blurred frames excluded", verdict: "PASS" },
  { time: "14:03:07", body: "clause 3 one label per image", verdict: "PASS" },
  { time: "14:03:22", body: "verdict approved — confidence 96" },
  { time: "14:03:22", body: "escrow released to the worker" },
];

export const LOG_HEADING = "Every verdict cites a clause";

/**
 * What the code actually does, not what the chain guarantees. The judge refuses to
 * issue a rejection it cannot tie to a failed clause (it holds the task instead), but
 * the program does not check that, so this does not say "impossible".
 */
export const LOG_BODY =
  "A rejection that cannot point to a sealed clause is held, not issued. The judge can only argue from what was agreed before the work started.";

/**
 * The example matter drawn by the hero. A real record number is NOT part of it: on a
 * deployment with real tasks, "matter 42" would be somebody else's.
 */
export const HERO_EXAMPLE = {
  confidence: 94,
  threshold: DEFAULT_CONFIDENCE_THRESHOLD,
  clauses: 3,
  passed: 3,
} as const;

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * A duration or speed stated as a plain fact: "41 seconds", "0.4s", "under a second",
 * "in a second". Not "ease-out 0.4s" in CSS: this is only run over copy.
 */
const TIMING = /\b(\d+(?:\.\d+)?\s?(?:ms|s|seconds?|minutes?)\b|(?:under|within|in|about)\s+(?:a|one)\s+(?:second|minute))/gi;

/** Words that make a timing a goal rather than a result. */
const QUALIFIER = /\b(target|goal|aim)\b/i;

/**
 * Timing claims in `text` that are not marked as a target in the same sentence.
 * A sentence is split on . ! ? and the em dash used as a separator in the log.
 */
export function unlabelledTimingClaims(text: string): string[] {
  const found: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const hits = sentence.match(TIMING);
    if (hits && !QUALIFIER.test(sentence)) found.push(...hits);
  }
  return found;
}

/**
 * Every sentence the landing page says in words, from this module and the constants.
 * (The hero's own headline and the nav are not claims.)
 */
export function landingStrings(): string[] {
  return [
    ...STEPS.map((s) => s.body),
    LOG_BODY,
    LOG_CAPTION,
    LOG_HEADING,
    FIGURES_NOTE,
    // The tag is rendered beside every figure, so it is part of what the page says.
    ...FIGURES.map((f) => `${f.value} ${f.label} ${FIGURE_TAGS[f.kind]}`),
    ...MARQUEE_ITEMS,
  ];
}
