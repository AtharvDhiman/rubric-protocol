/**
 * The decisions behind scripts/admin-action-plan.ts, as pure functions.
 *
 * WHY THIS EXISTS
 * ---------------
 * On mainnet the admin is a multisig (docs/mainnet-checklist.md). Its four levers
 * - pause new tasks, change the bounty cap, change the fee destination, rotate the
 * verifier - are each ONE small instruction, and the people who must sign them are
 * not Rubric's developers and may be doing it at speed, during an incident. The
 * dangerous failure is not a bad idea, it is a plausible-looking proposal that is
 * wrong: signed by a key that is not the admin (it reverts), a no-op, or - the one
 * that hurts most - a rotation to a verifier wallet with no SOL, which would make
 * every task bounce the moment it lands.
 *
 * So a proposal is checked against the chain BEFORE it is handed to signers, and
 * the checks are tested like code. This module takes two plain objects, what was
 * asked and what the chain says, and returns judgements. It touches no key, file
 * or network, and the script around it signs nothing.
 *
 * The same "fail blocks, warn is read" rule as lib/init-plan.ts applies: a warning
 * that blocks gets bypassed by whoever is in a hurry, and a failure that does not
 * block is not a failure.
 */

import { createHash } from "node:crypto";
import { LAUNCH_MAX_BOUNTY_BASE_UNITS } from "./constants";
import {
  ABSOLUTE_MAX_BOUNTY,
  DEFAULT_PUBKEY,
  type Check,
  type Cluster,
} from "./init-plan";
import { DEFAULT_WARN_LAMPORTS, evaluateVerifierHealth, formatSol } from "./verifier-health";

// --- What can be asked ------------------------------------------------------------

export type AdminAction =
  | { kind: "pause" }
  | { kind: "unpause" }
  | { kind: "set-max-bounty"; maxBounty: bigint }
  | { kind: "set-fee-destination"; feeDestination: string }
  | { kind: "set-verifier"; verifier: string };

export type AdminActionKind = AdminAction["kind"];

/**
 * Which on-chain instruction each action is, by IDL name and by Anchor method name,
 * and which accounts it takes. The pause and cap instructions touch `limits`; the
 * other two touch only `config`. Kept here so the table is tested, not remembered.
 */
export const ADMIN_INSTRUCTIONS: Record<
  AdminActionKind,
  { idlName: string; method: string; accounts: readonly ("admin" | "config" | "limits")[] }
> = {
  pause: { idlName: "set_paused", method: "setPaused", accounts: ["admin", "config", "limits"] },
  unpause: { idlName: "set_paused", method: "setPaused", accounts: ["admin", "config", "limits"] },
  "set-max-bounty": {
    idlName: "set_max_bounty",
    method: "setMaxBounty",
    accounts: ["admin", "config", "limits"],
  },
  "set-fee-destination": {
    idlName: "set_fee_destination",
    method: "setFeeDestination",
    accounts: ["admin", "config"],
  },
  "set-verifier": {
    idlName: "set_verifier_authority",
    method: "setVerifierAuthority",
    accounts: ["admin", "config"],
  },
};

export interface AdminInputs {
  /** The multisig vault that will execute the instruction. */
  admin: string;
  action: AdminAction;
}

/** What the chain says. Gathered by the script and passed in, so this stays pure. */
export interface AdminFacts {
  cluster: Cluster;
  programDeployed: boolean;
  /** null = no Config account, i.e. the program was never initialised here. */
  config: { admin: string; verifierAuthority: string; feeDestination: string } | null;
  /** null = no Limits account. */
  limits: { maxBounty: bigint; paused: boolean } | null;
  /**
   * set-fee-destination only: whether the new destination already has a token
   * account for the bounty mint. null = not checked or could not be read.
   */
  feeDestinationTokenAccountExists: boolean | null;
  /**
   * set-verifier only: the proposed key's wallet. null = could not be read.
   * `isOnCurve` is false for a PDA, which can never sign a verdict.
   */
  verifierWallet: {
    balanceLamports: number;
    rentFloorLamports: number;
    tokenAccountRentLamports: number;
    isOnCurve: boolean;
  } | null;
}

const pass = (id: string, message: string): Check => ({ severity: "pass", id, message });
const warn = (id: string, message: string): Check => ({ severity: "warn", id, message });
const fail = (id: string, message: string): Check => ({ severity: "fail", id, message });

