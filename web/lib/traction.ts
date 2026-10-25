/**
 * Traction metrics, derived from the CHAIN and nothing else.
 *
 * WHY THE CHAIN
 * -------------
 * A `Task` account stores its creator, worker, mint, bounty, state and (once ruled) the
 * verdict with its on-chain timestamp, and tasks are never closed. So everything below
 * can be recomputed by anyone, from the program's accounts alone, with no database. That
 * matters for a number shown to a reviewer: a figure from our own Postgres is a claim,
 * and Postgres can hold seeded or edited rows. A figure from the chain is checkable, and
 * it cannot include sample data, because sample data only ever existed in Postgres.
 *
 * WHAT IS NOT HERE: how long a verdict took. The chain stores when a verdict landed but
 * not when the work was submitted, so latency cannot be derived from it. The docket
 * computes that from the database; this module does not pretend to.
 *
 * WHAT THESE NUMBERS ARE NOT
 * --------------------------
 * They measure ACTIVITY. They are not evidence of demand, and the module is built around
 * why:
 *
 *  - Nothing in the program requires the worker to differ from the poster. One wallet can
 *    fund a task, submit work as itself, and have the judge approve it.
 *  - The protocol fee is 2%, paid to a wallet the operator controls. So self-dealt volume
 *    costs only network fees: the fee goes back to the operator.
 *  - A second wallet defeats any rule that the two differ.
 *
 * So "settled volume" is cheap to inflate and means little on its own. Two things follow:
 * tasks where poster and worker are the SAME wallet are split out and never counted in
 * the headline (they are shown beside it, not hidden), and the report always prints the
 * standing caveats below. Distinct wallets are not distinct people, and no rule here can
 * make them so.
 *
 * Pure: no network, no clock, no environment. The chain reader is lib/traction-chain.ts.
 */

export type TaskStateName = "open" | "submitted" | "settled" | "refunded" | "unknown";

/** One Task account, reduced to what these metrics read. */
export interface TaskRecord {
  creator: string;
  worker: string | null;
  mint: string;
  /** In the mint's base units (USDC: 6 decimals). */
  bountyAmount: bigint;
  state: TaskStateName;
  /** The stored verdict's `approved`, or null if the task has no verdict. */
  approved: boolean | null;
  /** Unix seconds of the on-chain ruling, or null if the task has no verdict. */
  decidedAt: number | null;
}

/** What Anchor decodes a Task account into. Structural, so this module imports no SDK. */
export interface RawTaskAccount {
  creator: { toBase58(): string };
  worker: { toBase58(): string } | null | undefined;
  mint: { toBase58(): string };
  bountyAmount: { toString(): string };
  state: Record<string, unknown>;
  verdict: { approved: boolean; decidedAt: { toString(): string } } | null | undefined;
}

export function taskStateName(state: Record<string, unknown>): TaskStateName {
  const key = Object.keys(state ?? {})[0];
  return key === "open" || key === "submitted" || key === "settled" || key === "refunded"
    ? key
    : "unknown";
}

export function taskRecordFromAccount(raw: RawTaskAccount): TaskRecord {
  return {
    creator: raw.creator.toBase58(),
    worker: raw.worker ? raw.worker.toBase58() : null,
    mint: raw.mint.toBase58(),
    bountyAmount: BigInt(raw.bountyAmount.toString()),
    state: taskStateName(raw.state),
    approved: raw.verdict ? raw.verdict.approved : null,
    decidedAt: raw.verdict ? Number(raw.verdict.decidedAt.toString()) : null,
  };
}

/**
 * "12.34 USDC". Always with a unit: a bare number could be mistaken for a count. Exact, not
 * truncated to cents like the app's other formatter: a fee of 0.0098 USDC must not print as
 * 0.00, because a report that rounds away money is wrong in the direction nobody checks.
 */
