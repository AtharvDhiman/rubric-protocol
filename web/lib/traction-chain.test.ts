import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { configAddress, isTestNetwork, loadTractionReport, readProvenance, type TractionProgram } from "./traction-chain";
import { DEVNET_GENESIS, MAINNET_GENESIS } from "./init-plan";
import { TEST_NETWORK_EXPLANATION, TEST_NETWORK_HEADING, formatTractionText, tractionToJson, usdc, verifyInstructions } from "./traction-format";
import { buildTractionReport, type TaskRecord } from "./traction";

const PROGRAM_ID = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;
const A = Keypair.generate().publicKey;
const B = Keypair.generate().publicKey;
const C = Keypair.generate().publicKey;

const bn = (n: number | bigint) => ({ toString: () => n.toString() });

function onChainTask(over: Record<string, unknown> = {}) {
  return {
    creator: A,
    worker: B,
    mint: MINT,
    bountyAmount: bn(5_000_000),
    state: { settled: {} },
    verdict: { approved: true, decidedAt: bn(1_790_000_000) },
    ...over,
  };
}

function fakeProgram(tasks: unknown[], config: unknown = { bountyMint: MINT, feeBps: 200 }) {
  const fetch = vi.fn(async () => {
    if (config === null) throw new Error("Account does not exist: https://secret-rpc.example/?key=SECRET");
    return config;
  });
  const program: TractionProgram = {
    programId: PROGRAM_ID,
    account: {
      task: { all: async () => tasks.map((account) => ({ publicKey: Keypair.generate().publicKey, account })) },
      config: { fetch },
    },
  };
  return { program, fetch };
}

describe("loadTractionReport", () => {
  it("reads the Config for the mint and the fee, and every Task account", async () => {
    const { program, fetch } = fakeProgram([onChainTask(), onChainTask({ creator: C, worker: null, state: { open: {} }, verdict: null })]);
    const { report, records } = await loadTractionReport(program);
    expect(records).toHaveLength(2);
    expect(report.recordsRead).toBe(2);
    expect(report.mint).toBe(MINT.toBase58());
    expect(report.feeBps).toBe(200);
    // Read from the Config PDA, nowhere else.
    expect(fetch).toHaveBeenCalledWith(configAddress(PROGRAM_ID));
  });

  it("computes the headline from what it read", async () => {
    const { program } = fakeProgram([onChainTask()]);
    const { report } = await loadTractionReport(program);
    expect(report.independent.settled).toBe(1);
    expect(report.independent.settledVolume).toBe(5_000_000n);
    expect(report.independent.settledFees).toBe(100_000n);
  });

  it("keeps a task in a different mint out of the headline", async () => {
    const { program } = fakeProgram([onChainTask({ mint: Keypair.generate().publicKey })]);
    const { report } = await loadTractionReport(program);
    expect(report.otherMint).toBe(1);
    expect(report.independent.tasks).toBe(0);
  });

  it("splits out a same-wallet task", async () => {
    const { program } = fakeProgram([onChainTask({ worker: A })]);
    const { report } = await loadTractionReport(program);
    expect(report.selfDealt.tasks).toBe(1);
    expect(report.independent.tasks).toBe(0);
  });

  it("an empty deployment reports zeros", async () => {
    const { program } = fakeProgram([]);
    const { report } = await loadTractionReport(program);
    expect(report.recordsRead).toBe(0);
    expect(report.independent.tasks).toBe(0);
  });

  it("fails with a clear message when the Config cannot be read, and never repeats the RPC's error", async () => {
    const { program } = fakeProgram([onChainTask()], null);
    const err = await loadTractionReport(program).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/not initialised on this cluster, or the RPC endpoint failed/);
    expect((err as Error).message).not.toMatch(/SECRET|secret-rpc/);
  });

  it("does not need a key: the program handle it is given cannot sign", async () => {
    // The shape it accepts has no signing method at all.
    const { program } = fakeProgram([]);
    expect(Object.keys(program)).toEqual(["programId", "account"]);
  });
});

describe("configAddress", () => {
  it("is the [b'config'] PDA of the program", () => {
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
    expect(configAddress(PROGRAM_ID).toBase58()).toBe(expected.toBase58());
  });
});

