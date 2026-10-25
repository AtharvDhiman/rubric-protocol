/**
 * GET /api/stats, with the chain read mocked.
 *
 * The behaviour worth pinning is what a consumer can rely on: amounts are exact strings,
 * the response says whether it is a test network and whether it is a copy, a copy is never
 * pinned in a shared cache, and a failure leaks nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getTraction: vi.fn() }));
vi.mock("@/lib/server/traction", () => ({ getTraction: mocks.getTraction }));

import { GET } from "@/app/api/stats/route";
import { buildTractionReport, type TaskRecord } from "@/lib/traction";
import { TeamWalletsError } from "@/lib/team-wallets";
import type { Provenance } from "@/lib/traction-chain";

const records: TaskRecord[] = [
  { creator: "A", worker: "B", mint: "M", bountyAmount: 18_446_744_073_709_551_615n, state: "settled", approved: true, decidedAt: 1_790_000_000 },
];
const report = buildTractionReport(records, { mint: "M", feeBps: 200 });
const provenance = (cluster: Provenance["cluster"]): Provenance => ({
  programId: "Prog",
  cluster,
  genesisHash: "abcdefgh1234",
  slot: 42,
  fetchedAt: "2026-10-24T00:00:00.000Z",
});
const reading = (cluster: Provenance["cluster"], over: { ageMs?: number; stale?: boolean } = {}) => ({
  value: { report, provenance: provenance(cluster) },
  ageMs: 4_400,
  stale: false,
  ...over,
});

// A block body, not an expression: vitest runs a function RETURNED from beforeEach as a
// teardown, and mockReset() returns the mock, which would be called after every test.
beforeEach(() => {
  mocks.getTraction.mockReset();
});

describe("a successful read", () => {
  it("returns the report as JSON with exact amounts, never numbers", async () => {
    mocks.getTraction.mockResolvedValue(reading("devnet"));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    const body = await response.json();
    expect(body.report.independent.settledVolume).toBe("18446744073709551615");
    expect(typeof body.report.independent.settledVolume).toBe("string");
  });

  it("says plainly that a devnet reading is a test network, and that mainnet is not", async () => {
    mocks.getTraction.mockResolvedValue(reading("devnet"));
    expect((await (await GET()).json()).testNetwork).toBe(true);
    mocks.getTraction.mockResolvedValue(reading("mainnet"));
    expect((await (await GET()).json()).testNetwork).toBe(false);
  });

  it("fails closed: a cluster it cannot identify is a test network", async () => {
    mocks.getTraction.mockResolvedValue(reading("unknown"));
    expect((await (await GET()).json()).testNetwork).toBe(true);
  });

  it("reports the provenance and the caveats", async () => {
    mocks.getTraction.mockResolvedValue(reading("devnet"));
    const body = await (await GET()).json();
    expect(body.provenance).toMatchObject({ programId: "Prog", cluster: "devnet", slot: 42 });
    expect(body.report.caveats.length).toBeGreaterThanOrEqual(5);
  });

  it("reports the age in whole seconds, and that it is not a copy", async () => {
    mocks.getTraction.mockResolvedValue(reading("devnet", { ageMs: 4_400 }));
    expect((await (await GET()).json()).cache).toEqual({ stale: false, ageSeconds: 4 });
  });

  it("lets a shared cache hold a fresh reading briefly", async () => {
    mocks.getTraction.mockResolvedValue(reading("devnet"));
    expect((await GET()).headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=60");
  });
});

describe("a copy served after a failed read", () => {
  it("is marked stale with its age", async () => {
    mocks.getTraction.mockResolvedValue(reading("devnet", { stale: true, ageMs: 130_000 }));
    expect((await (await GET()).json()).cache).toEqual({ stale: true, ageSeconds: 130 });
  });

  it("is never pinned in a shared cache", async () => {
    mocks.getTraction.mockResolvedValue(reading("devnet", { stale: true }));
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
  });
});

describe("a failed read with nothing to fall back on", () => {
  it("is a 503 with a fixed sentence, uncached", async () => {
    mocks.getTraction.mockRejectedValue(new Error("fetch failed for https://rpc.example/?api-key=SECRET"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Could not read the traction figures from the chain." });
  });

  it("never repeats what the RPC said", async () => {
    mocks.getTraction.mockRejectedValue(new Error("https://rpc.example/?api-key=SECRET"));
    const text = await (await GET()).text();
    expect(text).not.toMatch(/SECRET|rpc\.example|api-key/);
  });

  it("carries no figures", async () => {
    mocks.getTraction.mockRejectedValue(new Error("down"));
    const body = await (await GET()).json();
    expect(body.report).toBeUndefined();
    expect(body.provenance).toBeUndefined();
  });
});

describe("a team wallet list that cannot be trusted", () => {
  it("is told apart from an unreachable chain, with the error's own fixed sentence", async () => {
    mocks.getTraction.mockRejectedValue(new TeamWalletsError(["Entry 2 is not a valid Solana address."]));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "The list of team-controlled wallets is invalid, so no figures are produced.",
    });
  });

  it("carries no figures, and no entry from the list", async () => {
    mocks.getTraction.mockRejectedValue(new TeamWalletsError(["Entry 2 is not a valid Solana address."]));
    const text = await (await GET()).text();
    expect(text).not.toMatch(/Entry 2|report|provenance/);
  });

  it("an ordinary failure still gets the chain sentence", async () => {
    mocks.getTraction.mockRejectedValue(new Error("down"));
    expect((await (await GET()).json()).error).toBe("Could not read the traction figures from the chain.");
  });
});
