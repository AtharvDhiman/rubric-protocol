/**
 * Asking a judge that can be rate limited, slow or down, without ever turning that
 * into a decision about the work.
 *
 * WHY THIS IS NOT JUST A RETRY LOOP
 * ---------------------------------
 * Three different things can stop a judge answering, and they need three different
 * responses:
 *
 *   - It is RATE LIMITED for a moment ("retry in 145ms"). Wait that long, ask again.
 *   - It is OUT OF QUOTA, or unreachable, or slow. Waiting on the same route is
 *     pointless or expensive. Try the next route if there is one, otherwise stop.
 *   - It answered, but the answer is unusable (bad JSON, wrong shape). Ask again,
 *     briefly.
 *
 * And one thing must NEVER be treated as a failure to answer: a ruling. A judge that
 * rules "approve", "reject", or "I am not confident", or that REFUSES, has answered.
 * Asking a second model to see whether it would answer differently is judge-shopping:
 * it turns "the judge was unsure" into "keep asking until something agrees", and the
 * party who gains is whoever the second model happens to favour. So the next route is
 * reached ONLY from a failure to answer. This is structural - the loop below returns
 * the moment it has an answer or a refusal - and the tests mutation-check it.
 *
 * WHAT THIS DOES NOT DECIDE
 * -------------------------
 * It returns what happened. Whether a failure is a hold on the work or a hold on us
 * is the caller's call (lib/holds.ts): quota, timeout and unreachable are OUR
 * problem and are retried later; "unusable" is treated as needing a person.
 *
 * Pure in the sense that matters: the clock, the sleep and the randomness are
 * injected, so backoff and the time budget are tested without waiting.
 */

export type RouteResponse<T> =
  | { kind: "ok"; value: T }
  /** A safety refusal is a legitimate signal, not a failure. Never retried, never fallen back from. */
  | { kind: "refused" }
  | { kind: "unusable"; reason: string };

export interface JudgeRoute<T> {
  /** For logs: provider and model. Never contains a key. */
  label: string;
  ask: () => Promise<RouteResponse<T>>;
}

/** Why a route did not answer. */
export type FailureCause = "quota" | "timeout" | "unreachable" | "unusable";

export type ResilientResult<T> =
  | { kind: "answered"; value: T; routeIndex: number }
  | { kind: "refused"; routeIndex: number }
  | {
      kind: "unavailable";
      /** The most recent INFRASTRUCTURE cause if there was one, else "unusable". */
      cause: FailureCause;
      /** Indices of the routes that were actually asked. */
      routesTried: number[];
      /** True if the time budget, not the attempt limit, ended the run. */
      budgetExhausted: boolean;
      /** The last "unusable" reason a route gave, for the operator. */
      lastUnusableReason: string | null;
    };

export interface ResilienceConfig {
  /** Attempts on each route before moving on. */
  attemptsPerRoute: number;
  /** Total wall-clock time the whole run may take. */
  budgetMs: number;
  /** The longest one attempt can take (the caller's own per-call timeout). */
  attemptTimeoutMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** The longest we will wait out a rate limit the API says will clear soon. */
  quotaMaxWaitMs: number;
}

export interface ResilienceDeps {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** In [0, 1). */
  random: () => number;
  /** Optional progress line for the operator's logs. */
  onEvent?: (message: string) => void;
}

// --- Classifying a thrown error ------------------------------------------------------

export interface ErrorClass {
  cause: Exclude<FailureCause, "unusable">;
  /** How long the API itself asked us to wait, if it said. */
  retryAfterMs: number | null;
}

/**
 * How long the API asked us to wait, in ms, or null if it did not say.
 *
 * A 429 is not always "you are out of quota for the day". Gemini's free tier is a
 * rate, so a burst can be told to come back in a fraction of a second - the message
 * carries "Please retry in 145.486818ms". Giving up over a 145ms rate limit would be
 * absurd, so the number is worth reading rather than throwing away.
 */
