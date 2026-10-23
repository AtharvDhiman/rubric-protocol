/**
 * The decisions behind scripts/mainnet-init-plan.ts, as pure functions.
 *
 * WHY THIS IS A MODULE AND NOT JUST A SCRIPT
 * ------------------------------------------
 * `initialize_config` fixes the admin, the mint, the fee and the fee destination
 * FOREVER, and there is no admin rotation. A mistake is recoverable only by
 * redeploying under a new program id. The script that prepares that call has to
 * be unusually hard to get wrong, which means its refusals need to be tested
 * like code rather than read like a checklist. So every judgement lives here, as
 * a function of two plain objects - what the operator asked for, and what the
 * chain says - and the script is left with nothing to do but fetch the facts and
 * print.
 *
 * Nothing in here touches a key, a file or the network.
 */

import { createHash } from "node:crypto";

/** The mainnet-beta genesis hash. Cluster is identified by this, never by URL. */
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const TESTNET_GENESIS = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";

/** Circle's USDC on mainnet. Verified against the chain; a wrong mint here is permanent. */
export const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** The classic SPL Token program. The program types the mint against this one only. */
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Mirrors `ABSOLUTE_MAX_BOUNTY` in programs/rubric/src/constants.rs: 1,000 USDC. */
export const ABSOLUTE_MAX_BOUNTY = 1_000_000_000n;
/** Mirrors `MAX_FEE_BPS` in constants.rs: 10%. */
export const MAX_FEE_BPS = 1_000;
/** The all-zero key. What an unset field or a dropped argument looks like. */
export const DEFAULT_PUBKEY = "11111111111111111111111111111111";

export type Cluster = "mainnet" | "devnet" | "testnet" | "unknown";

export function clusterOf(genesisHash: string): Cluster {
  if (genesisHash === MAINNET_GENESIS) return "mainnet";
  if (genesisHash === DEVNET_GENESIS) return "devnet";
  if (genesisHash === TESTNET_GENESIS) return "testnet";
  return "unknown";
}

/** What the operator asked for. Public keys are base58 strings. */
export interface PlanInputs {
  /** The multisig vault. Must equal the program's upgrade authority. */
  admin: string;
  mint: string;
  feeDestination: string;
  verifier: string;
  feeBps: number;
  /** In the mint's base units. */
  maxBounty: bigint;
  /** Permit an ordinary (on-curve) address as admin on mainnet. Off by default. */
  allowEoaAdmin: boolean;
}

/** What the chain says. Gathered by the script; passed in so this stays pure. */
export interface Facts {
  cluster: Cluster;
  programDeployed: boolean;
  /** null = the program is immutable (no upgrade authority). */
  upgradeAuthority: string | null;
  configExists: boolean;
  limitsExists: boolean;
  /** null = the mint account does not exist. */
  mint: {
    owner: string;
    decimals: number;
    freezeAuthority: string | null;
  } | null;
  feeDestinationTokenAccountExists: boolean;
  /** True for an ordinary keypair address; false for a PDA, e.g. a multisig vault. */
  adminIsOnCurve: boolean;
}

export type Severity = "pass" | "warn" | "fail";

export interface Check {
  severity: Severity;
  id: string;
  message: string;
}

const pass = (id: string, message: string): Check => ({ severity: "pass", id, message });
const warn = (id: string, message: string): Check => ({ severity: "warn", id, message });
const fail = (id: string, message: string): Check => ({ severity: "fail", id, message });

/**
 * Every judgement, in the order a person should read them.
 *
 * A "fail" blocks the plan. A "warn" is printed and must be read, but does not.
 * The distinction is deliberate: a warning that blocks gets bypassed by whoever is
 * in a hurry, and a failure that does not block is not a failure.
 */