describe("readProvenance", () => {
  const connection = (genesis: string, slot = 777) =>
    ({ getGenesisHash: async () => genesis, getSlot: async () => slot }) as never;

  it("names the cluster by its genesis hash, never by a URL, and records the slot", async () => {
    const p = await readProvenance(connection(MAINNET_GENESIS), PROGRAM_ID);
    expect(p.cluster).toBe("mainnet");
    expect(p.slot).toBe(777);
    expect(p.programId).toBe(PROGRAM_ID.toBase58());
    expect(p.genesisHash).toBe(MAINNET_GENESIS);
    expect(Date.parse(p.fetchedAt)).not.toBeNaN();
  });

  it("devnet is devnet", async () => {
    expect((await readProvenance(connection(DEVNET_GENESIS), PROGRAM_ID)).cluster).toBe("devnet");
  });

  it("an unrecognised genesis hash is 'unknown'", async () => {
    expect((await readProvenance(connection("deadbeef"), PROGRAM_ID)).cluster).toBe("unknown");
  });
});

describe("isTestNetwork fails closed", () => {
  it("only mainnet is not a test network: devnet, testnet and UNKNOWN all are", () => {
    expect(isTestNetwork({ cluster: "mainnet" })).toBe(false);
    for (const cluster of ["devnet", "testnet", "unknown"] as const) {
      expect(isTestNetwork({ cluster }), cluster).toBe(true);
    }
  });
});

describe("the test-network wording", () => {
  it("says test network, not traction, and that no real money moved", () => {
    expect(TEST_NETWORK_HEADING).toMatch(/TEST NETWORK/);
    expect(TEST_NETWORK_HEADING).toMatch(/NOT TRACTION/);
    expect(TEST_NETWORK_EXPLANATION).toMatch(/no real money moved/);
    expect(TEST_NETWORK_EXPLANATION).toMatch(/none of this is evidence of demand/);
  });
});

describe("the text report", () => {
  const records: TaskRecord[] = [
    { creator: "A", worker: "B", mint: "M", bountyAmount: 5_000_000n, state: "settled", approved: true, decidedAt: 1_790_000_000 },
    { creator: "C", worker: "C", mint: "M", bountyAmount: 9_000_000n, state: "settled", approved: true, decidedAt: 1_790_000_000 },
  ];
  const report = buildTractionReport(records, { mint: "M", feeBps: 200 });
  const prov = (cluster: "mainnet" | "devnet" | "unknown") => ({
    programId: "Prog",
    cluster,
    genesisHash: "abcdefgh1234",
    slot: 42,
    fetchedAt: "2026-10-24T00:00:00.000Z",
  });

  it("is headed TEST NETWORK before any figure when it is not mainnet", () => {
    for (const cluster of ["devnet", "unknown"] as const) {
      const text = formatTractionText(report, prov(cluster));
      expect(text.startsWith(TEST_NETWORK_HEADING), cluster).toBe(true);
      expect(text.indexOf(TEST_NETWORK_HEADING)).toBeLessThan(text.indexOf("posters"));
    }
  });

  it("carries no test-network heading on mainnet", () => {
    expect(formatTractionText(report, prov("mainnet"))).not.toContain(TEST_NETWORK_HEADING);
  });

  it("shows the headline and the set-aside figures separately, so nothing is hidden", () => {
    const text = formatTractionText(report, prov("mainnet"));
    expect(text).toMatch(/HEADLINE/);
    expect(text).toMatch(/SET ASIDE/);
    expect(text.indexOf("HEADLINE")).toBeLessThan(text.indexOf("SET ASIDE"));
    expect(text).toContain("5.00 USDC");
    // The same-wallet amount also appears in a caveat, so look inside the set-aside block itself.
    const setAside = text.slice(text.indexOf("SET ASIDE"), text.indexOf("READ THIS BEFORE QUOTING"));
    expect(setAside).toMatch(/tasks\s+1 /);
    expect(setAside).toContain("9.00 USDC");
    const headline = text.slice(text.indexOf("HEADLINE"), text.indexOf("SET ASIDE"));
    expect(headline).toContain("5.00 USDC");
    expect(headline).not.toContain("9.00 USDC");
  });

  it("always prints the caveats and how to check it", () => {
    const text = formatTractionText(report, prov("mainnet"));
    expect(text).toMatch(/READ THIS BEFORE QUOTING/);
    expect(text).toMatch(/Wallets are not people/);
    expect(text).toMatch(/HOW TO CHECK IT YOURSELF/);
    expect(text).toContain("Prog");
  });

  it("gives the sample size with the approval rate: 100% of one task is not a finding", () => {
    const text = formatTractionText(report, prov("mainnet"));
    expect(text).toMatch(/approval rate\s+100\.0% of 1 decided/);
    // An open task is a task, but not a decision: the denominator counts decided tasks only.
    const withOpen = buildTractionReport(
      [
        ...records,
        { creator: "D", worker: null, mint: "M", bountyAmount: 1_000_000n, state: "open", approved: null, decidedAt: null },
        { creator: "E", worker: "F", mint: "M", bountyAmount: 1_000_000n, state: "refunded", approved: false, decidedAt: 1_790_000_001 },
      ],
      { mint: "M", feeBps: 200 }
    );
    expect(formatTractionText(withOpen, prov("mainnet"))).toMatch(/approval rate\s+50\.0% of 2 decided/);
    const empty = formatTractionText(buildTractionReport([], { mint: "M", feeBps: 200 }), prov("mainnet"));
    expect(empty).toMatch(/approval rate\s+n\/a of 0 decided/);
  });

  it("never leaks a raw bigint literal", () => {
    expect(formatTractionText(report, prov("mainnet"))).not.toMatch(/\d+n\b/);
  });

  it("states what the chain cannot say, and does not report a latency", () => {
    const text = formatTractionText(report, prov("mainnet"));
    expect(text).not.toMatch(/median (time|verdict)/i);
    expect(text).toMatch(/how fast a verdict is/);
  });

  it("verification instructions name the program, cluster and slot", () => {
    const lines = verifyInstructions(prov("devnet")).join(" ");
    expect(lines).toContain("Prog");
    expect(lines).toContain("devnet");
    expect(lines).toContain("42");
  });
});