export function usdc(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000n;
  const frac = (baseUnits % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole.toString()}.${frac} USDC`;
}

const BPS_DENOMINATOR = 10_000n;

/**
 * The protocol fee on a bounty, exactly as the program computes it in `submit_verdict`:
 * `bounty * fee_bps / 10_000`, multiplied first and rounded DOWN. Dividing first would
 * truncate to zero for any small bounty.
 */
export function feeFor(bounty: bigint, feeBps: number): bigint {
  return (bounty * BigInt(feeBps)) / BPS_DENOMINATOR;
}

/** Counts and volumes for one set of tasks. */
export interface Activity {
  tasks: number;
  open: number;
  submitted: number;
  settled: number;
  /** Refunded because the verdict did not approve. */
  refundedRejected: number;
  /** Refunded with no verdict at all: the poster reclaimed an undecided task. */
  refundedReclaimed: number;
  /** Every bounty ever posted in this set, in any state. */
  postedVolume: bigint;
  /** Gross bounty of settled tasks. */
  settledVolume: bigint;
  /** Protocol fees taken on settled tasks. */
  settledFees: bigint;
  /** What workers actually received: settledVolume - settledFees. */
  settledNet: bigint;
  /** Bounty of every refunded task. */
  refundedVolume: bigint;
}

const emptyActivity = (): Activity => ({
  tasks: 0,
  open: 0,
  submitted: 0,
  settled: 0,
  refundedRejected: 0,
  refundedReclaimed: 0,
  postedVolume: 0n,
  settledVolume: 0n,
  settledFees: 0n,
  settledNet: 0n,
  refundedVolume: 0n,
});

function tally(a: Activity, r: TaskRecord, feeBps: number): void {
  a.tasks++;
  a.postedVolume += r.bountyAmount;
  switch (r.state) {
    case "open":
      a.open++;
      break;
    case "submitted":
      a.submitted++;
      break;
    case "settled": {
      const fee = feeFor(r.bountyAmount, feeBps);
      a.settled++;
      a.settledVolume += r.bountyAmount;
      a.settledFees += fee;
      a.settledNet += r.bountyAmount - fee;
      break;
    }
    case "refunded":
      a.refundedVolume += r.bountyAmount;
      // A rejection stores a verdict that did not approve. A reclaim stores none.
      if (r.approved === false) a.refundedRejected++;
      else a.refundedReclaimed++;
      break;
    default:
      break;
  }
}

export interface IndependentActivity extends Activity {
  /** Distinct wallets that posted at least one task here. */
  posters: number;
  /** Distinct wallets recorded as the worker on at least one task here. */
  workers: number;
  /** Posters with two or more tasks here. */
  repeatPosters: number;
  /** Posters with two or more SETTLED tasks here. */
  repeatSettledPosters: number;
  /** Distinct (poster, worker) pairs. */
  pairs: number;
  /** Pairs where each wallet posted a task the other worked: a ring of two. */
  reciprocalPairs: number;
  /** Wallets that both posted and worked here. */
  walletsInBothRoles: number;
  medianBounty: bigint | null;
  medianSettledBounty: bigint | null;
  /** settled / (settled + rejected), or null if nothing was decided. */
  approvalRate: number | null;
}

export interface WeeklyPoint {
  /** The Monday (UTC) the week starts, YYYY-MM-DD. */
  weekStart: string;
  settled: number;
  volume: bigint;
}

export interface TractionReport {
  mint: string;
  feeBps: number;
  /** Task accounts read, of any mint and state. */
  recordsRead: number;
  /** Excluded: a different mint to the deployment's. create_task pins it, so this should be 0. */
  otherMint: number;
  /** Excluded: a state this code does not recognise. */
  unknownState: number;
  /** Poster and worker are different wallets, or no worker yet. THE HEADLINE. */
  independent: IndependentActivity;
  /** Poster and worker are the SAME wallet. Never in the headline; shown beside it. */
  selfDealt: Activity;
  /** A declared team wallet is the poster or the worker. Never in the headline; shown beside it. */
  teamControlled: Activity;
  /** The wallets the operator declared as the team's, sorted. Empty means none were declared. */
  teamWallets: string[];
  /** Independent settled tasks by the week they were decided. */
  weekly: WeeklyPoint[];
  caveats: string[];
}

/**
 * Printed whenever no team wallet was declared. "Independent" is only as good as the list of
 * wallets that are NOT independent, so with no list the headline cannot be called traction.
 */
export const NO_TEAM_WALLETS_CAVEAT =
  "No team-controlled wallets were declared, so tasks the team funded or worked are NOT set aside and are counted in the headline. Do not quote the headline as customer traction until they are declared.";

/** Always printed. Not conditional: they are true of every figure this module makes. */
export const STANDING_CAVEATS = [
  "Wallets are not people. One person can use any number of wallets, so distinct posters and workers are upper bounds on distinct humans.",
  "Volume is activity, not demand. Nothing requires the worker to differ from the poster, and a second wallet defeats any rule that they do; the 2% fee is paid to a wallet the operator controls, so fabricating volume costs only network fees.",
  "Same-wallet tasks are excluded from the headline and shown separately. That removes the laziest wash trading and nothing more.",
  "The chain records when a verdict landed, not when the work was submitted, so these figures say nothing about how fast a verdict is.",
  "On any cluster other than mainnet the funds are test funds, and none of this is traction.",
] as const;

const byBigint = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/** The middle value; the lower-rounded mean of the two middle values when there is an even number. */
export function medianBigint(values: readonly bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort(byBigint);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2n;
}

/** The Monday (UTC) of the week containing this Unix time, as YYYY-MM-DD. */
export function weekStartUtc(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

export interface TractionConfig {
  mint: string;
  feeBps: number;
  /**
   * Wallets the team controls, declared by the operator. A task with one of them as poster or
   * worker is not customer demand, however it looks on-chain, so it is set aside. The report
   * can only know the wallets it is told about: an undeclared team wallet counts as
   * independent, and the caveats say so.
   */
  teamWallets?: readonly string[];
}

export function buildTractionReport(
  records: readonly TaskRecord[],
  config: TractionConfig
): TractionReport {
  const team = new Set(config.teamWallets ?? []);
  const independent = emptyActivity();
  const selfDealt = emptyActivity();
  const teamControlled = emptyActivity();
  let otherMint = 0;
  let unknownState = 0;

  const postedBy = new Map<string, number>();
  const settledBy = new Map<string, number>();
  const workers = new Set<string>();
  const pairs = new Set<string>();
  const bounties: bigint[] = [];
  const settledBounties: bigint[] = [];
  const weeks = new Map<string, WeeklyPoint>();

  for (const r of records) {
    if (r.mint !== config.mint) {
      otherMint++;
      continue;
    }
    if (r.state === "unknown") {
      unknownState++;
      continue;
    }

    // Checked first, so a team wallet dealing with itself is counted once, as same-wallet.
    if (r.worker !== null && r.worker === r.creator) {
      tally(selfDealt, r, config.feeBps);
      continue;
    }

    // Either side. A team-funded task is not demand, and a task the team worked is not supply
    // from outside, so both are set aside. This understates the headline when a customer posts
    // and the team does the work, which is the safe direction to be wrong in.
    if (team.has(r.creator) || (r.worker !== null && team.has(r.worker))) {
      tally(teamControlled, r, config.feeBps);
      continue;
    }

    tally(independent, r, config.feeBps);
    bounties.push(r.bountyAmount);
    postedBy.set(r.creator, (postedBy.get(r.creator) ?? 0) + 1);
    if (r.worker !== null) {
      workers.add(r.worker);
      pairs.add(`${r.creator}>${r.worker}`);
    }
    if (r.state === "settled") {
      settledBy.set(r.creator, (settledBy.get(r.creator) ?? 0) + 1);
      settledBounties.push(r.bountyAmount);
      if (r.decidedAt !== null) {
        const weekStart = weekStartUtc(r.decidedAt);
        const point = weeks.get(weekStart) ?? { weekStart, settled: 0, volume: 0n };
        point.settled++;
        point.volume += r.bountyAmount;
        weeks.set(weekStart, point);
      }
    }
  }

  let reciprocalPairs = 0;
  for (const pair of pairs) {
    const [a, b] = pair.split(">");
    // Count each ring once, from the lexically smaller side.
    if (a < b && pairs.has(`${b}>${a}`)) reciprocalPairs++;
  }

  const posters = new Set(postedBy.keys());
  let walletsInBothRoles = 0;
  for (const w of workers) if (posters.has(w)) walletsInBothRoles++;

  const decided = independent.settled + independent.refundedRejected;

  const report: TractionReport = {
    mint: config.mint,
    feeBps: config.feeBps,
    recordsRead: records.length,
    otherMint,
    unknownState,
    independent: {
      ...independent,
      posters: posters.size,
      workers: workers.size,
      repeatPosters: [...postedBy.values()].filter((n) => n >= 2).length,
      repeatSettledPosters: [...settledBy.values()].filter((n) => n >= 2).length,
      pairs: pairs.size,
      reciprocalPairs,
      walletsInBothRoles,
      medianBounty: medianBigint(bounties),
      medianSettledBounty: medianBigint(settledBounties),
      approvalRate: decided === 0 ? null : independent.settled / decided,
    },
    selfDealt,
    teamControlled,
    teamWallets: [...team].sort(),
    weekly: [...weeks.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)),
    caveats: [],
  };
  report.caveats = caveatsFor(report);
  return report;
}

/** The standing caveats, plus a line for anything in THIS data that needs saying. */
export function caveatsFor(report: TractionReport): string[] {
  const lines: string[] = [...STANDING_CAVEATS];
  if (report.selfDealt.tasks > 0) {
    lines.push(
      `${report.selfDealt.tasks} task(s) were posted and worked by the same wallet (${usdc(report.selfDealt.postedVolume)} posted, ${usdc(report.selfDealt.settledVolume)} settled) and are excluded from the headline.`
    );
  }
  if (report.teamWallets.length === 0) {
    lines.push(NO_TEAM_WALLETS_CAVEAT);
  } else {
    lines.push(
      `Only the ${report.teamWallets.length} wallet(s) declared as the team's are set aside. A team wallet that was not declared is counted as independent.`
    );
    if (report.teamControlled.tasks > 0) {
      lines.push(
        `${report.teamControlled.tasks} task(s) had a declared team wallet as poster or worker (${usdc(report.teamControlled.postedVolume)} posted, ${usdc(report.teamControlled.settledVolume)} settled) and are excluded from the headline.`
      );
    }
  }
  if (report.independent.reciprocalPairs > 0) {
    lines.push(
      `${report.independent.reciprocalPairs} pair(s) of wallets each posted a task the other worked. That is how a two-wallet ring looks, and is not proof of one.`
    );
  }
  if (report.otherMint > 0) {
    lines.push(`${report.otherMint} account(s) use a different mint to this deployment's and are excluded. create_task pins the mint, so this should not happen.`);
  }
  if (report.unknownState > 0) {
    lines.push(`${report.unknownState} account(s) are in a state this code does not recognise and are excluded.`);
  }
  return lines;
}
