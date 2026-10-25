import { describe, expect, it } from "vitest";
import {
  NO_TEAM_WALLETS_CAVEAT,
  STANDING_CAVEATS,
  buildTractionReport,
  feeFor,
  medianBigint,
  taskRecordFromAccount,
  taskStateName,
  weekStartUtc,
  type RawTaskAccount,
  type TaskRecord,
  type TractionReport,
} from "./traction";

const MINT = "USDCmint1111111111111111111111111111111111";
const CONFIG = { mint: MINT, feeBps: 200 };
const M = 1_000_000n;

/** Unix seconds for a UTC timestamp. */
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const rec = (over: Partial<TaskRecord>): TaskRecord => ({
  creator: "A",
  worker: null,
  mint: MINT,
  bountyAmount: M,
  state: "open",
  approved: null,
  decidedAt: null,
  ...over,
});

/**
 * Hand-computed. Every expected figure below was worked out on paper from this list, not
 * read back from the implementation.
 */
const FIXTURE: TaskRecord[] = [
  rec({ creator: "A", worker: "B", bountyAmount: 10n * M, state: "settled", approved: true, decidedAt: at("2026-10-07T12:00:00Z") }),
  rec({ creator: "A", worker: "C", bountyAmount: 5n * M, state: "settled", approved: true, decidedAt: at("2026-10-08T12:00:00Z") }),
  rec({ creator: "A", worker: "D", bountyAmount: 3n * M, state: "refunded", approved: false, decidedAt: at("2026-10-14T12:00:00Z") }),
  rec({ creator: "E", worker: null, bountyAmount: 1n * M, state: "open" }),
  rec({ creator: "E", worker: "B", bountyAmount: 2n * M, state: "submitted" }),
  // Same wallet as poster and worker: SELF-DEALT, never in the headline.
  rec({ creator: "B", worker: "B", bountyAmount: 4n * M, state: "settled", approved: true, decidedAt: at("2026-10-15T12:00:00Z") }),
  rec({ creator: "C", worker: "C", bountyAmount: 1n * M, state: "refunded", approved: null }),
  // B posted a task A worked: with A->B above this is a reciprocal pair.
  rec({ creator: "B", worker: "A", bountyAmount: 1n * M, state: "settled", approved: true, decidedAt: at("2026-10-20T12:00:00Z") }),
  rec({ creator: "A", worker: "B", bountyAmount: 2n * M, state: "settled", approved: true, decidedAt: at("2026-10-21T12:00:00Z") }),
  // Excluded outright.
  rec({ creator: "X", worker: "Y", mint: "SomeOtherMint", bountyAmount: 99n * M, state: "settled", approved: true, decidedAt: at("2026-10-21T12:00:00Z") }),
  rec({ creator: "Z", state: "unknown" }),
  // Posted, never worked, then reclaimed by the poster.
  rec({ creator: "F", worker: null, bountyAmount: 500_000n, state: "refunded", approved: null }),
];