const usdc = (baseUnits: bigint): string => {
  const whole = baseUnits / 1_000_000n;
  const frac = (baseUnits % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
};

// --- The judgements ---------------------------------------------------------------

/**
 * Every judgement, in the order a person should read them. A "fail" blocks the plan.
 *
 * The common checks come first and the plan stops there if the program or its Config
 * is missing: nothing below them can be judged without a Config to compare against.
 */
export function evaluateAdminAction(
  inputs: AdminInputs,
  facts: AdminFacts,
  programId: string
): Check[] {
  const checks: Check[] = [];

  if (!facts.programDeployed) {
    checks.push(fail("PROGRAM_DEPLOYED", `No program is deployed at ${programId} on this cluster.`));
    return checks;
  }
  checks.push(pass("PROGRAM_DEPLOYED", `The program is deployed at ${programId}.`));

  if (!facts.config) {
    checks.push(
      fail("CONFIG_EXISTS", "The program has no Config on this cluster, so it was never initialised and has no admin.")
    );
    return checks;
  }
  checks.push(pass("CONFIG_EXISTS", "The program is initialised."));

  // The one that matters most: every one of these instructions is `has_one = admin`.
  // A proposal signed by anyone else reverts with NotAdmin after the signers have
  // already spent their time on it.
  if (facts.config.admin !== inputs.admin) {
    checks.push(
      fail(
        "SIGNER_IS_ADMIN",
        `Only the admin may do this, and the admin you passed is not it.\n    Config.admin     : ${facts.config.admin}\n    admin you passed : ${inputs.admin}`
      )
    );
  } else {
    checks.push(pass("SIGNER_IS_ADMIN", "The admin you passed is the admin recorded on-chain."));
  }

  if (facts.cluster === "mainnet") {
    checks.push(pass("CLUSTER", "This is mainnet-beta. The change is real and takes effect for the next transaction."));
  } else if (facts.cluster === "unknown") {
    checks.push(warn("CLUSTER", "This cluster's genesis hash is not mainnet, devnet or testnet. Check --rpc."));
  } else {
    checks.push(pass("CLUSTER", `This is ${facts.cluster}.`));
  }

  const action = inputs.action;
  switch (action.kind) {
    case "pause":
    case "unpause":
      checks.push(...pauseChecks(action.kind, facts));
      break;
    case "set-max-bounty":
      checks.push(...capChecks(action.maxBounty, facts));
      break;
    case "set-fee-destination":
      checks.push(...feeDestinationChecks(action.feeDestination, inputs.admin, facts));
      break;
    case "set-verifier":
      checks.push(...verifierChecks(action.verifier, facts));
      break;
  }
  return checks;
}

function limitsMissing(): Check {
  return fail(
    "LIMITS_EXIST",
    "The Limits account does not exist yet, so there is nothing to change. Run initialize_limits first (scripts/mainnet-init-plan.ts)."
  );
}

function pauseChecks(kind: "pause" | "unpause", facts: AdminFacts): Check[] {
  if (!facts.limits) return [limitsMissing()];
  const checks: Check[] = [pass("LIMITS_EXIST", "The Limits account exists.")];

  const wantPaused = kind === "pause";
  if (facts.limits.paused === wantPaused) {
    checks.push(
      warn(
        "CHANGES_SOMETHING",
        wantPaused
          ? "New tasks are ALREADY paused. This proposal changes nothing."
          : "New tasks are ALREADY open. This proposal changes nothing."
      )
    );
  } else {
    checks.push(
      pass("CHANGES_SOMETHING", wantPaused ? "New tasks are open now; this will pause them." : "New tasks are paused now; this will reopen them.")
    );
  }

  checks.push(
    wantPaused
      ? pass(
          "NO_MONEY_TRAPPED",
          "Pausing stops only create_task. Tasks already in escrow still settle, refund and can be reclaimed."
        )
      : pass("NO_MONEY_TRAPPED", "Unpausing changes only create_task; nothing already in escrow is affected.")
  );
  return checks;
}

function capChecks(maxBounty: bigint, facts: AdminFacts): Check[] {
  if (!facts.limits) return [limitsMissing()];
  const checks: Check[] = [pass("LIMITS_EXIST", "The Limits account exists.")];

  // The program enforces the same bounds, so this is a courtesy that fails the
  // proposal before the signers see it rather than after they have signed.
  if (maxBounty <= 0n || maxBounty > ABSOLUTE_MAX_BOUNTY) {
    checks.push(
      fail(
        "CAP_IN_RANGE",
        `The program only accepts a cap above 0 and up to ${usdc(ABSOLUTE_MAX_BOUNTY)} USDC (a ceiling compiled into it). You asked for ${usdc(maxBounty)}.`
      )
    );
    return checks;
  }
  checks.push(pass("CAP_IN_RANGE", `${usdc(maxBounty)} USDC is within what the program accepts.`));

  const current = facts.limits.maxBounty;
  if (maxBounty === current) {
    checks.push(warn("CHANGES_SOMETHING", `The cap is ALREADY ${usdc(current)} USDC. This proposal changes nothing.`));
  } else if (maxBounty > current) {
    const aboveLaunch = maxBounty > BigInt(LAUNCH_MAX_BOUNTY_BASE_UNITS);
    checks.push(
      warn(
        "CAP_RAISED",
        `This RAISES the cap from ${usdc(current)} to ${usdc(maxBounty)} USDC. Every approval rests on one AI judge and one verifier key, ` +
          `so a larger cap is a larger prize for anyone who can fool or steal either.` +
          (aboveLaunch ? ` It is also above the ${usdc(BigInt(LAUNCH_MAX_BOUNTY_BASE_UNITS))} USDC launch value. Read docs/security-review.md before raising it.` : "")
      )
    );
  } else {
    checks.push(
      pass(
        "CAP_LOWERED",
        `This lowers the cap from ${usdc(current)} to ${usdc(maxBounty)} USDC. Tasks that already exist keep the bounty they were sealed with.`
      )
    );
  }
  return checks;
}

function feeDestinationChecks(destination: string, admin: string, facts: AdminFacts): Check[] {
  const checks: Check[] = [];

  if (destination === DEFAULT_PUBKEY) {
    checks.push(
      fail(
        "DESTINATION_VALID",
        "That is the all-zero key. It is what an unset field looks like, no one controls it, and fees sent to it are gone."
      )
    );
    return checks;
  }
  checks.push(pass("DESTINATION_VALID", "The destination is not the all-zero key."));

  const current = facts.config?.feeDestination;
  if (current === destination) {
    checks.push(warn("CHANGES_SOMETHING", "That is ALREADY the fee destination. This proposal changes nothing."));
  } else {
    checks.push(pass("CHANGES_SOMETHING", `The fee destination changes from ${current} to ${destination}.`));
  }

  if (destination === admin) {
    checks.push(
      warn(
        "DESTINATION_IS_ADMIN",
        "The fee destination is the admin multisig itself. It works, but it keeps revenue in the same account that can pause the protocol and swap the verifier."
      )
    );
  }

  if (facts.feeDestinationTokenAccountExists === true) {
    checks.push(pass("FEE_ACCOUNT_EXISTS", "The new destination already has a token account for the bounty mint."));
  } else if (facts.feeDestinationTokenAccountExists === false) {
    checks.push(
      warn(
        "FEE_ACCOUNT_EXISTS",
        "The new destination has no token account for the bounty mint yet. The verifier creates it inside the first approved verdict and pays the rent (about 0.0015 SOL), so confirm the verifier wallet can afford it."
      )
    );
  } else {
    checks.push(warn("FEE_ACCOUNT_EXISTS", "Could not check whether the new destination has a token account."));
  }

  checks.push(
    pass(
      "EFFECT",
      "Takes effect for verdicts that land AFTER this. A task already settled keeps the fee it paid, and no escrow is touched."
    )
  );
  return checks;
}

function verifierChecks(verifier: string, facts: AdminFacts): Check[] {
  const checks: Check[] = [];

  // set_verifier_authority accepts ANY key, including the all-zero one, and the
  // program would take it. That would stop every verdict until the admin fixed it.
  if (verifier === DEFAULT_PUBKEY) {
    checks.push(fail("VERIFIER_VALID", "That is the all-zero key. No one can sign as it, so no verdict could ever be accepted."));
    return checks;
  }
  checks.push(pass("VERIFIER_VALID", "The new verifier is not the all-zero key."));

  const wallet = facts.verifierWallet;
  if (!wallet) {
    checks.push(
      fail(
        "VERIFIER_FUNDED",
        "Could not read the new verifier's wallet, so it cannot be shown that it can pay for a verdict. Retry, or check --rpc."
      )
    );
    return checks;
  }

  // A verifier signs transactions, so it must be a real keypair. A PDA has no
  // private key, and rotating to one would lock out every verdict.
  if (!wallet.isOnCurve) {
    checks.push(
      fail("VERIFIER_IS_KEYPAIR", "That address is not on the ed25519 curve (a PDA?). It has no private key and can never sign a verdict.")
    );
    return checks;
  }
  checks.push(pass("VERIFIER_IS_KEYPAIR", "The new verifier is an ordinary keypair address."));

  if (facts.config?.verifierAuthority === verifier) {
    checks.push(warn("CHANGES_SOMETHING", "That is ALREADY the verifier. This proposal changes nothing."));
  } else {
    checks.push(pass("CHANGES_SOMETHING", `The verifier changes from ${facts.config?.verifierAuthority} to ${verifier}.`));
  }

  // The failure this whole planner exists to prevent: rotating to a key that cannot
  // pay. The same thresholds the health check uses, so "healthy" means one thing.
  const health = evaluateVerifierHealth({
    balanceLamports: wallet.balanceLamports,
    rentFloorLamports: wallet.rentFloorLamports,
    tokenAccountRentLamports: wallet.tokenAccountRentLamports,
    warnLamports: DEFAULT_WARN_LAMPORTS,
    signerMatchesChain: true,
    nextKeyError: null,
  });
  if (!health.canSettle) {
    checks.push(
      fail(
        "VERIFIER_FUNDED",
        `The new verifier cannot pay for verdicts (${formatSol(wallet.balanceLamports)} SOL). Rotating to it would make every task fail to settle the moment this lands. ${health.message}`
      )
    );
  } else if (health.level === "low") {
    checks.push(
      warn(
        "VERIFIER_FUNDED",
        `The new verifier can pay but is low: ${formatSol(wallet.balanceLamports)} SOL. ${health.message}`
      )
    );
  } else {
    checks.push(pass("VERIFIER_FUNDED", `The new verifier is funded: ${health.message}`));
  }
  return checks;
}

// --- What to tell the signers -----------------------------------------------------

export interface ActionBrief {
  title: string;
  /** What this does and, as importantly, what it does not. */
  effect: string[];
  /** Do these BEFORE the multisig executes. */
  before: string[];
  /** Do these AFTER it lands. */
  after: string[];
}

export function describeAction(action: AdminAction): ActionBrief {
  switch (action.kind) {
    case "pause":
      return {
        title: "PAUSE NEW TASKS",
        effect: [
          "create_task is refused for everyone, with ProtocolPaused.",
          "submit_work, submit_verdict and reclaim_expired do not read the pause flag: existing tasks settle, refund and can be reclaimed as normal.",
        ],
        before: [],
        after: [
          "Confirm it: GET /api/limits should report paused: true, and the create page should say new tasks are paused.",
          "Pausing buys time. It does not fix a compromised verifier: for that, rotate it (--set-verifier).",
        ],
      };
    case "unpause":
      return {
        title: "REOPEN NEW TASKS",
        effect: ["create_task is accepted again, up to the current cap."],
        before: ["Make sure whatever caused the pause is actually resolved. Check GET /api/health/verifier is healthy."],
        after: ["Confirm it: GET /api/limits should report paused: false."],
      };
    case "set-max-bounty":
      return {
        title: `SET THE BOUNTY CAP TO ${usdc(action.maxBounty)} USDC`,
        effect: [
          "create_task refuses any bounty above the new cap.",
          "Tasks that already exist are untouched, whatever their bounty.",
        ],
        before: [],
        after: ["Confirm it: GET /api/limits should report the new maxBounty."],
      };
    case "set-fee-destination":
      return {
        title: "CHANGE THE FEE DESTINATION",
        effect: [
          "Verdicts that land after this pay the protocol fee to the new wallet.",
          "No escrow is touched and no task changes.",
        ],
        before: [
          "Confirm the new wallet is one you control and that its USDC token account is not frozen. A frozen fee account makes every approval revert.",
        ],
        after: ["Settle or wait for one approval and confirm the fee arrived at the new wallet."],
      };
    case "set-verifier":
      return {
        title: "ROTATE THE VERIFIER KEY",
        effect: [
          "The program accepts verdicts signed ONLY by the new key from the next transaction on. The old key stops working immediately.",
          "No escrow is touched. A task being judged at that exact moment may fail to settle once; it is held as an operational hold (not a ruling on the work) and scripts/retry-stuck.ts picks it up.",
        ],
        before: [
          "Put the new key's secret on the server as VERIFIER_SECRET_KEY_NEXT and deploy it. The app signs with whichever configured key the chain trusts, so there is no window in which verdicts bounce.",
          "Check GET /api/health/verifier: it should report the NEXT key as readable.",
        ],
        after: [
          "Confirm GET /api/health/verifier is ok and its watched key is the new one.",
          "Then promote it: move the new secret into VERIFIER_SECRET_KEY, remove VERIFIER_SECRET_KEY_NEXT, and deploy. Retire the old key.",
          "If the old key was compromised, assume anything it signed is untrusted and review recent verdicts.",
        ],
      };
  }
}

// --- Fingerprint ------------------------------------------------------------------

/** The part of the action that varies, as text. Part of the fingerprint. */
export function actionParam(action: AdminAction): string {
  switch (action.kind) {
    case "pause":
    case "unpause":
      return "";
    case "set-max-bounty":
      return action.maxBounty.toString();
    case "set-fee-destination":
      return action.feeDestination;
    case "set-verifier":
      return action.verifier;
  }
}

/**
 * A short fingerprint of EVERYTHING the proposal will do, plus the cluster.
 *
 * The planner prints the full plan and this fingerprint on its first run, and only
 * prints the instruction when re-run with `--confirm <fingerprint>`, so the second
 * run is impossible without having read the first. A speed bump, not a security
 * boundary, placed where haste is expensive. Any change to the action, its value,
 * the admin or the cluster changes it.
 */
export function fingerprintAdmin(inputs: AdminInputs, programId: string, genesisHash: string): string {
  const canonical = [
    "rubric-admin-plan/v1",
    genesisHash,
    programId,
    inputs.admin,
    inputs.action.kind,
    actionParam(inputs.action),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

// --- Arguments --------------------------------------------------------------------

export interface AdminArgs {
  rpc: string | undefined;
  admin: string;
  action: AdminAction;
  confirm: string | undefined;
}

export type AdminParseResult = { ok: true; value: AdminArgs } | { ok: false; error: string };

const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ACTION_FLAGS = ["pause", "unpause", "set-max-bounty", "set-fee-destination", "set-verifier"] as const;
const VALUE_FLAGS = new Set(["rpc", "admin", "confirm", "set-max-bounty", "set-fee-destination", "set-verifier"]);
const BOOLEAN_FLAGS = new Set(["pause", "unpause"]);

/**
 * Strict on purpose, like lib/retry-stuck.ts: an unknown flag is an error, and
 * EXACTLY one action is required. "--pause --unpause" is a mistake, not a request.
 */
export function parseAdminArgs(argv: string[]): AdminParseResult {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) return { ok: false, error: `Unexpected argument "${token}".` };
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags.add(name);
    } else if (VALUE_FLAGS.has(name)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false, error: `--${name} needs a value.` };
      values.set(name, value);
      i++;
    } else {
      return { ok: false, error: `Unknown option --${name}.` };
    }
  }

  const admin = values.get("admin");
  if (!admin) {
    return { ok: false, error: "Missing --admin: the multisig vault that will execute this. There is no default." };
  }
  if (!BASE58_KEY.test(admin)) return { ok: false, error: `--admin is not a valid public key: ${admin}` };

  const chosen = ACTION_FLAGS.filter((f) => flags.has(f) || values.has(f));
  if (chosen.length === 0) {
    return { ok: false, error: `Say what to do: exactly one of ${ACTION_FLAGS.map((f) => `--${f}`).join(", ")}.` };
  }
  if (chosen.length > 1) {
    return { ok: false, error: `Exactly one action at a time, got ${chosen.map((f) => `--${f}`).join(" and ")}.` };
  }

  let action: AdminAction;
  switch (chosen[0]) {
    case "pause":
      action = { kind: "pause" };
      break;
    case "unpause":
      action = { kind: "unpause" };
      break;
    case "set-max-bounty": {
      const raw = values.get("set-max-bounty")!;
      // Whole USDC only: a cap is a policy number, and "0.5" or "1e3" are typos.
      if (!/^\d+$/.test(raw)) return { ok: false, error: `--set-max-bounty must be a whole number of USDC, got "${raw}".` };
      action = { kind: "set-max-bounty", maxBounty: BigInt(raw) * 1_000_000n };
      break;
    }
    case "set-fee-destination": {
      const raw = values.get("set-fee-destination")!;
      if (!BASE58_KEY.test(raw)) return { ok: false, error: `--set-fee-destination is not a valid public key: ${raw}` };
      action = { kind: "set-fee-destination", feeDestination: raw };
      break;
    }
    default: {
      const raw = values.get("set-verifier")!;
      if (!BASE58_KEY.test(raw)) return { ok: false, error: `--set-verifier is not a valid public key: ${raw}` };
      action = { kind: "set-verifier", verifier: raw };
    }
  }

  return { ok: true, value: { rpc: values.get("rpc"), admin, action, confirm: values.get("confirm") } };
}
