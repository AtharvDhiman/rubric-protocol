import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real reader builds an Anchor program and an RPC connection. These tests give the
// source its own reader, so the module under test is the caching and the logging.
vi.mock("./program", () => ({ readOnlyProgram: vi.fn(), serverConnection: vi.fn() }));

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { FRESH_MS, STALE_MS, createTractionSource, getTraction, readSnapshot, type TractionSnapshot } from "./traction";
import { readOnlyProgram, serverConnection } from "./program";
import { DEVNET_GENESIS } from "../init-plan";
import { TeamWalletsError } from "../team-wallets";
import { NO_TEAM_WALLETS_CAVEAT, buildTractionReport } from "../traction";

const snapshot = (n: number): TractionSnapshot => ({
  report: buildTractionReport([], { mint: "M", feeBps: 200 }),
  provenance: { programId: "P", cluster: "devnet", genesisHash: "g", slot: n, fetchedAt: "t" },
});

let t = 0;
const now = () => t;

beforeEach(() => {
  t = 1_000_000;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("the windows", () => {
  it("serve a reading for a minute and keep a copy for ten", () => {
    expect(FRESH_MS).toBe(60_000);
    expect(STALE_MS).toBe(600_000);
  });
});

describe("createTractionSource", () => {
  it("reads once for any number of visitors inside the fresh window", async () => {
    const read = vi.fn(async () => snapshot(1));
    const source = createTractionSource(read, now);
    await Promise.all([source.get(), source.get(), source.get()]);
    t += FRESH_MS - 1;
    await source.get();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads again after the fresh window", async () => {
    const read = vi.fn().mockResolvedValueOnce(snapshot(1)).mockResolvedValueOnce(snapshot(2));
    const source = createTractionSource(read, now);
    await source.get();
    t += FRESH_MS;
    expect((await source.get()).value.provenance.slot).toBe(2);
  });

  it("serves the earlier reading, flagged as a copy, when the chain cannot be read", async () => {
    const read = vi.fn().mockResolvedValueOnce(snapshot(1)).mockRejectedValue(new Error("down"));
    const source = createTractionSource(read, now);
    await source.get();
    t += 120_000;
    const copy = await source.get();
    expect(copy.stale).toBe(true);
    expect(copy.ageMs).toBe(120_000);
    expect(copy.value.provenance.slot).toBe(1);
  });

  it("shows nothing once the only copy is ten minutes old", async () => {
    const read = vi.fn().mockResolvedValueOnce(snapshot(1)).mockRejectedValue(new Error("down"));
    const source = createTractionSource(read, now);
    await source.get();
    t += STALE_MS;
    await expect(source.get()).rejects.toThrow("down");
  });

  it("logs the error NAME only, never the message that may hold an RPC key", async () => {
    class RpcFailure extends Error {
      constructor(message: string) {
        super(message);
        this.name = "RpcFailure";
      }
    }
    const source = createTractionSource(async () => {
      throw new RpcFailure("fetch failed for https://rpc.example/?api-key=SECRET");
    }, now);
    await expect(source.get()).rejects.toThrow();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("RpcFailure");
    expect(logged).not.toMatch(/SECRET|rpc\.example|api-key/);
  });

  it("a thrown non-Error is logged without echoing it", async () => {
    const source = createTractionSource(async () => {
      throw "https://rpc.example/?key=SECRET";
    }, now);
    await expect(source.get()).rejects.toBeDefined();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/SECRET/);
  });
});

describe("readSnapshot and the declared team wallets", () => {
  const MINT = Keypair.generate().publicKey;
  const PROGRAM_ID = Keypair.generate().publicKey;
  const CUSTOMER = Keypair.generate().publicKey;
  const TEAM = Keypair.generate().publicKey;
  const WORKER = Keypair.generate().publicKey;

  const onChain = (creator: typeof TEAM) => ({
    creator,
    worker: WORKER,
    mint: MINT,
    bountyAmount: { toString: () => "5000000" },
    state: { settled: {} },
    verdict: { approved: true, decidedAt: { toString: () => "1790000000" } },
  });

  beforeEach(() => {
    vi.mocked(readOnlyProgram).mockReset();
    vi.mocked(serverConnection).mockReset();
    vi.mocked(readOnlyProgram).mockReturnValue({
      programId: PROGRAM_ID,
      account: {
        task: { all: async () => [CUSTOMER, TEAM].map((c) => ({ publicKey: c, account: onChain(c) })) },
        config: { fetch: async () => ({ bountyMint: MINT, feeBps: 200 }) },
      },
    } as never);
    vi.mocked(serverConnection).mockReturnValue({ getGenesisHash: async () => DEVNET_GENESIS, getSlot: async () => 9 } as never);
  });
  afterEach(() => {
    delete process.env.TEAM_WALLETS;
  });

  it("sets aside the tasks of the wallets in TEAM_WALLETS", async () => {
    process.env.TEAM_WALLETS = TEAM.toBase58();
    const { report } = await readSnapshot();
    expect(report.teamWallets).toEqual([TEAM.toBase58()]);
    expect(report.teamControlled.tasks).toBe(1);
    expect(report.independent.tasks).toBe(1);
    expect(report.caveats).not.toContain(NO_TEAM_WALLETS_CAVEAT);
  });

  it("with TEAM_WALLETS unset, nothing is set aside and the report says it cannot be called traction", async () => {
    const { report } = await readSnapshot();
    expect(report.teamWallets).toEqual([]);
    expect(report.independent.tasks).toBe(2);
    expect(report.caveats).toContain(NO_TEAM_WALLETS_CAVEAT);
  });

  it("an empty TEAM_WALLETS is the same as unset", async () => {
    process.env.TEAM_WALLETS = "  ";
    expect((await readSnapshot()).report.teamWallets).toEqual([]);
  });

  it("a bad entry throws TeamWalletsError BEFORE any chain call, so no figures come from a bad list", async () => {
    process.env.TEAM_WALLETS = `${TEAM.toBase58()},not-an-address`;
    await expect(readSnapshot()).rejects.toBeInstanceOf(TeamWalletsError);
    expect(readOnlyProgram).not.toHaveBeenCalled();
    expect(serverConnection).not.toHaveBeenCalled();
  });

  it("a secret key pasted by mistake is refused and never appears in the error", async () => {
    const secret = bs58.encode(Keypair.generate().secretKey);
    process.env.TEAM_WALLETS = secret;
    const error = await readSnapshot().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TeamWalletsError);
    expect(JSON.stringify([(error as Error).message, (error as TeamWalletsError).problems])).not.toContain(secret);
  });

  it("getTraction refuses a bad list even when an earlier good reading is cached", async () => {
    process.env.TEAM_WALLETS = TEAM.toBase58();
    const first = await getTraction();
    expect(first.stale).toBe(false);
    // The list is now bad. A stale copy from the line above must NOT be served in its place,
    // flagged as an unreachable chain: this is a configuration error, and it must say so.
    process.env.TEAM_WALLETS = "not-an-address";
    await expect(getTraction()).rejects.toBeInstanceOf(TeamWalletsError);
  });

  it("getTraction checks the list before touching the chain", async () => {
    process.env.TEAM_WALLETS = "not-an-address";
    vi.mocked(readOnlyProgram).mockClear();
    await expect(getTraction()).rejects.toBeInstanceOf(TeamWalletsError);
    expect(readOnlyProgram).not.toHaveBeenCalled();
  });

  it("a bad list through the cached source is logged by NAME only, never the value", async () => {
    const secret = bs58.encode(Keypair.generate().secretKey);
    process.env.TEAM_WALLETS = secret;
    const source = createTractionSource(readSnapshot, now);
    await expect(source.get()).rejects.toBeInstanceOf(TeamWalletsError);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("TeamWalletsError");
    expect(logged).not.toContain(secret);
  });
});
