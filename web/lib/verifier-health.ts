/**
 * Is the verifier able to settle a verdict, and for how long?
 *
 * THE FAILURE THIS EXISTS FOR
 * ---------------------------
 * The verifier is an ordinary wallet that pays the fee on every `submit_verdict`.
 * When it runs dry nothing about the judge is wrong - the judge rules, the
 * transaction cannot be paid for, and the task comes back held. To the poster and
 * the worker that is indistinguishable from "the AI could not decide", so an
 * operational problem is experienced as a quality problem, and nobody is told.
 *
 * Two things fix that: finding out BEFORE it happens (this module, behind a URL a
 * monitor can poll), and refusing to start a judge run that cannot be settled (the
 * preflight in /api/tasks/[id]/verify).
 *
 * THE NUMBERS ARE NOT GUESSES
 * ---------------------------
 * A system account may not be left holding less than the rent-exempt minimum for
 * zero bytes of data (650,240 lamports at today's rent) unless it is emptied
 * completely. So "empty" does not mean zero: it means "cannot pay a fee and stay
 * above the floor". The balance that matters is the SPENDABLE part above it.
 *
 *   typical verdict     one signature                          5,000 lamports
 *   worst-case verdict  one signature + RECREATING all three
 *                       token accounts (worker, creator, fee)  5,000 + 3 x 1,488,440
 *
 * The worst case is not hypothetical. The program requires all three token
 * accounts to exist on every verdict, two of them owned by the parties to the
 * task, and the verifier recreates any that were closed in the same transaction -
 * which an attacker can force for about 0.0015 SOL a task (docs/security-review.md,
 * R-04). Rent is read from the chain, never hard-coded: it is per-cluster and has
 * changed.
 *
 * Pure: the caller gathers the facts. Nothing here touches a key or the network.
 */

export const LAMPORTS_PER_SIGNATURE = 5_000;
const LAMPORTS_PER_SOL = 1_000_000_000;

/** Warn below 0.05 SOL: about 10,000 typical verdicts, or ~33 under attack. */
export const DEFAULT_WARN_LAMPORTS = 50_000_000;

export type HealthLevel =
  | "ok"
  | "low"
  | "critical"
  | "empty"
  | "mismatch"
  | "misconfigured"
  | "unreadable";

export interface HealthInputs {
  balanceLamports: number;
  /** getMinimumBalanceForRentExemption(0): what a system account must keep. */
  rentFloorLamports: number;
  /** getMinimumBalanceForRentExemption(165): one token account. */
  tokenAccountRentLamports: number;
  warnLamports: number;
  /** Whether any configured key is the one the chain trusts. */
  signerMatchesChain: boolean;
  /** Why VERIFIER_SECRET_KEY_NEXT is unusable, if it is set and unusable. */
  nextKeyError: string | null;
}

export interface HealthReport {
  level: HealthLevel;
  /** True only at "ok". A monitor should alert on everything else. */
  ok: boolean;
  /** Whether a verdict can be sent right now. False at empty, critical, mismatch. */
  canSettle: boolean;
  balanceLamports: number;
  /** What can actually be spent: the balance above the rent floor. */
  spendableLamports: number;
  typicalVerdictLamports: number;
  worstCaseVerdictLamports: number;
  typicalVerdictsRemaining: number;
  worstCaseVerdictsRemaining: number;
  warnLamports: number;
  rentFloorLamports: number;
  /** One sentence for a human. Public keys only, never secret material. */
  message: string;
  /** Extra problems that do not change the level, e.g. a bad NEXT key. */
  problems: string[];
}

export const formatSol = (lamports: number): string =>
  (lamports / LAMPORTS_PER_SOL).toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0");

/** The cost of the worst verdict: a fee, plus recreating all three token accounts. */
export const worstCaseVerdictLamports = (tokenAccountRentLamports: number): number =>
  LAMPORTS_PER_SIGNATURE + 3 * tokenAccountRentLamports;

/**
 * Classify the verifier's state.
 *
 * PRECEDENCE, most serious first, because a wallet that is both mismatched and
 * empty should be told about the thing that cannot be fixed by topping it up:
 * mismatch, empty, critical, misconfigured, low, ok.
 */
