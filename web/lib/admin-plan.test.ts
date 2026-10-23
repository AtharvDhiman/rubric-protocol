import { describe, it, expect } from "vitest";
import {
  ADMIN_INSTRUCTIONS,
  actionParam,
  describeAction,
  evaluateAdminAction,
  fingerprintAdmin,
  parseAdminArgs,
  type AdminAction,
  type AdminFacts,
  type AdminInputs,
} from "./admin-plan";
import { DEFAULT_PUBKEY, isBlocked, MAINNET_GENESIS, type Check } from "./init-plan";
import { LAUNCH_MAX_BOUNTY_BASE_UNITS } from "./constants";

// Plausible base58 keys. Only their shape and equality matter to these tests.
const ADMIN = "ADMiN11111111111111111111111111111111111111";
const STRANGER = "STrANGer1111111111111111111111111111111111";
const VERIFIER = "VERiFieR111111111111111111111111111111111";
const NEW_VERIFIER = "NEWveRiF1111111111111111111111111111111111";
const FEE_DEST = "FEEdEST11111111111111111111111111111111111";
const NEW_FEE = "NEWfeE111111111111111111111111111111111111";
const PROGRAM = "F2Uo5JUfGQtho8s9ZbwcpWBd8iJ4XvBqamUaqdjcrRxz";

const LAUNCH = BigInt(LAUNCH_MAX_BOUNTY_BASE_UNITS);

const facts = (over: Partial<AdminFacts> = {}): AdminFacts => ({
  cluster: "mainnet",
  programDeployed: true,
  config: { admin: ADMIN, verifierAuthority: VERIFIER, feeDestination: FEE_DEST },
  limits: { maxBounty: LAUNCH, paused: false },
  feeDestinationTokenAccountExists: true,
  verifierWallet: {
    balanceLamports: 500_000_000,
    rentFloorLamports: 890_880,
    tokenAccountRentLamports: 2_039_280,
    isOnCurve: true,
  },
  ...over,
});

const run = (action: AdminAction, f: AdminFacts = facts(), admin = ADMIN): Check[] =>
  evaluateAdminAction({ admin, action } satisfies AdminInputs, f, PROGRAM);
const ids = (cs: Check[], severity: Check["severity"]) => cs.filter((c) => c.severity === severity).map((c) => c.id);
const get = (cs: Check[], id: string) => cs.find((c) => c.id === id);

describe("checks common to every action", () => {
  it("a healthy, correctly addressed proposal passes with no failures", () => {
    for (const action of [
      { kind: "pause" },
      { kind: "unpause" },
      { kind: "set-max-bounty", maxBounty: LAUNCH - 1_000_000n },
      { kind: "set-fee-destination", feeDestination: NEW_FEE },
      { kind: "set-verifier", verifier: NEW_VERIFIER },
    ] as AdminAction[]) {
      // unpause needs the protocol paused to be a real change; pause needs it open.
      const f = action.kind === "unpause" ? facts({ limits: { maxBounty: LAUNCH, paused: true } }) : facts();
      expect(isBlocked(run(action, f)), action.kind).toBe(false);
    }
  });

  it("refuses when no program is deployed, and judges nothing else", () => {
    const cs = run({ kind: "pause" }, facts({ programDeployed: false }));
    expect(ids(cs, "fail")).toEqual(["PROGRAM_DEPLOYED"]);
    expect(cs).toHaveLength(1);
  });

  it("refuses when the program was never initialised", () => {
    const cs = run({ kind: "pause" }, facts({ config: null }));
    expect(ids(cs, "fail")).toEqual(["CONFIG_EXISTS"]);
    expect(isBlocked(cs)).toBe(true);
  });

  it("refuses a proposal that is not addressed to the admin, and shows both keys", () => {
    const cs = run({ kind: "pause" }, facts(), STRANGER);
    expect(ids(cs, "fail")).toContain("SIGNER_IS_ADMIN");
    const msg = get(cs, "SIGNER_IS_ADMIN")!.message;
    expect(msg).toContain(ADMIN);
    expect(msg).toContain(STRANGER);
  });

  it("says plainly when it is mainnet, and warns on an unrecognised cluster", () => {
    expect(get(run({ kind: "pause" }), "CLUSTER")!.message).toMatch(/mainnet/i);
    expect(get(run({ kind: "pause" }, facts({ cluster: "unknown" })), "CLUSTER")!.severity).toBe("warn");
    expect(get(run({ kind: "pause" }, facts({ cluster: "devnet" })), "CLUSTER")!.severity).toBe("pass");
  });
});

