/**
 * What the /stats page says, as plain data.
 *
 * The page is a dumb renderer of this, on purpose. The wording is the part that can mislead
 * (a test network's numbers read as traction, a copy read as a fresh reading, a link to the
 * wrong cluster), so it lives here where it is tested, and the page cannot add a claim of its
 * own. The same figures are printed by scripts/traction-report.ts through traction-format.ts;
 * a test checks that every amount in one appears in the other.
 */

import type { Cluster } from "./init-plan";
import { isTestNetwork, type Provenance } from "./traction-chain";
import {
  TEST_NETWORK_EXPLANATION,
  TEST_NETWORK_HEADING,
  orNone,
  pct,
  usdc,
  type CacheMeta,
} from "./traction-format";
import type { Activity, IndependentActivity, TractionReport } from "./traction";

export interface ViewRow {
  label: string;
  value: string;
  /** Qualifies the value. Prose, not a figure. */
  note?: string;
}

export interface WeekRow {
  week: string;
  settled: string;
  volume: string;
}

export interface TractionView {
  /** Shown before any figure, whenever the cluster is not mainnet. Null only on mainnet. */
  notice: { heading: string; explanation: string } | null;
  /** Set when the chain could not be read just now and this is an earlier reading. */
  stale: { ageSeconds: number } | null;
  headline: ViewRow[];
  setAside: ViewRow[];
  weekly: WeekRow[];
  caveats: string[];
  provenance: ViewRow[];
  verify: string[];
  /** The command that reproduces these figures. */
  command: string;
  /** A link to the program on Explorer for the cluster it was READ from, or null. */
  explorerUrl: string | null;
}

/**
 * How to check the figures, in prose. The script's version (traction-format.ts) names the
 * program and the slot inline; here those sit in the page's provenance rail in the figure
 * face, so a sentence in the prose face carries no identifier or number.
 */
export const PAGE_VERIFY = [
  "Every figure is computed from the Task accounts the program owns, read with getProgramAccounts on the cluster named beside them.",
  "Tasks are never closed, so the chain is a complete record: nothing is missing, and nothing can be added from a database.",
  "To reproduce it, run the command below against any RPC endpoint for the same cluster, or derive the same counts from any indexer.",
] as const;

export interface TextSegment {
  text: string;
  /** A number, an amount, a percentage or an address: set in the figure face, not the prose face. */
  figure: boolean;
}

// A base58 address (32-44 characters) first, so its digits are not split off one by one; then
// a number with an optional unit.
const FIGURE = /[1-9A-HJ-NP-Za-km-z]{32,44}|\d[\d.,]*(?:\s?(?:USDC|%))?/g;

/**
 * Split a sentence into prose and figures. DESIGN.md puts every verifiable figure in the mono
 * face and every sentence in the prose face; a caveat is both, so the page sets each piece in
 * its own face. Lossless: joining the segments gives back the input.
 */
export function splitFigures(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(FIGURE)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), figure: false });
    // A trailing full stop or comma belongs to the sentence, not to the number before it.
    const raw = match[0];
    const trimmed = raw.replace(/[.,]+$/, "");
    segments.push({ text: trimmed, figure: true });
    last = start + trimmed.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), figure: false });
  return segments;
}

/**
 * Explorer link for an address on the cluster the figures were read from. That is the
 * cluster found by genesis hash, not the one the app is configured for: the page must not
 * link to the wrong cluster because an environment variable disagrees with the RPC.
 * An unrecognised cluster gets no link, rather than a link to the wrong place.
 */
export function explorerAddressUrlFor(cluster: Cluster, address: string): string | null {
  const base = `https://explorer.solana.com/address/${address}`;
  if (cluster === "mainnet") return base;
  if (cluster === "devnet" || cluster === "testnet") return `${base}?cluster=${cluster}`;
  return null;
}

function activityRows(a: Activity): ViewRow[] {
  return [
    {
      label: "Tasks",
      value: String(a.tasks),
      note: `open ${a.open}, submitted ${a.submitted}, settled ${a.settled}, rejected ${a.refundedRejected}, reclaimed ${a.refundedReclaimed}`,
    },
    { label: "Posted", value: usdc(a.postedVolume) },
    {
      label: "Settled",
      value: usdc(a.settledVolume),
      note: `workers received ${usdc(a.settledNet)}, fees ${usdc(a.settledFees)}`,
    },
    { label: "Refunded", value: usdc(a.refundedVolume) },
  ];
}

function headlineRows(ind: IndependentActivity): ViewRow[] {
  const [tasks, ...money] = activityRows(ind);
  return [
    tasks,
    {
      label: "Posters",
      value: String(ind.posters),
      note: `${ind.repeatPosters} posted more than once, ${ind.repeatSettledPosters} had more than one settled`,
    },
    { label: "Workers", value: String(ind.workers) },
    { label: "Poster-worker pairs", value: String(ind.pairs) },
    ...money,
    {
      label: "Approval rate",
      value: `${pct(ind.approvalRate)} of ${ind.settled + ind.refundedRejected} decided`,
      note: "settled / (settled + rejected); reclaims do not count",
    },
    {
      label: "Median bounty",
      value: orNone(ind.medianBounty),
      note: `median settled ${orNone(ind.medianSettledBounty)}`,
    },
  ];
}

export function buildTractionView(report: TractionReport, p: Provenance, cache?: CacheMeta): TractionView {
  const knownCluster = p.cluster !== "unknown";
  return {
    notice: isTestNetwork(p)
      ? { heading: TEST_NETWORK_HEADING, explanation: TEST_NETWORK_EXPLANATION }
      : null,
    stale: cache?.stale ? { ageSeconds: cache.ageSeconds } : null,
    headline: headlineRows(report.independent),
    setAside: activityRows(report.selfDealt),
    weekly: report.weekly.map((w) => ({ week: w.weekStart, settled: String(w.settled), volume: usdc(w.volume) })),
    caveats: report.caveats,
    provenance: [
      {
        label: "Cluster",
        value: p.cluster,
        note: `found by genesis hash ${p.genesisHash.slice(0, 8)}..., not by URL`,
      },
      { label: "Program", value: p.programId },
      { label: "Read at slot", value: String(p.slot), note: p.fetchedAt },
      { label: "Task accounts read", value: String(report.recordsRead) },
    ],
    verify: [...PAGE_VERIFY],
    command: `npx tsx scripts/traction-report.ts --rpc <an RPC endpoint for ${knownCluster ? p.cluster : "the same cluster"}>`,
    explorerUrl: explorerAddressUrlFor(p.cluster, p.programId),
  };
}
