import { describe, it, expect } from "vitest";
import {
  evaluateCreate,
  fromPayload,
  refusalStatus,
  toPayload,
  type ProtocolLimits,
} from "./limits";

const FIFTY = 50_000_000n; // 50 USDC in base units
const open: ProtocolLimits = { maxBounty: FIFTY, paused: false };

describe("evaluateCreate", () => {
  it("allows a bounty within the cap", () => {
    expect(evaluateCreate(open, 25_000_000n)).toEqual({ ok: true });
  });

  it("allows exactly the cap, and refuses one base unit above it", () => {
    // The boundary is where an off-by-one would hide.
    expect(evaluateCreate(open, FIFTY)).toEqual({ ok: true });
    const over = evaluateCreate(open, FIFTY + 1n);
    expect(over).toMatchObject({ ok: false, code: "ABOVE_CAP" });
  });

  it("quotes the CURRENT cap from the chain, not a constant", () => {
    const raised = evaluateCreate({ maxBounty: 200_000_000n, paused: false }, 250_000_000n);
    expect(raised).toMatchObject({ ok: false, code: "ABOVE_CAP" });
    expect((raised as { message: string }).message).toContain("200.00 USDC");
    // The same bounty that failed at 50 is fine once the admin raises the cap.
    expect(evaluateCreate({ maxBounty: 300_000_000n, paused: false }, 250_000_000n)).toEqual({
      ok: true,
    });
  });

  it("refuses zero and negative bounties", () => {
    expect(evaluateCreate(open, 0n)).toMatchObject({ ok: false, code: "NOT_POSITIVE" });
    expect(evaluateCreate(open, -1n)).toMatchObject({ ok: false, code: "NOT_POSITIVE" });
  });

  it("refuses everything while paused, whatever the bounty", () => {
    const paused: ProtocolLimits = { maxBounty: FIFTY, paused: true };
    expect(evaluateCreate(paused, 1_000_000n)).toMatchObject({ ok: false, code: "PAUSED" });
    // A paused protocol is paused for everyone: state is reported before the
    // poster's own input, so an invalid bounty does not mask it.
    expect(evaluateCreate(paused, 0n)).toMatchObject({ ok: false, code: "PAUSED" });
  });

  it("says that existing tasks are unaffected when paused", () => {
    const verdict = evaluateCreate({ maxBounty: FIFTY, paused: true }, 1n);
    expect((verdict as { message: string }).message).toMatch(/already exist/i);
  });

  it("treats a missing Limits account as a refusal, never as 'no cap'", () => {
    // The dangerous reading of null is "unlimited". The program cannot create a
    // task without the account, so null must stop the poster, not wave them on.
    expect(evaluateCreate(null, 1n)).toMatchObject({ ok: false, code: "NOT_INITIALISED" });
    expect(evaluateCreate(null, 10n ** 18n)).toMatchObject({ ok: false, code: "NOT_INITIALISED" });
  });
});

describe("refusalStatus", () => {
  it("maps protocol state to 503 and the poster's input to 400", () => {
    expect(refusalStatus("NOT_INITIALISED")).toBe(503);
    expect(refusalStatus("PAUSED")).toBe(503);
    expect(refusalStatus("ABOVE_CAP")).toBe(400);
    expect(refusalStatus("NOT_POSITIVE")).toBe(400);
  });
});

describe("the wire form", () => {
  it("round-trips, keeping amounts as exact integers", () => {
    const big = { maxBounty: 9_007_199_254_740_993n, paused: true }; // > 2^53
    expect(fromPayload(toPayload(big))).toEqual(big);
  });

  it("represents an uninitialised account explicitly rather than as a zero cap", () => {
    expect(toPayload(null)).toEqual({ initialised: false, maxBounty: "0", paused: false });
    expect(fromPayload(toPayload(null))).toBeNull();
  });

  it("survives JSON, which has no bigint", () => {
    const json = JSON.stringify(toPayload(open));
    expect(fromPayload(JSON.parse(json))).toEqual(open);
  });
});
