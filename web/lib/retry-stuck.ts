/**
 * The decisions behind scripts/retry-stuck.ts, kept pure so they can be tested.
 *
 * The script re-runs the judge on tasks that were never decided (lib/stuck-tasks.ts
 * picks them). Every attempt spends judge quota and up to five minutes, and the
 * usual reason one fails is that the verifier wallet is empty - in which case the
 * next fifty will fail the same way. So the loop is built to stop, not to push on:
 *
 *   - one task at a time, never in parallel;
 *   - a cap on how many it will judge in one run;
 *   - a circuit breaker that stops after a few failures in a row, and at once when
 *     the server says the verifier cannot settle anything;
 *   - a pause between attempts.
 *
 * Nothing here touches the network, the database or the clock. The script injects
 * all three.
 */

import { MIN_AGE_FLOOR_MS } from "./stuck-tasks";

// --- Arguments -------------------------------------------------------------------

export interface RetryArgs {
  /** Origin of the deployment to ask, e.g. https://rubric.example. No default. */
  baseUrl: string;
  /** False (the default) lists what would be retried and does nothing else. */
  run: boolean;
  /** Minimum age in ms, as requested. stuck-tasks raises it to its own floor. */
  olderThanMs: number;
  /** Most tasks judged in one run. */
  limit: number;
  /** Pause between judged tasks. */
  delayMs: number;
  /** Consecutive failures that stop the run. */
  maxFailures: number;
}

export const DEFAULTS = {
  olderThanMinutes: 5,
  limit: 5,
  delaySeconds: 5,
  maxFailures: 2,
} as const;

export const BOUNDS = {
  limit: { min: 1, max: 50 },
  delaySeconds: { min: 0, max: 300 },
  maxFailures: { min: 1, max: 10 },
} as const;

export type ParseResult = { ok: true; value: RetryArgs } | { ok: false; error: string };

const VALUE_FLAGS = new Set(["base-url", "older-than", "limit", "delay", "max-failures"]);
const BOOLEAN_FLAGS = new Set(["run"]);

