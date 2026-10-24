/**
 * Turning a traction report into words and JSON.
 *
 * The page and the script both need the same wording, and the wording is the part that can
 * mislead, so it lives here where it is tested: amounts are always USDC with a unit,
 * anything that is not mainnet is headed as test funds before a single figure, and the
 * caveats are never left off.
 */

import { isTestNetwork, type Provenance } from "./traction-chain";
import { usdc, type Activity, type TractionReport } from "./traction";

/** The heading shown before any figure when the numbers come from a test network. */
export const TEST_NETWORK_HEADING = "TEST NETWORK — NOT TRACTION";

export const TEST_NETWORK_EXPLANATION =
  "These figures come from a test network. The funds are test funds, no real money moved, and none of this is evidence of demand.";

// `usdc` is defined in lib/traction.ts, where the caveats also need it.
export { usdc };

const pct = (rate: number | null) => (rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`);
const orNone = (v: bigint | null) => (v === null ? "n/a" : usdc(v));

/** How to check the figures without trusting us. */
export function verifyInstructions(p: Provenance): string[] {
  return [
    `Every figure is computed from the Task accounts owned by program ${p.programId}, read with getProgramAccounts on ${p.cluster} at slot ${p.slot}.`,
    "Tasks are never closed, so the chain is a complete record: nothing is missing, and nothing can be added from a database.",
    "To reproduce it, run web/scripts/traction-report.ts against any RPC endpoint for the same cluster, or derive the same counts from any indexer.",
  ];
}

function activityLines(a: Activity, indent = "  "): string[] {
  return [
    `${indent}tasks        ${a.tasks}  (open ${a.open}, submitted ${a.submitted}, settled ${a.settled}, rejected ${a.refundedRejected}, reclaimed ${a.refundedReclaimed})`,
    `${indent}posted       ${usdc(a.postedVolume)}`,
    `${indent}settled      ${usdc(a.settledVolume)}  (workers received ${usdc(a.settledNet)}, fees ${usdc(a.settledFees)})`,
    `${indent}refunded     ${usdc(a.refundedVolume)}`,
  ];
}

/** The report as plain text, for the script. */
export function formatTractionText(report: TractionReport, p: Provenance): string {
  const ind = report.independent;
  const lines: string[] = [];

  if (isTestNetwork(p)) {
    lines.push(TEST_NETWORK_HEADING, TEST_NETWORK_EXPLANATION, "");
  }

  lines.push(
    "RUBRIC TRACTION REPORT  (read from the chain; nothing was signed or sent)",
    "",
    `  cluster     ${p.cluster}   (genesis ${p.genesisHash.slice(0, 8)}...)`,
    `  program     ${p.programId}`,
    `  read at     slot ${p.slot}, ${p.fetchedAt}`,
    `  accounts    ${report.recordsRead} Task accounts read`,
    "",
    "HEADLINE  (poster and worker are different wallets)",
    `  posters         ${ind.posters}   (${ind.repeatPosters} posted more than once, ${ind.repeatSettledPosters} had more than one settled)`,
    `  workers         ${ind.workers}`,
    `  poster-worker pairs  ${ind.pairs}`,
    ...activityLines(ind),
    // The sample size goes with the rate: 100% of one task is not a finding.
    `  approval rate   ${pct(ind.approvalRate)} of ${ind.settled + ind.refundedRejected} decided   (settled / (settled + rejected); reclaims do not count)`,
    `  median bounty   ${orNone(ind.medianBounty)}   (median settled ${orNone(ind.medianSettledBounty)})`,
    "",
    "SET ASIDE, shown so nothing is hidden  (poster and worker are the SAME wallet)",
    ...activityLines(report.selfDealt),
    ""
  );

  if (report.weekly.length > 0) {
    lines.push("SETTLED PER WEEK  (headline only; week starts Monday, UTC)");
    for (const w of report.weekly) lines.push(`  ${w.weekStart}   ${w.settled} settled   ${usdc(w.volume)}`);
    lines.push("");
  }

  lines.push("READ THIS BEFORE QUOTING ANY OF IT");
  for (const c of report.caveats) lines.push(`  - ${c}`);
  lines.push("", "HOW TO CHECK IT YOURSELF");
  for (const v of verifyInstructions(p)) lines.push(`  - ${v}`);
  lines.push("");
  return lines.join("\n");
}

/** JSON-safe: bigints become decimal strings, so nothing is rounded through a double. */
export function tractionToJson(report: TractionReport, p: Provenance): string {
  return JSON.stringify(
    { provenance: p, testNetwork: isTestNetwork(p), report },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );
}
