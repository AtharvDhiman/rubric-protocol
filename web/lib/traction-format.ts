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

export const pct = (rate: number | null) => (rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`);
/** The approval rate with the number of decisions it rests on, or a plain statement that nothing has been decided. */
export const approvalText = (rate: number | null, decided: number) =>
  rate === null ? "n/a (nothing decided yet)" : `${pct(rate)} of ${decided} decided`;
export const orNone = (v: bigint | null) => (v === null ? "n/a" : usdc(v));

/** How to check the figures without trusting us. */
export function verifyInstructions(p: Provenance): string[] {
  return [
    `Every figure is computed from the Task accounts owned by program ${p.programId}, read with getProgramAccounts on ${p.cluster} at slot ${p.slot}.`,
    "Tasks are never closed, so the chain is a complete record: nothing is missing, and nothing can be added from a database.",
    "To reproduce it, run web/scripts/traction-report.ts against any RPC endpoint for the same cluster, or derive the same counts from any indexer.",
  ];
}

/**
 * What the headline's wallets have in common, said where the headline starts. It names the
 * declared team wallets when there are some, and says plainly that there are none when there
 * are not: "independent" is only as good as that list.
 */
export function headlineKicker(report: TractionReport): string {
  return report.teamWallets.length > 0
    ? "poster and worker are different wallets, and neither is a declared team wallet"
    : "poster and worker are different wallets; NO team wallets were declared, so team activity is NOT set aside";
}

function teamLines(report: TractionReport): string[] {
  if (report.teamWallets.length === 0) {
    return ["  none declared. Pass --team-wallets (or TEAM_WALLETS) to set the team's own tasks aside."];
  }
  return [
    ...activityLines(report.teamControlled),
    `  declared      ${report.teamWallets.length} wallet(s):`,
    ...report.teamWallets.map((w) => `                ${w}`),
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
    `HEADLINE  (${headlineKicker(report)})`,
    `  posters         ${ind.posters}   (${ind.repeatPosters} posted more than once, ${ind.repeatSettledPosters} had more than one settled)`,
    `  workers         ${ind.workers}`,
    `  poster-worker pairs  ${ind.pairs}`,
    ...activityLines(ind),
    // The sample size goes with the rate: 100% of one task is not a finding.
    `  approval rate   ${approvalText(ind.approvalRate, ind.settled + ind.refundedRejected)}   (settled / (settled + rejected); reclaims do not count)`,
    `  median bounty   ${orNone(ind.medianBounty)}   (median settled ${orNone(ind.medianSettledBounty)})`,
    "",
    "SET ASIDE, shown so nothing is hidden  (poster and worker are the SAME wallet)",
    ...activityLines(report.selfDealt),
    "",
    "SET ASIDE, TEAM-CONTROLLED  (a declared team wallet posted or worked the task)",
    ...teamLines(report),
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

/** How old a served reading is, and whether it is a copy kept after a failed read. */
export interface CacheMeta {
  stale: boolean;
  ageSeconds: number;
}

/**
 * JSON-safe: bigints become decimal strings, so nothing is rounded through a double.
 * `cache` is present only when the reading came from a server-side cache, so a consumer can
 * tell a copy from a fresh reading without comparing timestamps.
 */
export function tractionToJson(report: TractionReport, p: Provenance, cache?: CacheMeta): string {
  return JSON.stringify(
    { provenance: p, testNetwork: isTestNetwork(p), report, ...(cache ? { cache } : {}) },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );
}