/** An origin we will send judge requests to. Plain http only for the local machine. */
function parseBaseUrl(raw: string): { ok: true; origin: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: `--base-url is not a valid URL: ${raw}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "--base-url must start with https:// (or http:// for localhost)." };
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !local) {
    return { ok: false, error: "--base-url must be https:// unless it is localhost." };
  }
  return { ok: true, origin: url.origin };
}

function wholeNumber(name: string, raw: string, min: number, max: number): number | string {
  if (!/^\d+$/.test(raw)) return `--${name} must be a whole number, got "${raw}".`;
  const n = Number(raw);
  if (n < min || n > max) return `--${name} must be between ${min} and ${max}, got ${n}.`;
  return n;
}

/**
 * Strict on purpose. An unknown flag is an error rather than ignored, because a
 * mistyped --limt silently falling back to the default is how a script spends more
 * than its operator meant it to.
 */
export function parseRetryArgs(argv: string[]): ParseResult {
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
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, error: `--${name} needs a value.` };
      }
      values.set(name, value);
      i++;
    } else {
      return { ok: false, error: `Unknown option --${name}.` };
    }
  }

  const baseUrlRaw = values.get("base-url");
  if (!baseUrlRaw) {
    return {
      ok: false,
      error:
        "Missing --base-url. There is no default: it decides which deployment " +
        "(and so which verifier wallet) is asked to judge.",
    };
  }
  const base = parseBaseUrl(baseUrlRaw);
  if (!base.ok) return base;

  const olderThan = values.get("older-than");
  let olderThanMinutes: number = DEFAULTS.olderThanMinutes;
  if (olderThan !== undefined) {
    // Whole minutes only: "0.5" is exactly the kind of value that gets typed hoping
    // for "half a minute", and the floor would then silently make it a minute.
    const n = wholeNumber("older-than", olderThan, 0, 7 * 24 * 60);
    if (typeof n === "string") return { ok: false, error: n };
    olderThanMinutes = n;
  }

  const limit = values.has("limit")
    ? wholeNumber("limit", values.get("limit")!, BOUNDS.limit.min, BOUNDS.limit.max)
    : DEFAULTS.limit;
  if (typeof limit === "string") return { ok: false, error: limit };

  const delay = values.has("delay")
    ? wholeNumber("delay", values.get("delay")!, BOUNDS.delaySeconds.min, BOUNDS.delaySeconds.max)
    : DEFAULTS.delaySeconds;
  if (typeof delay === "string") return { ok: false, error: delay };

  const maxFailures = values.has("max-failures")
    ? wholeNumber("max-failures", values.get("max-failures")!, BOUNDS.maxFailures.min, BOUNDS.maxFailures.max)
    : DEFAULTS.maxFailures;
  if (typeof maxFailures === "string") return { ok: false, error: maxFailures };

  return {
    ok: true,
    value: {
      baseUrl: base.origin,
      run: flags.has("run"),
      olderThanMs: olderThanMinutes * 60_000,
      limit,
      delayMs: delay * 1000,
      maxFailures,
    },
  };
}

/** What --older-than actually means once the floor is applied. */
export const effectiveMinAgeMs = (requestedMs: number): number =>
  Math.max(requestedMs, MIN_AGE_FLOOR_MS);

// --- One attempt -----------------------------------------------------------------

export type AttemptResult =
  /** The route returned a decision: approved, rejected, or held by the judge. */
  | { kind: "decided"; outcome: string }
  /** Nothing to do (already decided, not found, not judgeable). Costs nothing. */
  | { kind: "skipped"; reason: string }
  /**
   * The server cannot judge ANYTHING right now, so the rest would fail the same way:
   * either the verifier cannot settle (empty wallet, untrusted key), or the judge
   * cannot be asked (out of quota, down).
   */
  | { kind: "unavailable"; subject: "verifier" | "judge"; level: string }
  /** Anything else that went wrong: a 5xx, a timeout, no network. */
  | { kind: "failed"; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/**
 * Read the verify route's response. Only fixed words and the route's own error
 * codes come back out of here, never a raw body, so nothing the server said can be
 * echoed into an operator's terminal or log by accident.
 */
export function classifyResponse(status: number, body: unknown): AttemptResult {
  const code = isRecord(body) && typeof body.code === "string" ? body.code : null;

  if (status === 200) {
    const outcome = isRecord(body) && typeof body.outcome === "string" ? body.outcome : "decided";
    return { kind: "decided", outcome };
  }
  if (status === 404) return { kind: "skipped", reason: "not found" };
  if (status === 409) return { kind: "skipped", reason: "already decided or not judgeable" };
  if (status === 503 && code === "VERIFIER_UNAVAILABLE") {
    const level = isRecord(body) && typeof body.level === "string" ? body.level : "unknown";
    return { kind: "unavailable", subject: "verifier", level };
  }
  if (status === 503 && code === "JUDGE_UNAVAILABLE") {
    return { kind: "unavailable", subject: "judge", level: "unavailable" };
  }
  if (status === 502 && code === "SETTLEMENT_FAILED") {
    return { kind: "failed", reason: "settlement did not land" };
  }
  return { kind: "failed", reason: `HTTP ${status}` };
}

/** A fetch that threw. Names only: the message can carry the URL and its query. */
export function classifyThrown(error: unknown): AttemptResult {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return { kind: "failed", reason: "timed out" };
  }
  return { kind: "failed", reason: "network error" };
}

// --- The loop --------------------------------------------------------------------

export type StopReason =
  /** Every candidate was attempted. */
  | "done"
  /** The per-run cap on judged tasks was reached. */
  | "limit"
  /** The server said the verifier cannot settle: nothing else would work either. */
  | "unavailable"
  /** Too many failures in a row. */
  | "too-many-failures";

export interface RunOptions {
  limit: number;
  maxFailures: number;
  delayMs: number;
}

export interface RunDeps<T> {
  attempt: (item: T) => Promise<AttemptResult>;
  sleep: (ms: number) => Promise<void>;
  /** Called after each attempt, for progress output. */
  onResult?: (item: T, result: AttemptResult) => void;
}

export interface RunSummary<T> {
  results: Array<{ item: T; result: AttemptResult }>;
  stoppedBecause: StopReason;
  /** Candidates never reached because the run stopped first. */
  notAttempted: number;
}

/**
 * Judge the items one at a time, in the order given.
 *
 * "Skipped" results cost nothing, so they do not count toward the limit, do not
 * trigger the pause, and reset the failure streak: a task someone else just decided
 * says nothing about the health of the verifier.
 */
export async function runRetries<T>(
  items: T[],
  options: RunOptions,
  deps: RunDeps<T>
): Promise<RunSummary<T>> {
  const results: Array<{ item: T; result: AttemptResult }> = [];
  let judged = 0;
  let failuresInARow = 0;

  for (let i = 0; i < items.length; i++) {
    if (judged >= options.limit) {
      return { results, stoppedBecause: "limit", notAttempted: items.length - i };
    }

    const item = items[i];
    let result: AttemptResult;
    try {
      result = await deps.attempt(item);
    } catch (error) {
      result = classifyThrown(error);
    }
    results.push({ item, result });
    deps.onResult?.(item, result);

    if (result.kind === "unavailable") {
      return { results, stoppedBecause: "unavailable", notAttempted: items.length - i - 1 };
    }

    if (result.kind === "skipped") {
      failuresInARow = 0;
      continue;
    }

    judged++;
    if (result.kind === "failed") {
      failuresInARow++;
      if (failuresInARow >= options.maxFailures) {
        return { results, stoppedBecause: "too-many-failures", notAttempted: items.length - i - 1 };
      }
    } else {
      failuresInARow = 0;
    }

    if (i < items.length - 1 && judged < options.limit && options.delayMs > 0) {
      await deps.sleep(options.delayMs);
    }
  }

  return { results, stoppedBecause: "done", notAttempted: 0 };
}

// --- Display ---------------------------------------------------------------------

/** "7m", "3h 20m", "2d 4h": how long a task has waited. */
export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