describe("pause and unpause", () => {
  it("need the Limits account", () => {
    for (const kind of ["pause", "unpause"] as const) {
      const cs = run({ kind }, facts({ limits: null }));
      expect(ids(cs, "fail")).toContain("LIMITS_EXIST");
    }
  });

  it("warn, but do not block, when the protocol is already in the requested state", () => {
    const already = run({ kind: "pause" }, facts({ limits: { maxBounty: LAUNCH, paused: true } }));
    expect(get(already, "CHANGES_SOMETHING")!.severity).toBe("warn");
    expect(isBlocked(already)).toBe(false);

    const alreadyOpen = run({ kind: "unpause" });
    expect(get(alreadyOpen, "CHANGES_SOMETHING")!.severity).toBe("warn");
  });

  it("say that no escrowed money is trapped by a pause", () => {
    expect(get(run({ kind: "pause" }), "NO_MONEY_TRAPPED")!.message).toMatch(/settle, refund and can be reclaimed/);
  });
});

describe("set-max-bounty", () => {
  it("needs the Limits account", () => {
    expect(ids(run({ kind: "set-max-bounty", maxBounty: LAUNCH }, facts({ limits: null })), "fail")).toContain("LIMITS_EXIST");
  });

  it("refuses zero and anything above the compiled-in ceiling", () => {
    expect(ids(run({ kind: "set-max-bounty", maxBounty: 0n }), "fail")).toContain("CAP_IN_RANGE");
    expect(ids(run({ kind: "set-max-bounty", maxBounty: 1_000_000_001n }), "fail")).toContain("CAP_IN_RANGE");
    expect(ids(run({ kind: "set-max-bounty", maxBounty: 1_000_000_000n }), "fail")).not.toContain("CAP_IN_RANGE");
    expect(ids(run({ kind: "set-max-bounty", maxBounty: 1n }), "fail")).not.toContain("CAP_IN_RANGE");
  });

  it("warns on a RAISE, and says it rests on one judge and one key", () => {
    const cs = run({ kind: "set-max-bounty", maxBounty: LAUNCH + 1_000_000n });
    expect(get(cs, "CAP_RAISED")!.severity).toBe("warn");
    expect(get(cs, "CAP_RAISED")!.message).toMatch(/one AI judge and one verifier key/);
    expect(get(cs, "CAP_RAISED")!.message).toMatch(/above the .* launch value/);
    expect(isBlocked(cs)).toBe(false);
  });

  it("a raise that stays at or below the launch value does not claim to be above it", () => {
    const f = facts({ limits: { maxBounty: 10_000_000n, paused: false } });
    const cs = run({ kind: "set-max-bounty", maxBounty: LAUNCH }, f);
    expect(get(cs, "CAP_RAISED")!.message).not.toMatch(/launch value/);
  });

  it("a LOWER cap is a pass and says existing tasks keep their bounty", () => {
    const cs = run({ kind: "set-max-bounty", maxBounty: 10_000_000n });
    expect(get(cs, "CAP_LOWERED")!.severity).toBe("pass");
    expect(get(cs, "CAP_LOWERED")!.message).toMatch(/already exist keep/);
  });

  it("warns, does not block, on a no-op", () => {
    const cs = run({ kind: "set-max-bounty", maxBounty: LAUNCH });
    expect(get(cs, "CHANGES_SOMETHING")!.severity).toBe("warn");
    expect(isBlocked(cs)).toBe(false);
  });

  it("writes amounts in whole and fractional USDC, never raw base units", () => {
    const cs = run({ kind: "set-max-bounty", maxBounty: 1_500_000n });
    expect(get(cs, "CAP_IN_RANGE")!.message).toContain("1.5 USDC");
  });
});

