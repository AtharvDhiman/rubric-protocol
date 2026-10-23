import { describe, it, expect } from "vitest";
import {
  DEFAULT_WARN_LAMPORTS,
  LAMPORTS_PER_SIGNATURE,
  evaluateVerifierHealth,
  formatSol,
  misconfiguredReport,
  statusFor,
  unreadableReport,
  warnLamportsFromEnv,
  worstCaseVerdictLamports,
  type HealthInputs,
} from "./verifier-health";

// The figures read from mainnet and devnet on 2026-10-22, not invented ones.
const RENT_FLOOR = 650_240; // system account, 0 bytes
const TOKEN_RENT = 1_488_440; // token account, 165 bytes
const WORST_CASE = 5_000 + 3 * TOKEN_RENT; // 4,470,320

const base = (over: Partial<HealthInputs> = {}): HealthInputs => ({
  balanceLamports: 119_990_000, // the live devnet verifier when this was written
  rentFloorLamports: RENT_FLOOR,
  tokenAccountRentLamports: TOKEN_RENT,
  warnLamports: DEFAULT_WARN_LAMPORTS,
  signerMatchesChain: true,
  nextKeyError: null,
  ...over,
});

describe("the numbers", () => {
  it("a worst-case verdict is a fee plus recreating three token accounts", () => {
    expect(worstCaseVerdictLamports(TOKEN_RENT)).toBe(WORST_CASE);
    expect(WORST_CASE).toBe(4_470_320);
  });

  it("counts verdicts from the SPENDABLE balance, above the rent floor", () => {
    const r = evaluateVerifierHealth(base());
    expect(r.spendableLamports).toBe(119_990_000 - RENT_FLOOR);
    expect(r.typicalVerdictsRemaining).toBe(23_867); // matches the figure worked out by hand
    expect(r.worstCaseVerdictsRemaining).toBe(Math.floor((119_990_000 - RENT_FLOOR) / WORST_CASE));
  });

  it("never reports negative spendable funds", () => {
    expect(evaluateVerifierHealth(base({ balanceLamports: 100 })).spendableLamports).toBe(0);
  });
});

describe("levels, at their exact boundaries", () => {
  it("ok at and above the warning line", () => {
    expect(evaluateVerifierHealth(base({ balanceLamports: DEFAULT_WARN_LAMPORTS })).level).toBe("ok");
    expect(evaluateVerifierHealth(base({ balanceLamports: 2 * DEFAULT_WARN_LAMPORTS })).level).toBe("ok");
  });

  it("low one lamport below the warning line", () => {
    const r = evaluateVerifierHealth(base({ balanceLamports: DEFAULT_WARN_LAMPORTS - 1 }));
    expect(r.level).toBe("low");
    expect(r.canSettle).toBe(true); // low is a warning, not a stop
  });

  it("critical when it cannot guarantee one worst-case verdict", () => {
    const justEnough = evaluateVerifierHealth(base({ balanceLamports: RENT_FLOOR + WORST_CASE, warnLamports: 1 }));
    expect(justEnough.level).toBe("ok");
    const justShort = evaluateVerifierHealth(base({ balanceLamports: RENT_FLOOR + WORST_CASE - 1 }));
    expect(justShort.level).toBe("critical");
    expect(justShort.canSettle).toBe(false);
  });

  it("empty when it cannot pay a single fee and stay above the rent floor", () => {
    const ok = evaluateVerifierHealth(base({ balanceLamports: RENT_FLOOR + LAMPORTS_PER_SIGNATURE }));
    expect(ok.level).toBe("critical"); // can pay a fee, but not a worst-case verdict
    const empty = evaluateVerifierHealth(base({ balanceLamports: RENT_FLOOR + LAMPORTS_PER_SIGNATURE - 1 }));
    expect(empty.level).toBe("empty");
    expect(empty.canSettle).toBe(false);
  });

  it("a wallet at exactly the rent floor is empty, not 'nearly fine'", () => {
    // "Empty" is not zero: the account may not be left below the floor.
    expect(evaluateVerifierHealth(base({ balanceLamports: RENT_FLOOR })).level).toBe("empty");
    expect(evaluateVerifierHealth(base({ balanceLamports: 0 })).level).toBe("empty");
  });
});

