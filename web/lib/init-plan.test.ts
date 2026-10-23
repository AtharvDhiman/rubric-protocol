import { describe, it, expect } from "vitest";
import {
  ABSOLUTE_MAX_BOUNTY,
  DEFAULT_PUBKEY,
  MAINNET_GENESIS,
  MAINNET_USDC,
  TOKEN_PROGRAM,
  clusterOf,
  evaluatePlan,
  fingerprint,
  isBlocked,
  type Facts,
  type PlanInputs,
} from "./init-plan";

const PROGRAM = "F2Uo5JUfGQtho8s9ZbwcpWBd8iJ4XvBqamUaqdjcrRxz";
const VAULT = "VaultPDA11111111111111111111111111111111111"; // stands in for a multisig vault
const FEE_WALLET = "FeeWa11et1111111111111111111111111111111111";
const VERIFIER = "Verifier11111111111111111111111111111111111";

const goodInputs = (): PlanInputs => ({
  admin: VAULT,
  mint: MAINNET_USDC,
  feeDestination: FEE_WALLET,
  verifier: VERIFIER,
  feeBps: 200,
  maxBounty: 50_000_000n,
  allowEoaAdmin: false,
});

/** A mainnet-shaped, fully healthy set of chain facts. */
const goodFacts = (): Facts => ({
  cluster: "mainnet",
  programDeployed: true,
  upgradeAuthority: VAULT,
  configExists: false,
  limitsExists: false,
  mint: { owner: TOKEN_PROGRAM, decimals: 6, freezeAuthority: "Circle1111111111111111111111111111111111111" },
  feeDestinationTokenAccountExists: true,
  adminIsOnCurve: false,
});

const failing = (i: PlanInputs, f: Facts) =>
  evaluatePlan(i, f, PROGRAM).filter((c) => c.severity === "fail").map((c) => c.id);
const warnings = (i: PlanInputs, f: Facts) =>
  evaluatePlan(i, f, PROGRAM).filter((c) => c.severity === "warn").map((c) => c.id);

describe("a healthy mainnet plan", () => {
  it("is not blocked", () => {
    const checks = evaluatePlan(goodInputs(), goodFacts(), PROGRAM);
    expect(isBlocked(checks)).toBe(false);
    expect(failing(goodInputs(), goodFacts())).toEqual([]);
  });

  it("still warns that the mint is freezable, without blocking", () => {
    // Real USDC has a freeze authority; that is a property to be aware of, not a reason to refuse.
    expect(warnings(goodInputs(), goodFacts())).toContain("MINT_FREEZABLE");
    expect(isBlocked(evaluatePlan(goodInputs(), goodFacts(), PROGRAM))).toBe(false);
  });
});

describe("who may initialise", () => {
  it("refuses when the admin is not the upgrade authority, and names both", () => {
    const facts = { ...goodFacts(), upgradeAuthority: "SomeoneElse111111111111111111111111111111111" };
    expect(failing(goodInputs(), facts)).toContain("UPGRADE_AUTHORITY_IS_ADMIN");
    const message = evaluatePlan(goodInputs(), facts, PROGRAM).find((c) => c.id === "UPGRADE_AUTHORITY_IS_ADMIN")!.message;
    expect(message).toContain("SomeoneElse");
    expect(message).toContain(VAULT);
  });

  it("refuses an immutable program, which can never be initialised", () => {
    expect(failing(goodInputs(), { ...goodFacts(), upgradeAuthority: null })).toContain("UPGRADE_AUTHORITY_IS_ADMIN");
  });

  it("refuses when no program is deployed", () => {
    expect(failing(goodInputs(), { ...goodFacts(), programDeployed: false })).toContain("PROGRAM_DEPLOYED");
  });

  it("refuses when Config or Limits already exist", () => {
    expect(failing(goodInputs(), { ...goodFacts(), configExists: true })).toContain("CONFIG_NOT_INITIALISED");
    expect(failing(goodInputs(), { ...goodFacts(), limitsExists: true })).toContain("LIMITS_NOT_INITIALISED");
  });
});