describe("set-fee-destination", () => {
  it("refuses the all-zero key", () => {
    const cs = run({ kind: "set-fee-destination", feeDestination: DEFAULT_PUBKEY });
    expect(ids(cs, "fail")).toContain("DESTINATION_VALID");
  });

  it("warns on a no-op and shows old and new on a real change", () => {
    expect(get(run({ kind: "set-fee-destination", feeDestination: FEE_DEST }), "CHANGES_SOMETHING")!.severity).toBe("warn");
    const real = get(run({ kind: "set-fee-destination", feeDestination: NEW_FEE }), "CHANGES_SOMETHING")!;
    expect(real.message).toContain(FEE_DEST);
    expect(real.message).toContain(NEW_FEE);
  });

  it("warns when the destination is the admin itself", () => {
    const cs = run({ kind: "set-fee-destination", feeDestination: ADMIN });
    expect(get(cs, "DESTINATION_IS_ADMIN")!.severity).toBe("warn");
    expect(isBlocked(cs)).toBe(false);
  });

  it("warns, with the rent, when the new destination has no token account", () => {
    const cs = run({ kind: "set-fee-destination", feeDestination: NEW_FEE }, facts({ feeDestinationTokenAccountExists: false }));
    expect(get(cs, "FEE_ACCOUNT_EXISTS")!.severity).toBe("warn");
    expect(get(cs, "FEE_ACCOUNT_EXISTS")!.message).toMatch(/verifier creates it/);
  });

  it("warns, rather than passing, when it could not check", () => {
    const cs = run({ kind: "set-fee-destination", feeDestination: NEW_FEE }, facts({ feeDestinationTokenAccountExists: null }));
    expect(get(cs, "FEE_ACCOUNT_EXISTS")!.severity).toBe("warn");
  });

  it("says it takes effect only for later verdicts", () => {
    expect(get(run({ kind: "set-fee-destination", feeDestination: NEW_FEE }), "EFFECT")!.message).toMatch(/AFTER/);
  });
});

describe("set-verifier: the rotation that must not strand every task", () => {
  const wallet = (over: Partial<NonNullable<AdminFacts["verifierWallet"]>> = {}) =>
    facts({ verifierWallet: { ...facts().verifierWallet!, ...over } });

  it("refuses the all-zero key, which the program would accept", () => {
    expect(ids(run({ kind: "set-verifier", verifier: DEFAULT_PUBKEY }), "fail")).toContain("VERIFIER_VALID");
  });

  it("refuses when the new wallet could not be read, rather than assuming it is fine", () => {
    const cs = run({ kind: "set-verifier", verifier: NEW_VERIFIER }, facts({ verifierWallet: null }));
    expect(ids(cs, "fail")).toContain("VERIFIER_FUNDED");
  });

  it("refuses an address with no private key (a PDA)", () => {
    const cs = run({ kind: "set-verifier", verifier: NEW_VERIFIER }, wallet({ isOnCurve: false }));
    expect(ids(cs, "fail")).toContain("VERIFIER_IS_KEYPAIR");
  });

  it("refuses an EMPTY wallet: this is the failure the planner exists to prevent", () => {
    const cs = run({ kind: "set-verifier", verifier: NEW_VERIFIER }, wallet({ balanceLamports: 0 }));
    expect(ids(cs, "fail")).toContain("VERIFIER_FUNDED");
    expect(get(cs, "VERIFIER_FUNDED")!.message).toMatch(/every task fail to settle/);
    expect(isBlocked(cs)).toBe(true);
  });

  it("refuses a wallet that has only its rent floor, so nothing is spendable", () => {
    const cs = run({ kind: "set-verifier", verifier: NEW_VERIFIER }, wallet({ balanceLamports: 890_880 }));
    expect(isBlocked(cs)).toBe(true);
  });

  it("refuses a wallet that cannot cover one worst-case verdict", () => {
    // Spendable is above one fee but below fee + three token accounts of rent.
    const cs = run({ kind: "set-verifier", verifier: NEW_VERIFIER }, wallet({ balanceLamports: 890_880 + 1_000_000 }));
    expect(isBlocked(cs)).toBe(true);
  });

  it("only warns on a wallet that can settle but is below the warning line", () => {
    const cs = run({ kind: "set-verifier", verifier: NEW_VERIFIER }, wallet({ balanceLamports: 20_000_000 }));
    expect(get(cs, "VERIFIER_FUNDED")!.severity).toBe("warn");
    expect(isBlocked(cs)).toBe(false);
  });

  it("passes a well-funded wallet", () => {
    const cs = run({ kind: "set-verifier", verifier: NEW_VERIFIER });
    expect(get(cs, "VERIFIER_FUNDED")!.severity).toBe("pass");
  });

  it("warns, not blocks, when the key is already the verifier", () => {
    const cs = run({ kind: "set-verifier", verifier: VERIFIER });
    expect(get(cs, "CHANGES_SOMETHING")!.severity).toBe("warn");
  });
});