describe("precedence: the unfixable-by-topping-up problem is reported first", () => {
  it("mismatch beats empty", () => {
    const r = evaluateVerifierHealth(base({ signerMatchesChain: false, balanceLamports: 0 }));
    expect(r.level).toBe("mismatch");
    expect(r.canSettle).toBe(false);
    expect(r.message).toMatch(/Topping up does not fix this/);
  });

  it("empty beats a bad NEXT key", () => {
    expect(evaluateVerifierHealth(base({ balanceLamports: 0, nextKeyError: "bad" })).level).toBe("empty");
  });

  it("a bad NEXT key is 'misconfigured' - alertable, but the current key still settles", () => {
    const r = evaluateVerifierHealth(base({ nextKeyError: "VERIFIER_SECRET_KEY_NEXT could not be decoded." }));
    expect(r.level).toBe("misconfigured");
    expect(r.ok).toBe(false);
    expect(r.canSettle).toBe(true);
    expect(r.problems).toHaveLength(1);
  });

  it("misconfigured beats low", () => {
    expect(
      evaluateVerifierHealth(base({ balanceLamports: DEFAULT_WARN_LAMPORTS - 1, nextKeyError: "bad" })).level
    ).toBe("misconfigured");
  });
});

describe("what a monitor sees", () => {
  it("only a fully healthy verifier is a 200", () => {
    expect(statusFor(evaluateVerifierHealth(base()))).toBe(200);
    for (const over of [
      { balanceLamports: DEFAULT_WARN_LAMPORTS - 1 },
      { balanceLamports: 0 },
      { signerMatchesChain: false },
      { nextKeyError: "x" },
    ]) {
      expect(statusFor(evaluateVerifierHealth(base(over)))).toBe(503);
    }
  });

  it("an unreadable chain is unhealthy, never assumed fine", () => {
    const r = unreadableReport("timeout");
    expect(r.level).toBe("unreadable");
    expect(r.canSettle).toBe(false);
    expect(statusFor(r)).toBe(503);
    expect(r.message).toMatch(/timeout/);
  });

  it("missing configuration is unhealthy and cannot settle", () => {
    const r = misconfiguredReport("VERIFIER_SECRET_KEY is not set.");
    expect(r.level).toBe("misconfigured");
    expect(r.canSettle).toBe(false);
    expect(statusFor(r)).toBe(503);
  });

  it("messages carry no key material, only amounts and public keys", () => {
    for (const r of [evaluateVerifierHealth(base()), evaluateVerifierHealth(base({ balanceLamports: 0 }))]) {
      expect(r.message).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{60,}/); // no secret-key-length base58 run
    }
  });
});

describe("warnLamportsFromEnv", () => {
  it("defaults, and reads SOL", () => {
    expect(warnLamportsFromEnv(undefined)).toBe(DEFAULT_WARN_LAMPORTS);
    expect(warnLamportsFromEnv("")).toBe(DEFAULT_WARN_LAMPORTS);
    expect(warnLamportsFromEnv("0.2")).toBe(200_000_000);
  });

  it("a typo cannot silently disable the warning", () => {
    for (const bad of ["abc", "0", "-1", "NaN", "Infinity"]) {
      expect(warnLamportsFromEnv(bad)).toBe(DEFAULT_WARN_LAMPORTS);
    }
  });
});

describe("formatSol", () => {
  it("is readable and exact enough to compare against an explorer", () => {
    expect(formatSol(119_990_000)).toBe("0.11999");
    expect(formatSol(50_000_000)).toBe("0.05");
    expect(formatSol(650_240)).toBe("0.00065");
    expect(formatSol(1_000_000_000)).toBe("1.0");
  });
});