describe("the headline, on a hand-computed fixture", () => {
  const r = buildTractionReport(FIXTURE, CONFIG);
  const ind = r.independent;

  it("reads every account and sets aside only what must be set aside", () => {
    expect(r.recordsRead).toBe(12);
    expect(r.otherMint).toBe(1);
    expect(r.unknownState).toBe(1);
  });

  it("counts independent tasks by state", () => {
    expect(ind.tasks).toBe(8);
    expect(ind.open).toBe(1);
    expect(ind.submitted).toBe(1);
    expect(ind.settled).toBe(4);
    expect(ind.refundedRejected).toBe(1);
    expect(ind.refundedReclaimed).toBe(1);
  });

  it("counts distinct wallets", () => {
    expect(ind.posters).toBe(4); // A, E, B, F
    expect(ind.workers).toBe(4); // B, C, D, A
    expect(ind.pairs).toBe(5); // A>B, A>C, A>D, E>B, B>A
    expect(ind.walletsInBothRoles).toBe(2); // A and B
  });

  it("finds repeat posters, and repeat settled posters", () => {
    expect(ind.repeatPosters).toBe(2); // A (4 tasks) and E (2)
    expect(ind.repeatSettledPosters).toBe(1); // A (3 settled); B has only 1
  });

  it("finds the two-wallet ring exactly once", () => {
    expect(ind.reciprocalPairs).toBe(1); // A>B and B>A
  });

  it("sums volume, with the fee computed per task the way the program does", () => {
    expect(ind.postedVolume).toBe(24_500_000n);
    expect(ind.settledVolume).toBe(18_000_000n); // 10 + 5 + 1 + 2
    expect(ind.settledFees).toBe(360_000n); // 200_000 + 100_000 + 20_000 + 40_000
    expect(ind.settledNet).toBe(17_640_000n);
    expect(ind.refundedVolume).toBe(3_500_000n);
  });

  it("takes medians", () => {
    expect(ind.medianBounty).toBe(2_000_000n); // [0.5,1,1,2,2,3,5,10] -> (2+2)/2
    expect(ind.medianSettledBounty).toBe(3_500_000n); // [1,2,5,10] -> (2+5)/2
  });

  it("the approval rate is settled over settled plus rejected, and reclaims do not count against it", () => {
    expect(ind.approvalRate).toBeCloseTo(0.8); // 4 / (4 + 1)
  });

  it("buckets settled tasks by the Monday of the week they were decided", () => {
    expect(r.weekly).toEqual([
      { weekStart: "2026-10-05", settled: 2, volume: 15_000_000n },
      { weekStart: "2026-10-19", settled: 2, volume: 3_000_000n },
    ]);
  });
});

describe("same-wallet tasks are split out, never hidden and never in the headline", () => {
  const r = buildTractionReport(FIXTURE, CONFIG);

  it("are reported beside the headline", () => {
    expect(r.selfDealt.tasks).toBe(2);
    expect(r.selfDealt.postedVolume).toBe(5_000_000n);
    expect(r.selfDealt.settled).toBe(1);
    expect(r.selfDealt.settledVolume).toBe(4_000_000n);
    expect(r.selfDealt.settledFees).toBe(80_000n);
    expect(r.selfDealt.settledNet).toBe(3_920_000n);
    expect(r.selfDealt.refundedReclaimed).toBe(1);
  });

  it("do not appear in any headline figure, including the weekly series", () => {
    // B>B settled 4 USDC on 2026-10-15 would have made week 2026-10-12 appear.
    expect(r.weekly.map((w) => w.weekStart)).not.toContain("2026-10-12");
    expect(r.independent.settledVolume).toBe(18_000_000n);
  });

  it("a wallet that worked its own task does not become a 'worker' or a 'pair'", () => {
    const only = buildTractionReport([rec({ creator: "B", worker: "B", state: "settled", approved: true, decidedAt: at("2026-10-07T00:00:00Z") })], CONFIG);
    expect(only.independent.tasks).toBe(0);
    expect(only.independent.workers).toBe(0);
    expect(only.independent.pairs).toBe(0);
    expect(only.independent.posters).toBe(0);
    expect(only.selfDealt.tasks).toBe(1);
  });

  it("a task with no worker yet is independent: it cannot be self-dealt", () => {
    const r2 = buildTractionReport([rec({ creator: "A", worker: null })], CONFIG);
    expect(r2.independent.tasks).toBe(1);
    expect(r2.selfDealt.tasks).toBe(0);
  });
});

describe("an empty or tiny deployment", () => {
  it("reports zeros and nulls, not NaN", () => {
    const r = buildTractionReport([], CONFIG);
    expect(r.independent.tasks).toBe(0);
    expect(r.independent.approvalRate).toBeNull();
    expect(r.independent.medianBounty).toBeNull();
    expect(r.independent.medianSettledBounty).toBeNull();
    expect(r.weekly).toEqual([]);
    expect(r.independent.posters).toBe(0);
  });

  it("a rejection with nothing settled has an approval rate of 0, not null", () => {
    const r = buildTractionReport([rec({ worker: "B", state: "refunded", approved: false, decidedAt: at("2026-10-07T00:00:00Z") })], CONFIG);
    expect(r.independent.approvalRate).toBe(0);
  });

  it("only reclaims and open tasks: the approval rate is null, since nothing was ruled on", () => {
    const r = buildTractionReport([rec({ state: "refunded", approved: null }), rec({ state: "open" })], CONFIG);
    expect(r.independent.approvalRate).toBeNull();
  });
});