describe("the instruction each action maps to", () => {
  it("pause and unpause are the same instruction, with the Limits account", () => {
    expect(ADMIN_INSTRUCTIONS.pause).toEqual(ADMIN_INSTRUCTIONS.unpause);
    expect(ADMIN_INSTRUCTIONS.pause.idlName).toBe("set_paused");
    expect(ADMIN_INSTRUCTIONS.pause.accounts).toContain("limits");
  });

  it("the cap takes Limits; the fee destination and verifier take only Config", () => {
    expect(ADMIN_INSTRUCTIONS["set-max-bounty"].accounts).toContain("limits");
    expect(ADMIN_INSTRUCTIONS["set-fee-destination"].accounts).toEqual(["admin", "config"]);
    expect(ADMIN_INSTRUCTIONS["set-verifier"].accounts).toEqual(["admin", "config"]);
  });

  it("every one starts with the admin signer, as the program's has_one requires", () => {
    for (const spec of Object.values(ADMIN_INSTRUCTIONS)) expect(spec.accounts[0]).toBe("admin");
  });
});

describe("describeAction", () => {
  it("every action has a title and says what it does", () => {
    const actions: AdminAction[] = [
      { kind: "pause" },
      { kind: "unpause" },
      { kind: "set-max-bounty", maxBounty: 5_000_000n },
      { kind: "set-fee-destination", feeDestination: NEW_FEE },
      { kind: "set-verifier", verifier: NEW_VERIFIER },
    ];
    for (const a of actions) {
      const b = describeAction(a);
      expect(b.title.length, a.kind).toBeGreaterThan(0);
      expect(b.effect.length, a.kind).toBeGreaterThan(0);
    }
  });

  it("a rotation tells the signers to deploy the NEXT key BEFORE executing", () => {
    const b = describeAction({ kind: "set-verifier", verifier: NEW_VERIFIER });
    expect(b.before.join(" ")).toMatch(/VERIFIER_SECRET_KEY_NEXT/);
    expect(b.after.join(" ")).toMatch(/retire the old key/i);
  });

  it("a pause says it does not fix a compromised verifier", () => {
    expect(describeAction({ kind: "pause" }).after.join(" ")).toMatch(/does not fix a compromised verifier/);
  });

  it("the cap title carries the amount", () => {
    expect(describeAction({ kind: "set-max-bounty", maxBounty: 25_000_000n }).title).toContain("25 USDC");
  });
});