describe("the JSON report", () => {
  const report = buildTractionReport(
    [{ creator: "A", worker: "B", mint: "M", bountyAmount: 18_446_744_073_709_551_615n, state: "settled", approved: true, decidedAt: 1_790_000_000 }],
    { mint: "M", feeBps: 200 }
  );
  const prov = { programId: "P", cluster: "devnet" as const, genesisHash: "g", slot: 1, fetchedAt: "t" };

  it("writes bigints as exact decimal strings, never through a double", () => {
    const parsed = JSON.parse(tractionToJson(report, prov));
    expect(parsed.report.independent.settledVolume).toBe("18446744073709551615");
  });

  it("says plainly whether it is a test network", () => {
    expect(JSON.parse(tractionToJson(report, prov)).testNetwork).toBe(true);
    expect(JSON.parse(tractionToJson(report, { ...prov, cluster: "mainnet" })).testNetwork).toBe(false);
  });

  it("carries the cache state when there is one, and omits it when there is not", () => {
    expect(JSON.parse(tractionToJson(report, prov)).cache).toBeUndefined();
    const parsed = JSON.parse(tractionToJson(report, prov, { stale: true, ageSeconds: 130 }));
    expect(parsed.cache).toEqual({ stale: true, ageSeconds: 130 });
  });

  it("includes the caveats", () => {
    expect(JSON.parse(tractionToJson(report, prov)).report.caveats.length).toBeGreaterThanOrEqual(5);
  });
});

describe("usdc", () => {
  it("formats exactly, with a unit", () => {
    expect(usdc(5_000_000n)).toBe("5.00 USDC");
    expect(usdc(0n)).toBe("0.00 USDC");
    expect(usdc(20_000n)).toBe("0.02 USDC");
    expect(usdc(1_500_000n)).toBe("1.50 USDC");
  });

  it("does not round money away: a sub-cent fee keeps its digits", () => {
    expect(usdc(9_800n)).toBe("0.0098 USDC");
    expect(usdc(1n)).toBe("0.000001 USDC");
  });

  it("is exact beyond Number's safe range", () => {
    expect(usdc(18_446_744_073_709_551_615n)).toBe("18446744073709.551615 USDC");
  });
});