export function retryHintMs(text: string): number | null {
  const match = text.match(/retry in\s+([\d.]+)\s*(ms|s)/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[2].toLowerCase() === "s" ? value * 1000 : value;
}

/**
 * Is this "you are out of quota", "too slow", or "could not be reached"?
 *
 * The distinction matters because retrying a quota error on the same route is
 * pointless - the second call fails for exactly the same reason - and the operator
 * needs to be told to top up the key rather than to go looking for a bug.
 */
export function classifyError(error: unknown): ErrorClass {
  const status = (error as { status?: number })?.status;
  const name = (error as { name?: string })?.name ?? "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const text = `${name} ${message}`;

  if (
    status === 429 ||
    /\b429\b|RESOURCE_EXHAUSTED|RateLimitError|exceeded your current quota/i.test(text)
  ) {
    return { cause: "quota", retryAfterMs: retryHintMs(text) };
  }
  if (/did not respond within|timed? ?out|ETIMEDOUT|AbortError|deadline/i.test(text)) {
    return { cause: "timeout", retryAfterMs: null };
  }
  // Deliberately NOT classified as quota: "Unexpected HTTP client error: TypeError:
  // unusable". The SDK emits that when it re-sends a request whose body stream was
  // already consumed, and it shows up both when rate limited and when not. Calling it
  // quota was wrong twice over: it reported a fixable transport error as "out of
  // quota", and it skipped the retry that would have revealed the real cause.
  return { cause: "unreachable", retryAfterMs: null };
}

/** Exponential backoff with jitter, between half the cap and the cap. */
export function backoffMs(
  attempt: number,
  config: Pick<ResilienceConfig, "baseBackoffMs" | "maxBackoffMs">,
  random: () => number
): number {
  const cap = Math.min(config.maxBackoffMs, config.baseBackoffMs * 2 ** attempt);
  return Math.round(cap / 2 + (random() * cap) / 2);
}

// --- The run ---------------------------------------------------------------------------

/**
 * Ask the routes in order, moving to the next ONLY when the current one fails to
 * answer. Returns on the first answer or refusal.
 *
 * Time: an attempt is started only if it could finish inside the budget, counting
 * its own worst-case duration, so the whole run ends within `budgetMs` provided each
 * ask honours its own timeout.
 */
export async function runWithFallback<T>(
  routes: JudgeRoute<T>[],
  config: ResilienceConfig,
  deps: ResilienceDeps
): Promise<ResilientResult<T>> {
  const start = deps.now();
  const elapsed = () => deps.now() - start;
  const canStart = (waitFirstMs = 0) => elapsed() + waitFirstMs + config.attemptTimeoutMs <= config.budgetMs;

  const failures: FailureCause[] = [];
  const tried: number[] = [];
  let budgetExhausted = false;
  let lastUnusableReason: string | null = null;

  routeLoop: for (let r = 0; r < routes.length; r++) {
    const route = routes[r];

    for (let attempt = 0; attempt < config.attemptsPerRoute; attempt++) {
      if (!canStart()) {
        budgetExhausted = true;
        break routeLoop;
      }
      if (attempt === 0) tried.push(r);
      const moreAttempts = attempt < config.attemptsPerRoute - 1;

      let response: RouteResponse<T>;
      try {
        response = await route.ask();
      } catch (error) {
        const c = classifyError(error);
        failures.push(c.cause);
        deps.onEvent?.(`${route.label} attempt ${attempt + 1} failed: ${c.cause}`);

        if (c.cause === "quota") {
          // A short, stated wait is a rate limit: wait it out and ask again. Anything
          // longer, or unstated, is a real quota problem on THIS route. Retrying it is
          // pointless, so go straight to the next one.
          const hint = c.retryAfterMs;
          if (hint !== null && hint <= config.quotaMaxWaitMs && moreAttempts && canStart(hint + 100)) {
            deps.onEvent?.(`${route.label} rate limited; waiting ${Math.round(hint)}ms as asked`);
            await deps.sleep(hint + 100);
            continue;
          }
          break;
        }

        // Timeout or unreachable: transient, so back off and try again.
        if (moreAttempts) {
          const wait = backoffMs(attempt, config, deps.random);
          if (canStart(wait)) {
            await deps.sleep(wait);
            continue;
          }
        }
        break;
      }

      if (response.kind === "ok") return { kind: "answered", value: response.value, routeIndex: r };
      // A refusal is an answer. Returning here, and not trying another route, is the
      // rule that keeps this from being judge-shopping.
      if (response.kind === "refused") return { kind: "refused", routeIndex: r };

      failures.push("unusable");
      lastUnusableReason = response.reason;
      deps.onEvent?.(`${route.label} attempt ${attempt + 1} gave an unusable response`);
      if (moreAttempts) {
        const wait = backoffMs(attempt, config, deps.random);
        if (canStart(wait)) {
          await deps.sleep(wait);
          continue;
        }
      }
      break;
    }
  }

  const infrastructure = [...failures].reverse().find((f) => f !== "unusable");
  return {
    kind: "unavailable",
    cause: infrastructure ?? (failures.length > 0 ? "unusable" : "timeout"),
    routesTried: tried,
    budgetExhausted,
    lastUnusableReason,
  };
}

// --- Configuration ---------------------------------------------------------------------

export const DEFAULT_ATTEMPTS_PER_ROUTE = 3;
export const DEFAULT_BUDGET_MS = 200_000;
export const DEFAULT_QUOTA_MAX_WAIT_MS = 6_000;

function positiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The configuration, from the environment. A value that is not a positive number is
 * ignored in favour of the default: a typo must not turn a limit off.
 *
 * The budget defaults to 200 s because the verify route is capped at 300 s and the
 * judge shares that with the chain reads and the settlement transaction.
 */
export function resilienceConfigFromEnv(
  env: Record<string, string | undefined>,
  attemptTimeoutMs: number
): ResilienceConfig {
  return {
    attemptsPerRoute: DEFAULT_ATTEMPTS_PER_ROUTE,
    budgetMs: positiveNumber(env.JUDGE_TOTAL_BUDGET_MS, DEFAULT_BUDGET_MS),
    attemptTimeoutMs,
    baseBackoffMs: 750,
    maxBackoffMs: 8_000,
    quotaMaxWaitMs: positiveNumber(env.JUDGE_QUOTA_RETRY_MAX_WAIT_MS, DEFAULT_QUOTA_MAX_WAIT_MS),
  };
}

/**
 * The model to fall back to, or null for none. Opt-in: with JUDGE_FALLBACK_MODEL
 * unset there is no fallback. It must differ from the primary, or it is not a
 * fallback and would only double the load on the same quota.
 */
export function fallbackModelFromEnv(
  env: Record<string, string | undefined>,
  primaryModel: string
): string | null {
  const raw = env.JUDGE_FALLBACK_MODEL?.trim();
  if (!raw || raw === primaryModel) return null;
  return raw;
}