export function evaluatePlan(inputs: PlanInputs, facts: Facts, programId: string): Check[] {
  const checks: Check[] = [];
  const onMainnet = facts.cluster === "mainnet";

  // ---- The program, and who may initialise it -------------------------------
  if (!facts.programDeployed) {
    checks.push(fail("PROGRAM_DEPLOYED", `No program is deployed at ${programId} on this cluster.`));
  } else {
    checks.push(pass("PROGRAM_DEPLOYED", `The program is deployed at ${programId}.`));
    if (facts.upgradeAuthority === null) {
      checks.push(
        fail(
          "UPGRADE_AUTHORITY_IS_ADMIN",
          "The program is IMMUTABLE. initialize_config only accepts the upgrade authority as signer, so it can never be initialised. Initialise first, then make it immutable."
        )
      );
    } else if (facts.upgradeAuthority !== inputs.admin) {
      checks.push(
        fail(
          "UPGRADE_AUTHORITY_IS_ADMIN",
          `initialize_config requires the SIGNER to be the upgrade authority, so the admin must equal it.\n    upgrade authority: ${facts.upgradeAuthority}\n    admin you passed : ${inputs.admin}\n    Hand the upgrade authority to the admin first (docs/mainnet-checklist.md, Phase 3).`
        )
      );
    } else {
      checks.push(pass("UPGRADE_AUTHORITY_IS_ADMIN", "The admin is the program's upgrade authority."));
    }
  }

  // ---- Nothing is initialised yet -------------------------------------------
  checks.push(
    facts.configExists
      ? fail("CONFIG_NOT_INITIALISED", "A Config already exists. initialize_config runs exactly once.")
      : pass("CONFIG_NOT_INITIALISED", "No Config exists yet.")
  );
  checks.push(
    facts.limitsExists
      ? fail("LIMITS_NOT_INITIALISED", "A Limits account already exists. initialize_limits runs exactly once.")
      : pass("LIMITS_NOT_INITIALISED", "No Limits account exists yet.")
  );

  // ---- No unset keys ---------------------------------------------------------
  for (const [name, key] of [
    ["admin", inputs.admin],
    ["mint", inputs.mint],
    ["fee destination", inputs.feeDestination],
    ["verifier", inputs.verifier],
  ] as const) {
    if (key === DEFAULT_PUBKEY) {
      checks.push(fail("NO_ZERO_KEYS", `The ${name} is the all-zero key. That is an unset field, not an account.`));
    }
  }

  // ---- The mint: permanent, and the cap is denominated in it ----------------
  if (facts.mint === null) {
    checks.push(fail("MINT_EXISTS", `The mint ${inputs.mint} does not exist on this cluster.`));
  } else {
    checks.push(pass("MINT_EXISTS", "The mint exists."));
    checks.push(
      facts.mint.owner === TOKEN_PROGRAM
        ? pass("MINT_OWNER", "The mint belongs to the classic SPL Token program.")
        : fail(
            "MINT_OWNER",
            `The mint is owned by ${facts.mint.owner}, not the classic Token program. The program types the mint against the classic program only.`
          )
    );
    checks.push(
      facts.mint.decimals === 6
        ? pass("MINT_DECIMALS", "The mint has 6 decimals.")
        : fail(
            "MINT_DECIMALS",
            `The mint has ${facts.mint.decimals} decimals. The bounty cap is stated in base units and every figure in this project assumes 6.`
          )
    );
    if (facts.mint.freezeAuthority !== null) {
      checks.push(
        warn(
          "MINT_FREEZABLE",
          `This mint has a freeze authority (${facts.mint.freezeAuthority}). A frozen fee account makes every approval revert; set_fee_destination exists for that case, and the fee wallet should be kept clean.`
        )
      );
    }
  }
  if (onMainnet && inputs.mint !== MAINNET_USDC) {
    checks.push(
      fail(
        "MAINNET_MINT_IS_USDC",
        `On mainnet the mint must be Circle's USDC (${MAINNET_USDC}). You passed ${inputs.mint}. The mint can never be changed after initialisation.`
      )
    );
  } else if (onMainnet) {
    checks.push(pass("MAINNET_MINT_IS_USDC", "The mint is mainnet USDC."));
  }

  // ---- Numbers ---------------------------------------------------------------
  checks.push(
    Number.isInteger(inputs.feeBps) && inputs.feeBps >= 0 && inputs.feeBps <= MAX_FEE_BPS
      ? pass("FEE_BPS", `Fee is ${inputs.feeBps / 100}% (ceiling ${MAX_FEE_BPS / 100}%, and it cannot be changed afterwards).`)
      : fail("FEE_BPS", `Fee ${inputs.feeBps} bps is outside 0..${MAX_FEE_BPS}.`)
  );
  checks.push(
    inputs.maxBounty > 0n && inputs.maxBounty <= ABSOLUTE_MAX_BOUNTY
      ? pass("MAX_BOUNTY", `Launch cap ${Number(inputs.maxBounty) / 1e6} USDC (hard ceiling ${Number(ABSOLUTE_MAX_BOUNTY) / 1e6}).`)
      : fail(
          "MAX_BOUNTY",
          `Launch cap ${inputs.maxBounty} is outside 1..${ABSOLUTE_MAX_BOUNTY} base units.`
        )
  );

  // ---- Separation of duties ---------------------------------------------------
  checks.push(
    inputs.verifier === inputs.admin
      ? fail("VERIFIER_IS_NOT_ADMIN", "The verifier is the admin. The verifier is a hot server key; the admin must not be.")
      : pass("VERIFIER_IS_NOT_ADMIN", "The verifier is a different key from the admin.")
  );
  if (inputs.verifier === inputs.feeDestination) {
    checks.push(warn("VERIFIER_IS_NOT_FEE_WALLET", "The verifier is also the fee destination: revenue accumulating on a hot key."));
  }
  if (inputs.admin === inputs.feeDestination) {
    checks.push(warn("ADMIN_IS_NOT_FEE_WALLET", "The admin is also the fee destination. That is the devnet default and is worth a second look on mainnet."));
  }

  // ---- The admin is permanent, so say what it looks like ---------------------
  if (facts.adminIsOnCurve) {
    const text =
      "The admin is an ordinary keypair address, not a program-derived multisig vault. There is NO admin rotation: this key is the admin forever, and it can re-point the verifier at itself.";
    checks.push(
      onMainnet && !inputs.allowEoaAdmin
        ? fail("ADMIN_LOOKS_LIKE_A_MULTISIG", `${text} Pass --allow-eoa-admin only if that is a deliberate decision.`)
        : warn("ADMIN_LOOKS_LIKE_A_MULTISIG", text)
    );
  } else {
    checks.push(pass("ADMIN_LOOKS_LIKE_A_MULTISIG", "The admin is off-curve, as a multisig vault PDA is. (A heuristic, not proof: check it against the multisig's own UI.)"));
  }

  // ---- The fee account the verifier will rely on ------------------------------
  if (!facts.feeDestinationTokenAccountExists) {
    checks.push(
      warn(
        "FEE_ACCOUNT_EXISTS",
        "The fee destination has no token account for this mint yet. The verifier creates a missing one in the same transaction as a verdict, but create it first so the first approval does not pay for it."
      )
    );
  } else {
    checks.push(pass("FEE_ACCOUNT_EXISTS", "The fee destination's token account exists."));
  }

  return checks;
}

/** A plan may proceed only if nothing failed. Warnings do not block. */
export function isBlocked(checks: Check[]): boolean {
  return checks.some((c) => c.severity === "fail");
}

/**
 * A short fingerprint of EVERYTHING the plan will make permanent, plus the cluster.
 *
 * The planner prints the full summary and this fingerprint on its first run, and
 * only prints instructions when it is re-run with `--confirm <fingerprint>`. That
 * makes the second run impossible without having first run - and read - the
 * first: the operator has to carry the fingerprint across by hand. It is not a
 * security boundary, it is a speed bump placed exactly where haste is expensive.
 *
 * Any change to any input - one digit of the cap, one character of an address, a
 * different cluster - changes it.
 */
export function fingerprint(inputs: PlanInputs, programId: string, genesisHash: string): string {
  const canonical = [
    "rubric-init-plan/v1",
    genesisHash,
    programId,
    inputs.admin,
    inputs.mint,
    inputs.feeDestination,
    inputs.verifier,
    String(inputs.feeBps),
    inputs.maxBounty.toString(),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
