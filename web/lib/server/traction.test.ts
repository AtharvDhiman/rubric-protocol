import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real reader builds an Anchor program and an RPC connection. These tests give the
// source its own reader, so the module under test is the caching and the logging.
vi.mock("./program", () => ({ readOnlyProgram: vi.fn(), serverConnection: vi.fn() }));

import { FRESH_MS, STALE_MS, createTractionSource, type TractionSnapshot } from "./traction";
import { buildTractionReport } from "../traction";

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