describe("fingerprintAdmin", () => {
  const base: AdminInputs = { admin: ADMIN, action: { kind: "set-max-bounty", maxBounty: 5_000_000n } };
  const fp = (i: AdminInputs, program = PROGRAM, genesis = MAINNET_GENESIS) => fingerprintAdmin(i, program, genesis);

  it("is stable and short", () => {
    expect(fp(base)).toBe(fp({ ...base }));
    expect(fp(base)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes with any input", () => {
    const original = fp(base);
    expect(fp({ ...base, admin: STRANGER })).not.toBe(original);
    expect(fp({ ...base, action: { kind: "set-max-bounty", maxBounty: 5_000_001n } })).not.toBe(original);
    expect(fp({ ...base, action: { kind: "pause" } })).not.toBe(original);
    expect(fp(base, "OtherProgram111111111111111111111111111111111")).not.toBe(original);
    expect(fp(base, PROGRAM, "devnetgenesis")).not.toBe(original);
  });

  it("pause and unpause never share a fingerprint", () => {
    expect(fp({ admin: ADMIN, action: { kind: "pause" } })).not.toBe(fp({ admin: ADMIN, action: { kind: "unpause" } }));
  });

  it("the same value under a different action is a different fingerprint", () => {
    const a = fp({ admin: ADMIN, action: { kind: "set-fee-destination", feeDestination: NEW_FEE } });
    const b = fp({ admin: ADMIN, action: { kind: "set-verifier", verifier: NEW_FEE } });
    expect(a).not.toBe(b);
  });

  it("actionParam is empty for the flag actions and the value otherwise", () => {
    expect(actionParam({ kind: "pause" })).toBe("");
    expect(actionParam({ kind: "set-max-bounty", maxBounty: 7n })).toBe("7");
    expect(actionParam({ kind: "set-verifier", verifier: NEW_VERIFIER })).toBe(NEW_VERIFIER);
  });
});

describe("parseAdminArgs", () => {
  const parse = (...argv: string[]) => parseAdminArgs(argv);
  const ok = (...argv: string[]) => {
    const r = parse(...argv);
    if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
    return r.value;
  };
  const err = (...argv: string[]) => {
    const r = parse(...argv);
    if (r.ok) throw new Error("expected an error");
    return r.error;
  };

  it("needs --admin, with no default", () => {
    expect(err("--pause")).toMatch(/--admin/);
    expect(err("--pause")).toMatch(/no default/);
  });

  it("needs exactly one action", () => {
    expect(err("--admin", ADMIN)).toMatch(/exactly one of/);
    expect(err("--admin", ADMIN, "--pause", "--unpause")).toMatch(/Exactly one action/);
    expect(err("--admin", ADMIN, "--pause", "--set-verifier", NEW_VERIFIER)).toMatch(/Exactly one action/);
  });

  it("parses each action", () => {
    expect(ok("--admin", ADMIN, "--pause").action).toEqual({ kind: "pause" });
    expect(ok("--admin", ADMIN, "--unpause").action).toEqual({ kind: "unpause" });
    expect(ok("--admin", ADMIN, "--set-max-bounty", "25").action).toEqual({ kind: "set-max-bounty", maxBounty: 25_000_000n });
    expect(ok("--admin", ADMIN, "--set-fee-destination", NEW_FEE).action).toEqual({ kind: "set-fee-destination", feeDestination: NEW_FEE });
    expect(ok("--admin", ADMIN, "--set-verifier", NEW_VERIFIER).action).toEqual({ kind: "set-verifier", verifier: NEW_VERIFIER });
  });

  it("carries --rpc and --confirm through", () => {
    const v = ok("--admin", ADMIN, "--pause", "--rpc", "https://rpc.example", "--confirm", "abc123");
    expect(v.rpc).toBe("https://rpc.example");
    expect(v.confirm).toBe("abc123");
    expect(ok("--admin", ADMIN, "--pause").rpc).toBeUndefined();
  });

  it("takes the cap as a whole number of USDC only", () => {
    for (const bad of ["0.5", "1e3", "-5", "many", "5 "]) {
      expect(err("--admin", ADMIN, "--set-max-bounty", bad), bad).toMatch(/whole number of USDC/);
    }
  });

  it("rejects things that are not public keys, for every key argument", () => {
    expect(err("--admin", "nope", "--pause")).toMatch(/--admin is not a valid public key/);
    expect(err("--admin", ADMIN, "--set-verifier", "nope")).toMatch(/--set-verifier is not a valid public key/);
    expect(err("--admin", ADMIN, "--set-fee-destination", "0OIl")).toMatch(/--set-fee-destination is not a valid public key/);
  });

  it("rejects unknown options and stray arguments instead of ignoring them", () => {
    expect(err("--admin", ADMIN, "--pause", "--puase")).toMatch(/Unknown option --puase/);
    expect(err("--admin", ADMIN, "--pause", "extra")).toMatch(/Unexpected argument/);
  });

  it("rejects a value flag that is missing its value or swallowed the next flag", () => {
    expect(err("--admin")).toMatch(/needs a value/);
    expect(err("--admin", ADMIN, "--set-max-bounty")).toMatch(/needs a value/);
    expect(err("--admin", ADMIN, "--set-max-bounty", "--pause")).toMatch(/needs a value/);
  });
});