describe("refunds: a rejection and a reclaim are different things", () => {
  it("a refund with a not-approved verdict is a rejection", () => {
    const r = buildTractionReport([rec({ worker: "B", state: "refunded", approved: false })], CONFIG);
    expect(r.independent.refundedRejected).toBe(1);
    expect(r.independent.refundedReclaimed).toBe(0);
  });

  it("a refund with no verdict is a reclaim, and is not counted as a ruling against the work", () => {
    const r = buildTractionReport([rec({ worker: "B", state: "refunded", approved: null })], CONFIG);
    expect(r.independent.refundedReclaimed).toBe(1);
    expect(r.independent.refundedRejected).toBe(0);
    expect(r.independent.approvalRate).toBeNull();
  });
});

describe("feeFor matches the program", () => {
  it("is bounty * fee_bps / 10_000, rounded down", () => {
    expect(feeFor(5_000_000n, 200)).toBe(100_000n);
    expect(feeFor(10_000_000n, 200)).toBe(200_000n);
    expect(feeFor(1_000_000n, 200)).toBe(20_000n);
  });

  it("multiplies BEFORE dividing: a small bounty must not truncate to zero by dividing first", () => {
    // bounty/10_000*200 would be 0 for anything under 10_000 base units; the program
    // multiplies first, so 49 base units at 200 bps is floor(9800/10000) = 0, but
    // 9_999 is floor(1_999_800/10_000) = 199.
    expect(feeFor(9_999n, 200)).toBe(199n);
    expect(feeFor(49n, 200)).toBe(0n);
  });

  it("is zero at zero bps", () => {
    expect(feeFor(5_000_000n, 0)).toBe(0n);
  });

  it("settledNet plus settledFees is always the gross volume", () => {
    const r = buildTractionReport(FIXTURE, CONFIG);
    expect(r.independent.settledNet + r.independent.settledFees).toBe(r.independent.settledVolume);
    expect(r.selfDealt.settledNet + r.selfDealt.settledFees).toBe(r.selfDealt.settledVolume);
  });
});

describe("medianBigint", () => {
  it("is null for nothing, the middle for odd, the floored mean of the middle two for even", () => {
    expect(medianBigint([])).toBeNull();
    expect(medianBigint([5n])).toBe(5n);
    expect(medianBigint([3n, 1n, 2n])).toBe(2n);
    expect(medianBigint([1n, 2n, 3n, 4n])).toBe(2n); // (2+3)/2 floored
    expect(medianBigint([1n, 4n])).toBe(2n);
  });

  it("does not mutate its input", () => {
    const input = [3n, 1n, 2n];
    medianBigint(input);
    expect(input).toEqual([3n, 1n, 2n]);
  });

  it("handles values beyond Number's safe range", () => {
    const big = 2n ** 70n;
    expect(medianBigint([big, big + 2n])).toBe(big + 1n);
  });
});

describe("weekStartUtc", () => {
  it("is the Monday of the week, in UTC", () => {
    expect(weekStartUtc(at("2026-10-07T12:00:00Z"))).toBe("2026-10-05"); // Wednesday
    expect(weekStartUtc(at("2026-10-05T00:00:00Z"))).toBe("2026-10-05"); // Monday 00:00 exactly
    expect(weekStartUtc(at("2026-10-11T23:59:59Z"))).toBe("2026-10-05"); // Sunday, last second
    expect(weekStartUtc(at("2026-10-12T00:00:00Z"))).toBe("2026-10-12"); // next Monday
  });

  it("crosses a month and a year boundary correctly", () => {
    expect(weekStartUtc(at("2026-01-01T12:00:00Z"))).toBe("2025-12-29"); // Thursday
    expect(weekStartUtc(at("2026-03-01T12:00:00Z"))).toBe("2026-02-23"); // Sunday
  });
});