describe("the mint is permanent, so it is checked hard", () => {
  it("refuses any mint but USDC on mainnet", () => {
    const inputs = { ...goodInputs(), mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" }; // devnet USDC
    expect(failing(inputs, goodFacts())).toContain("MAINNET_MINT_IS_USDC");
  });

  it("allows another mint off mainnet, for rehearsals", () => {
    const inputs = { ...goodInputs(), mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" };
    expect(failing(inputs, { ...goodFacts(), cluster: "devnet" })).not.toContain("MAINNET_MINT_IS_USDC");
  });

  it("refuses a mint that does not have 6 decimals", () => {
    const facts = { ...goodFacts(), mint: { ...goodFacts().mint!, decimals: 9 } };
    expect(failing(goodInputs(), facts)).toContain("MINT_DECIMALS");
  });

  it("refuses a Token-2022 mint", () => {
    const facts = { ...goodFacts(), mint: { ...goodFacts().mint!, owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" } };
    expect(failing(goodInputs(), facts)).toContain("MINT_OWNER");
  });

  it("refuses a mint that does not exist", () => {
    expect(failing(goodInputs(), { ...goodFacts(), mint: null })).toContain("MINT_EXISTS");
  });
});

describe("the numbers", () => {
  it("accepts the fee ceiling and refuses one basis point over", () => {
    expect(failing({ ...goodInputs(), feeBps: 1_000 }, goodFacts())).not.toContain("FEE_BPS");
    expect(failing({ ...goodInputs(), feeBps: 1_001 }, goodFacts())).toContain("FEE_BPS");
    expect(failing({ ...goodInputs(), feeBps: -1 }, goodFacts())).toContain("FEE_BPS");
    expect(failing({ ...goodInputs(), feeBps: 2.5 }, goodFacts())).toContain("FEE_BPS");
  });

  it("accepts the hard ceiling and refuses zero and one unit over", () => {
    expect(failing({ ...goodInputs(), maxBounty: ABSOLUTE_MAX_BOUNTY }, goodFacts())).not.toContain("MAX_BOUNTY");
    expect(failing({ ...goodInputs(), maxBounty: ABSOLUTE_MAX_BOUNTY + 1n }, goodFacts())).toContain("MAX_BOUNTY");
    expect(failing({ ...goodInputs(), maxBounty: 0n }, goodFacts())).toContain("MAX_BOUNTY");
  });
});

describe("separation of duties", () => {
  it("refuses a verifier that is the admin: a hot key must not be the admin", () => {
    expect(failing({ ...goodInputs(), verifier: VAULT }, goodFacts())).toContain("VERIFIER_IS_NOT_ADMIN");
  });

  it("warns, without blocking, when the verifier or admin is also the fee wallet", () => {
    const verifierIsFee = { ...goodInputs(), feeDestination: VERIFIER };
    expect(warnings(verifierIsFee, goodFacts())).toContain("VERIFIER_IS_NOT_FEE_WALLET");
    expect(isBlocked(evaluatePlan(verifierIsFee, goodFacts(), PROGRAM))).toBe(false);

    const adminIsFee = { ...goodInputs(), feeDestination: VAULT };
    expect(warnings(adminIsFee, goodFacts())).toContain("ADMIN_IS_NOT_FEE_WALLET");
  });

  it("refuses the all-zero key anywhere", () => {
    for (const field of ["admin", "mint", "feeDestination", "verifier"] as const) {
      expect(failing({ ...goodInputs(), [field]: DEFAULT_PUBKEY }, goodFacts())).toContain("NO_ZERO_KEYS");
    }
  });
});

describe("the admin is permanent", () => {
  it("refuses an ordinary keypair address as the mainnet admin", () => {
    expect(failing(goodInputs(), { ...goodFacts(), adminIsOnCurve: true })).toContain("ADMIN_LOOKS_LIKE_A_MULTISIG");
  });

  it("allows it only when explicitly asked, and still warns", () => {
    const inputs = { ...goodInputs(), allowEoaAdmin: true };
    const facts = { ...goodFacts(), adminIsOnCurve: true };
    expect(failing(inputs, facts)).not.toContain("ADMIN_LOOKS_LIKE_A_MULTISIG");
    expect(warnings(inputs, facts)).toContain("ADMIN_LOOKS_LIKE_A_MULTISIG");
  });

  it("only warns off mainnet, where a rehearsal may use an ordinary wallet", () => {
    const facts = { ...goodFacts(), cluster: "devnet" as const, adminIsOnCurve: true };
    expect(failing(goodInputs(), facts)).not.toContain("ADMIN_LOOKS_LIKE_A_MULTISIG");
    expect(warnings(goodInputs(), facts)).toContain("ADMIN_LOOKS_LIKE_A_MULTISIG");
  });
});

describe("the fee account", () => {
  it("warns, without blocking, when it does not exist yet", () => {
    const facts = { ...goodFacts(), feeDestinationTokenAccountExists: false };
    expect(warnings(goodInputs(), facts)).toContain("FEE_ACCOUNT_EXISTS");
    expect(isBlocked(evaluatePlan(goodInputs(), facts, PROGRAM))).toBe(false);
  });
});

describe("clusterOf", () => {
  it("identifies mainnet by its genesis hash, not by anything a URL could say", () => {
    expect(clusterOf(MAINNET_GENESIS)).toBe("mainnet");
    expect(clusterOf("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")).toBe("devnet");
    expect(clusterOf("4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY")).toBe("testnet");
    expect(clusterOf("anything-else")).toBe("unknown");
  });
});

describe("fingerprint", () => {
  const base = () => fingerprint(goodInputs(), PROGRAM, MAINNET_GENESIS);

  it("is stable for the same plan", () => {
    expect(base()).toBe(base());
    expect(base()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when ANY input changes - one digit is enough", () => {
    const seen = new Set([base()]);
    const variants: Array<[string, () => string]> = [
      ["admin", () => fingerprint({ ...goodInputs(), admin: "Admin2" + VAULT.slice(6) }, PROGRAM, MAINNET_GENESIS)],
      ["mint", () => fingerprint({ ...goodInputs(), mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1w" }, PROGRAM, MAINNET_GENESIS)],
      ["fee destination", () => fingerprint({ ...goodInputs(), feeDestination: "FeeWb11et1111111111111111111111111111111111" }, PROGRAM, MAINNET_GENESIS)],
      ["verifier", () => fingerprint({ ...goodInputs(), verifier: "Verifier21111111111111111111111111111111111" }, PROGRAM, MAINNET_GENESIS)],
      ["fee bps", () => fingerprint({ ...goodInputs(), feeBps: 201 }, PROGRAM, MAINNET_GENESIS)],
      ["cap by one base unit", () => fingerprint({ ...goodInputs(), maxBounty: 50_000_001n }, PROGRAM, MAINNET_GENESIS)],
      ["program", () => fingerprint(goodInputs(), "F2Uo5JUfGQtho8s9ZbwcpWBd8iJ4XvBqamUaqdjcrRxy", MAINNET_GENESIS)],
      ["cluster", () => fingerprint(goodInputs(), PROGRAM, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")],
    ];
    for (const [name, make] of variants) {
      const fp = make();
      expect(seen.has(fp), `changing the ${name} must change the fingerprint`).toBe(false);
      seen.add(fp);
    }
  });

  it("does not depend on a flag that does not change what is made permanent", () => {
    // allowEoaAdmin changes whether the plan is ALLOWED, not what it creates.
    expect(fingerprint({ ...goodInputs(), allowEoaAdmin: true }, PROGRAM, MAINNET_GENESIS)).toBe(base());
  });
});