export function evaluateVerifierHealth(input: HealthInputs): HealthReport {
  const spendable = Math.max(0, input.balanceLamports - input.rentFloorLamports);
  const worstCase = worstCaseVerdictLamports(input.tokenAccountRentLamports);
  const typicalRemaining = Math.floor(spendable / LAMPORTS_PER_SIGNATURE);
  const worstRemaining = Math.floor(spendable / worstCase);
  const problems = input.nextKeyError ? [input.nextKeyError] : [];

  let level: HealthLevel;
  let message: string;
  if (!input.signerMatchesChain) {
    level = "mismatch";
    message =
      "No key this server holds is the verifier the program trusts, so no verdict it signs will be accepted. Topping up does not fix this: correct the environment variable or run set_verifier_authority.";
  } else if (spendable < LAMPORTS_PER_SIGNATURE) {
    level = "empty";
    message = `The verifier cannot pay a fee: ${formatSol(input.balanceLamports)} SOL, of which ${formatSol(input.rentFloorLamports)} must stay as the rent floor. Every task will fail to settle until it is funded.`;
  } else if (spendable < worstCase) {
    level = "critical";
    message = `${formatSol(input.balanceLamports)} SOL: enough for about ${typicalRemaining.toLocaleString("en-US")} typical verdicts but not for one worst-case verdict (${formatSol(worstCase)} SOL). Fund it now; judging is paused until then.`;
  } else if (input.nextKeyError) {
    level = "misconfigured";
    message = `The current key works, but ${input.nextKeyError} A rotation planned around that key would fail.`;
  } else if (input.balanceLamports < input.warnLamports) {
    level = "low";
    message = `${formatSol(input.balanceLamports)} SOL is below the ${formatSol(input.warnLamports)} SOL warning line: about ${typicalRemaining.toLocaleString("en-US")} typical verdicts, or ${worstRemaining.toLocaleString("en-US")} if an attacker forces token-account recreation. Top it up.`;
  } else {
    level = "ok";
    message = `${formatSol(input.balanceLamports)} SOL: about ${typicalRemaining.toLocaleString("en-US")} typical verdicts, ${worstRemaining.toLocaleString("en-US")} worst-case.`;
  }

  return {
    level,
    ok: level === "ok",
    canSettle: input.signerMatchesChain && level !== "empty" && level !== "critical",
    balanceLamports: input.balanceLamports,
    spendableLamports: spendable,
    typicalVerdictLamports: LAMPORTS_PER_SIGNATURE,
    worstCaseVerdictLamports: worstCase,
    typicalVerdictsRemaining: typicalRemaining,
    worstCaseVerdictsRemaining: worstRemaining,
    warnLamports: input.warnLamports,
    rentFloorLamports: input.rentFloorLamports,
    message,
    problems,
  };
}

/** The chain could not be read, so nothing can be said about the balance. Fail loudly. */
export function unreadableReport(reason: string): HealthReport {
  return {
    level: "unreadable",
    ok: false,
    canSettle: false,
    balanceLamports: 0,
    spendableLamports: 0,
    typicalVerdictLamports: LAMPORTS_PER_SIGNATURE,
    worstCaseVerdictLamports: 0,
    typicalVerdictsRemaining: 0,
    worstCaseVerdictsRemaining: 0,
    warnLamports: 0,
    rentFloorLamports: 0,
    message: `The verifier's state could not be read from the chain (${reason}). Treating it as unhealthy rather than guessing.`,
    problems: [],
  };
}

/** Required configuration is missing or unusable, so there is no key to check at all. */
export function misconfiguredReport(problem: string): HealthReport {
  return {
    ...unreadableReport(problem),
    level: "misconfigured",
    message: problem,
    problems: [problem],
  };
}

/** A monitor alerts on a non-2xx, so only a fully healthy verifier returns 200. */
export const statusFor = (report: HealthReport): 200 | 503 => (report.ok ? 200 : 503);

/**
 * Parse VERIFIER_MIN_SOL_WARN (a decimal number of SOL) into lamports, falling back
 * to the default. A typo must not silently disable the warning, so anything that is
 * not a positive finite number is ignored in favour of the default.
 */
export function warnLamportsFromEnv(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_WARN_LAMPORTS;
  const sol = Number(value);
  if (!Number.isFinite(sol) || sol <= 0) return DEFAULT_WARN_LAMPORTS;
  return Math.round(sol * LAMPORTS_PER_SOL);
}