describe("reading an Anchor-decoded account", () => {
  const key = (s: string) => ({ toBase58: () => s });
  const raw = (over: Partial<RawTaskAccount> = {}): RawTaskAccount => ({
    creator: key("A"),
    worker: key("B"),
    mint: key(MINT),
    bountyAmount: { toString: () => "5000000" },
    state: { settled: {} },
    verdict: { approved: true, decidedAt: { toString: () => "1790000000" } },
    ...over,
  });

  it("maps every field", () => {
    expect(taskRecordFromAccount(raw())).toEqual({
      creator: "A",
      worker: "B",
      mint: MINT,
      bountyAmount: 5_000_000n,
      state: "settled",
      approved: true,
      decidedAt: 1_790_000_000,
    });
  });

  it("a task with no worker or verdict decodes to nulls", () => {
    const r = taskRecordFromAccount(raw({ worker: null, verdict: null, state: { open: {} } }));
    expect(r.worker).toBeNull();
    expect(r.approved).toBeNull();
    expect(r.decidedAt).toBeNull();
    expect(taskRecordFromAccount(raw({ worker: undefined, verdict: undefined })).worker).toBeNull();
  });

  it("a state it does not know is 'unknown', never silently counted", () => {
    expect(taskStateName({ frozen: {} })).toBe("unknown");
    expect(taskStateName({})).toBe("unknown");
    for (const s of ["open", "submitted", "settled", "refunded"] as const) {
      expect(taskStateName({ [s]: {} })).toBe(s);
    }
  });

  it("keeps a bounty larger than a double can represent exactly", () => {
    const r = taskRecordFromAccount(raw({ bountyAmount: { toString: () => "18446744073709551615" } }));
    expect(r.bountyAmount).toBe(18_446_744_073_709_551_615n);
  });
});

describe("the caveats", () => {
  it("always include every standing caveat, even for an empty report", () => {
    const r = buildTractionReport([], CONFIG);
    for (const c of STANDING_CAVEATS) expect(r.caveats).toContain(c);
  });

  it("say that wallets are not people, and that volume is not demand", () => {
    const text = STANDING_CAVEATS.join(" ");
    expect(text).toMatch(/Wallets are not people/);
    expect(text).toMatch(/Volume is activity, not demand/);
    expect(text).toMatch(/costs only network fees/);
  });

  it("add a line about same-wallet tasks only when there are some, with the numbers", () => {
    const none = buildTractionReport([rec({ worker: "B" })], CONFIG);
    expect(none.caveats.join(" ")).not.toMatch(/same wallet/);
    const some = buildTractionReport(FIXTURE, CONFIG);
    expect(some.caveats.join(" ")).toMatch(/2 task\(s\) were posted and worked by the same wallet/);
  });

  it("state the set-aside amounts in USDC, never as raw base units", () => {
    const line = buildTractionReport(FIXTURE, CONFIG).caveats.find((c) => /posted and worked by the same wallet/.test(c));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/base units/);
    expect(line).toMatch(/\d+\.\d\d USDC posted, \d+\.\d\d USDC settled/);
  });

  it("flag a reciprocal pair, without calling it proof of a ring", () => {
    const line = buildTractionReport(FIXTURE, CONFIG).caveats.find((c) => /each posted a task the other worked/.test(c));
    expect(line).toBeDefined();
    expect(line).toMatch(/not proof/);
  });

  it("flag excluded accounts", () => {
    const c = buildTractionReport(FIXTURE, CONFIG).caveats.join(" ");
    expect(c).toMatch(/different mint/);
    expect(c).toMatch(/state this code does not recognise/);
  });

  it("claim no latency: the chain cannot say how long a verdict took", () => {
    expect(STANDING_CAVEATS.join(" ")).toMatch(/how fast a verdict is/);
  });
});

describe("team wallets: tasks the team funded or worked are set aside, never in the headline", () => {
  const withTeam = (teamWallets: string[], records: TaskRecord[] = FIXTURE) =>
    buildTractionReport(records, { ...CONFIG, teamWallets });

  it("a declared wallet as POSTER sets its tasks aside, hand-computed on the fixture", () => {
    // E posted an open task and a submitted one (3 USDC between them), and nothing else.
    const r = withTeam(["E"]);
    expect(r.teamControlled.tasks).toBe(2);
    expect(r.teamControlled.open).toBe(1);
    expect(r.teamControlled.submitted).toBe(1);
    expect(r.teamControlled.postedVolume).toBe(3_000_000n);
    expect(r.teamControlled.settled).toBe(0);
    // The headline loses exactly those two: 8 tasks become 6, posted 24.5 becomes 21.5.
    expect(r.independent.tasks).toBe(6);
    expect(r.independent.postedVolume).toBe(21_500_000n);
    expect(r.independent.open).toBe(0);
    expect(r.independent.submitted).toBe(0);
    expect(r.independent.posters).toBe(3);
    expect(r.independent.pairs).toBe(4);
    expect(r.independent.reciprocalPairs).toBe(1);
    // The settled picture, and so the approval rate, is untouched: none of E's tasks had settled.
    expect(r.independent.settledVolume).toBe(18_000_000n);
    expect(r.independent.approvalRate).toBe(0.8);
    // Six bounties, 0.5 1 2 3 5 10: the median is the mean of the middle two.
    expect(r.independent.medianBounty).toBe(2_500_000n);
  });

  it("a declared wallet as WORKER also sets the task aside, even when a customer posted it", () => {
    const r = withTeam(["T"], [rec({ creator: "CUSTOMER", worker: "T", state: "settled", approved: true, bountyAmount: 5n * M, decidedAt: at("2026-10-07T00:00:00Z") })]);
    expect(r.teamControlled.tasks).toBe(1);
    expect(r.teamControlled.settledVolume).toBe(5_000_000n);
    expect(r.independent.tasks).toBe(0);
    expect(r.independent.posters).toBe(0);
    expect(r.weekly).toEqual([]);
  });

  it("a wallet that is not on either side changes nothing but the declared list", () => {
    const base = buildTractionReport(FIXTURE, CONFIG);
    const r = withTeam(["SomebodyElse"]);
    const j = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(j(r.independent)).toBe(j(base.independent));
    expect(j(r.selfDealt)).toBe(j(base.selfDealt));
    expect(r.teamControlled.tasks).toBe(0);
  });

  it("a team wallet dealing with itself is counted once, as same-wallet", () => {
    const r = withTeam(["T"], [rec({ creator: "T", worker: "T", state: "settled", approved: true, decidedAt: at("2026-10-07T00:00:00Z") })]);
    expect(r.selfDealt.tasks).toBe(1);
    expect(r.teamControlled.tasks).toBe(0);
    expect(r.independent.tasks).toBe(0);
  });

  it("keeps team settlements out of the weekly series", () => {
    const r = withTeam(["T"], [
      rec({ creator: "T", worker: "B", state: "settled", approved: true, decidedAt: at("2026-10-07T00:00:00Z") }),
      rec({ creator: "A", worker: "B", state: "settled", approved: true, bountyAmount: 2n * M, decidedAt: at("2026-10-21T00:00:00Z") }),
    ]);
    expect(r.weekly).toEqual([{ weekStart: "2026-10-19", settled: 1, volume: 2_000_000n }]);
  });

  it("echoes the declared wallets, sorted and without duplicates", () => {
    expect(withTeam(["E", "B", "E"]).teamWallets).toEqual(["B", "E"]);
    expect(buildTractionReport(FIXTURE, CONFIG).teamWallets).toEqual([]);
  });

  it("with none declared, says the headline cannot be called customer traction", () => {
    const caveats = buildTractionReport(FIXTURE, CONFIG).caveats;
    expect(caveats).toContain(NO_TEAM_WALLETS_CAVEAT);
    expect(NO_TEAM_WALLETS_CAVEAT).toMatch(/NOT set aside/);
    expect(NO_TEAM_WALLETS_CAVEAT).toMatch(/Do not quote the headline as customer traction/);
    expect(buildTractionReport([], CONFIG).caveats).toContain(NO_TEAM_WALLETS_CAVEAT);
  });

  it("with some declared, drops that caveat and says an undeclared wallet still counts as independent", () => {
    const caveats = withTeam(["E"]).caveats;
    expect(caveats).not.toContain(NO_TEAM_WALLETS_CAVEAT);
    expect(caveats.join(" ")).toMatch(/Only the 1 wallet\(s\) declared as the team's are set aside/);
    expect(caveats.join(" ")).toMatch(/A team wallet that was not declared is counted as independent/);
  });

  it("states what was set aside, in USDC, only when something was", () => {
    const line = withTeam(["E"]).caveats.find((c) => /declared team wallet as poster or worker/.test(c));
    expect(line).toBe(
      "2 task(s) had a declared team wallet as poster or worker (3.00 USDC posted, 0.00 USDC settled) and are excluded from the headline."
    );
    expect(withTeam(["SomebodyElse"]).caveats.some((c) => /declared team wallet as poster or worker/.test(c))).toBe(false);
  });
});

// --- Properties that must hold for ANY data -------------------------------------------

/** A seeded generator so a failure is reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function randomRecords(next: () => number, n: number): TaskRecord[] {
  const wallets = ["A", "B", "C", "D", "E", "F"];
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
  return Array.from({ length: n }, () => {
    const state = pick(["open", "submitted", "settled", "refunded", "unknown"] as const);
    const creator = pick(wallets);
    const hasWorker = state !== "open" && next() < 0.9;
    const worker = hasWorker ? (next() < 0.2 ? creator : pick(wallets)) : null;
    const verdict = state === "settled" || (state === "refunded" && next() < 0.6);
    return {
      creator,
      worker,
      mint: next() < 0.05 ? "OtherMint" : MINT,
      bountyAmount: BigInt(Math.floor(next() * 50_000_000)) + 1n,
      state,
      approved: verdict ? state === "settled" : null,
      decidedAt: verdict ? 1_780_000_000 + Math.floor(next() * 90 * 86_400) : null,
    };
  });
}

const activityLike = (a: TractionReport["selfDealt"]) =>
  a.open + a.submitted + a.settled + a.refundedRejected + a.refundedReclaimed;

describe("invariants over random data", () => {
  const cases = Array.from({ length: 300 }, (_, i) => i);

  it("every account is accounted for exactly once", () => {
    for (const i of cases) {
      const records = randomRecords(rng(i + 1), 1 + (i % 40));
      const teamWallets = i % 3 === 0 ? ["A", "D"] : i % 3 === 1 ? ["F"] : [];
      const r = buildTractionReport(records, { ...CONFIG, teamWallets });
      expect(
        r.independent.tasks + r.selfDealt.tasks + r.teamControlled.tasks + r.otherMint + r.unknownState,
        `case ${i}`
      ).toBe(r.recordsRead);
    }
  });

  it("the states in each set add up to its task count", () => {
    for (const i of cases) {
      const r = buildTractionReport(randomRecords(rng(i + 1000), 1 + (i % 40)), CONFIG);
      expect(activityLike(r.independent), `case ${i}`).toBe(r.independent.tasks);
      expect(activityLike(r.selfDealt), `case ${i}`).toBe(r.selfDealt.tasks);
      expect(activityLike(r.teamControlled), `case ${i}`).toBe(r.teamControlled.tasks);
    }
  });

  it("volumes are consistent: net plus fees is gross, and posted covers settled plus refunded", () => {
    for (const i of cases) {
      const r = buildTractionReport(randomRecords(rng(i + 2000), 1 + (i % 40)), CONFIG);
      for (const a of [r.independent, r.selfDealt, r.teamControlled]) {
        expect(a.settledNet + a.settledFees, `case ${i}`).toBe(a.settledVolume);
        expect(a.postedVolume >= a.settledVolume + a.refundedVolume, `case ${i}`).toBe(true);
        expect(a.settledFees <= a.settledVolume, `case ${i}`).toBe(true);
      }
    }
  });

  it("counts of wallets never exceed what could produce them", () => {
    for (const i of cases) {
      const r = buildTractionReport(randomRecords(rng(i + 3000), 1 + (i % 40)), CONFIG);
      const x = r.independent;
      expect(x.posters, `case ${i}`).toBeLessThanOrEqual(x.tasks);
      expect(x.repeatPosters).toBeLessThanOrEqual(x.posters);
      expect(x.repeatSettledPosters).toBeLessThanOrEqual(x.repeatPosters);
      expect(x.workers).toBeLessThanOrEqual(x.tasks);
      expect(x.pairs).toBeLessThanOrEqual(x.tasks);
      expect(x.reciprocalPairs * 2).toBeLessThanOrEqual(x.pairs);
      expect(x.walletsInBothRoles).toBeLessThanOrEqual(Math.min(x.posters, x.workers));
    }
  });

  it("the weekly series is the settled volume, split by week, and sorted", () => {
    for (const i of cases) {
      const r = buildTractionReport(randomRecords(rng(i + 4000), 1 + (i % 40)), CONFIG);
      expect(r.weekly.reduce((s, w) => s + w.settled, 0), `case ${i}`).toBe(r.independent.settled);
      expect(r.weekly.reduce((s, w) => s + w.volume, 0n), `case ${i}`).toBe(r.independent.settledVolume);
      const starts = r.weekly.map((w) => w.weekStart);
      expect([...starts].sort(), `case ${i}`).toEqual(starts);
      expect(new Set(starts).size).toBe(starts.length);
    }
  });

  it("the approval rate is a proportion, or null", () => {
    for (const i of cases) {
      const rate = buildTractionReport(randomRecords(rng(i + 5000), 1 + (i % 40)), CONFIG).independent.approvalRate;
      if (rate !== null) {
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
      }
    }
  });

  it("the report does not depend on the order the accounts were read in", () => {
    const json = (r: TractionReport) =>
      JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    for (const i of cases.slice(0, 100)) {
      const next = rng(i + 6000);
      const records = randomRecords(next, 2 + (i % 30));
      const shuffled = [...records].sort(() => next() - 0.5);
      expect(json(buildTractionReport(shuffled, CONFIG)), `case ${i}`).toBe(json(buildTractionReport(records, CONFIG)));
    }
  });

  it("adding a task a declared team wallet posted changes NOTHING in the headline", () => {
    const j = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    for (const i of cases.slice(0, 100)) {
      const records = randomRecords(rng(i + 8000), 2 + (i % 30));
      const config = { ...CONFIG, teamWallets: ["TEAM"] };
      const before = buildTractionReport(records, config).independent;
      const teamTask = rec({ creator: "TEAM", worker: "A", bountyAmount: 999n * M, state: "settled", approved: true, decidedAt: 1_785_000_000 });
      const teamWorked = rec({ creator: "A", worker: "TEAM", bountyAmount: 999n * M, state: "settled", approved: true, decidedAt: 1_785_000_000 });
      expect(j(buildTractionReport([...records, teamTask, teamWorked], config).independent), `case ${i}`).toBe(j(before));
    }
  });

  it("adding a same-wallet task changes NOTHING in the headline", () => {
    for (const i of cases.slice(0, 100)) {
      const records = randomRecords(rng(i + 7000), 2 + (i % 30));
      const before = buildTractionReport(records, CONFIG).independent;
      const wash = rec({ creator: "WASH", worker: "WASH", bountyAmount: 999n * M, state: "settled", approved: true, decidedAt: 1_785_000_000 });
      const after = buildTractionReport([...records, wash], CONFIG).independent;
      expect(JSON.stringify(after, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), `case ${i}`).toBe(
        JSON.stringify(before, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
      );
    }
  });
});
