import { describe, it, expect } from "vitest";
import {
  DEFAULT_BUDGET_MS,
  DEFAULT_QUOTA_MAX_WAIT_MS,
  backoffMs,
  classifyError,
  fallbackModelFromEnv,
  resilienceConfigFromEnv,
  retryHintMs,
  runWithFallback,
  type JudgeRoute,
  type ResilienceConfig,
  type RouteResponse,
} from "./judge-resilience";

const CONFIG: ResilienceConfig = {
  attemptsPerRoute: 3,
  budgetMs: 200_000,
  attemptTimeoutMs: 45_000,
  baseBackoffMs: 750,
  maxBackoffMs: 8_000,
  quotaMaxWaitMs: 6_000,
};

/** A fake clock: sleeping advances it, and so does a slow ask. */
function clock(random: () => number = () => 0.5) {
  let t = 0;
  const sleeps: number[] = [];
  return {
    deps: {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
      random,
    },
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
    time: () => t,
  };
}

type Step = RouteResponse<string> | Error | { takes: number; then: RouteResponse<string> | Error };

/** A route that plays back its steps, one per ask, repeating the last. */
function route(label: string, steps: Step[], advance?: (ms: number) => void): JudgeRoute<string> & { calls: () => number } {
  let n = 0;
  return {
    label,
    calls: () => n,
    ask: async () => {
      let step = steps[Math.min(n++, steps.length - 1)];
      if (typeof step === "object" && step !== null && "takes" in step) {
        advance?.(step.takes);
        step = step.then;
      }
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

const ok = (value = "ruling"): RouteResponse<string> => ({ kind: "ok", value });
const unusable = (reason = "not json"): RouteResponse<string> => ({ kind: "unusable", reason });
const refused: RouteResponse<string> = { kind: "refused" };
const quota = (hint = "") => Object.assign(new Error(`429 RESOURCE_EXHAUSTED ${hint}`), { status: 429 });
const network = () => new TypeError("fetch failed");

describe("classifyError", () => {
  it("recognises quota by status, by code and by name", () => {
    expect(classifyError(Object.assign(new Error("x"), { status: 429 })).cause).toBe("quota");
    expect(classifyError(new Error("RESOURCE_EXHAUSTED: quota")).cause).toBe("quota");
    expect(classifyError(Object.assign(new Error("slow down"), { name: "RateLimitError" })).cause).toBe("quota");
    expect(classifyError(new Error("You exceeded your current quota")).cause).toBe("quota");
  });

  it("reads the wait the API asked for, in ms and in s, or null", () => {
    expect(classifyError(quota("Please retry in 145.486818ms")).retryAfterMs).toBeCloseTo(145.49, 1);
    expect(classifyError(quota("Please retry in 2s")).retryAfterMs).toBe(2000);
    expect(classifyError(quota()).retryAfterMs).toBeNull();
  });

  it("retryHintMs ignores text that is not a hint", () => {
    expect(retryHintMs("nothing here")).toBeNull();
    expect(retryHintMs("retry in abc s")).toBeNull();
  });

  it("does not mistake an unrelated number for a 429", () => {
    expect(classifyError(new Error("request 14290 failed")).cause).toBe("unreachable");
  });

  it("does NOT call the SDK's consumed-body transport error a quota problem", () => {
    // It shows up whether or not the API is rate limited. Calling it quota skipped the
    // retry that would have revealed the real cause.
    const e = new Error("Unexpected HTTP client error: TypeError: unusable");
    expect(classifyError(e).cause).toBe("unreachable");
  });

  it("recognises a timeout", () => {
    expect(classifyError(new Error("The judge did not respond within 45000ms.")).cause).toBe("timeout");
    expect(classifyError(Object.assign(new Error("x"), { name: "AbortError" })).cause).toBe("timeout");
    expect(classifyError(new Error("connect ETIMEDOUT 1.2.3.4:443")).cause).toBe("timeout");
  });

  it("anything else is unreachable, and odd thrown values never throw", () => {
    expect(classifyError(new Error("socket hang up")).cause).toBe("unreachable");
    for (const v of ["a string", undefined, null, 42, {}]) {
      expect(classifyError(v).cause).toBe("unreachable");
    }
  });
});

describe("backoffMs", () => {
  it("doubles with each attempt and stops at the cap", () => {
    const at = (attempt: number) => backoffMs(attempt, CONFIG, () => 1 - Number.EPSILON);
    expect(at(0)).toBe(750);
    expect(at(1)).toBe(1500);
    expect(at(2)).toBe(3000);
    expect(at(3)).toBe(6000);
    expect(at(4)).toBe(8000);
    expect(at(10)).toBe(8000);
  });

  it("jitters between half the cap and the cap", () => {
    expect(backoffMs(2, CONFIG, () => 0)).toBe(1500);
    expect(backoffMs(2, CONFIG, () => 0.5)).toBe(2250);
    for (const r of [0, 0.1, 0.5, 0.9, 0.999]) {
      const v = backoffMs(3, CONFIG, () => r);
      expect(v).toBeGreaterThanOrEqual(3000);
      expect(v).toBeLessThanOrEqual(6000);
    }
  });
});

describe("runWithFallback", () => {
  it("returns the first answer and asks nothing else", async () => {
    const c = clock();
    const a = route("a", [ok()]);
    const b = route("b", [ok("other")]);
    const out = await runWithFallback([a, b], CONFIG, c.deps);
    expect(out).toEqual({ kind: "answered", value: "ruling", routeIndex: 0 });
    expect(b.calls()).toBe(0);
    expect(c.sleeps).toEqual([]);
  });

  it("an answer is never second-guessed: the fallback is only for a FAILURE to answer", async () => {
    // The judge-shopping rule. At this level an answer is an `ok`, and the caller
    // (not this function) decides whether it is confident enough to settle. Whatever
    // that decision is, no other route may have been asked.
    const c = clock();
    const primary = route("primary", [ok("low confidence, but an answer")]);
    const fallback = route("fallback", [ok("would have agreed")]);
    await runWithFallback([primary, fallback], CONFIG, c.deps);
    expect(fallback.calls()).toBe(0);
  });

  it("a refusal is an answer: it is returned, not retried, and not fallen back from", async () => {
    const c = clock();
    const primary = route("primary", [refused]);
    const fallback = route("fallback", [ok()]);
    const out = await runWithFallback([primary, fallback], CONFIG, c.deps);
    expect(out).toEqual({ kind: "refused", routeIndex: 0 });
    expect(primary.calls()).toBe(1);
    expect(fallback.calls()).toBe(0);
  });

  it("retries an unusable response and accepts a good second one", async () => {
    const c = clock();
    const out = await runWithFallback([route("a", [unusable(), ok()])], CONFIG, c.deps);
    expect(out.kind).toBe("answered");
    expect(c.sleeps).toHaveLength(1);
  });

  it("backs off between transient failures, longer each time", async () => {
    const c = clock(() => 0);
    const a = route("a", [network(), network(), ok()]);
    const out = await runWithFallback([a], CONFIG, c.deps);
    expect(out.kind).toBe("answered");
    expect(a.calls()).toBe(3);
    expect(c.sleeps).toHaveLength(2);
    expect(c.sleeps[1]).toBeGreaterThan(c.sleeps[0]);
  });

  it("does not sleep after the last attempt on a route", async () => {
    const c = clock();
    await runWithFallback([route("a", [network()])], CONFIG, c.deps);
    // 3 attempts, so 2 waits between them and none after the third.
    expect(c.sleeps).toHaveLength(2);
  });

  it("moves to the fallback after the primary exhausts its attempts", async () => {
    const c = clock();
    const a = route("a", [network()]);
    const b = route("b", [ok("from the fallback")]);
    const out = await runWithFallback([a, b], CONFIG, c.deps);
    expect(out).toEqual({ kind: "answered", value: "from the fallback", routeIndex: 1 });
    expect(a.calls()).toBe(3);
  });

  it("quota with no stated wait is not retried on the same route: straight to the next", async () => {
    const c = clock();
    const a = route("a", [quota()]);
    const b = route("b", [ok()]);
    const out = await runWithFallback([a, b], CONFIG, c.deps);
    expect(out).toMatchObject({ kind: "answered", routeIndex: 1 });
    expect(a.calls()).toBe(1);
    expect(c.sleeps).toEqual([]);
  });

  it("quota with a SHORT stated wait is waited out on the same route", async () => {
    const c = clock();
    const a = route("a", [quota("Please retry in 145ms"), ok()]);
    const out = await runWithFallback([a, route("b", [ok("no")])], CONFIG, c.deps);
    expect(out).toMatchObject({ kind: "answered", routeIndex: 0 });
    expect(c.sleeps).toEqual([245]); // 145ms, plus 100ms of margin
  });

  it("quota with a LONG stated wait is a real quota problem: no waiting, next route", async () => {
    const c = clock();
    const a = route("a", [quota("Please retry in 30s")]);
    const b = route("b", [ok()]);
    const out = await runWithFallback([a, b], CONFIG, c.deps);
    expect(out).toMatchObject({ kind: "answered", routeIndex: 1 });
    expect(c.sleeps).toEqual([]);
  });

  it("a short rate limit on the LAST attempt is not waited out: there is no attempt left to use it", async () => {
    const c = clock();
    const a = route("a", [network(), network(), quota("Please retry in 100ms")]);
    await runWithFallback([a], CONFIG, c.deps);
    expect(a.calls()).toBe(3);
    expect(c.sleeps.every((s) => s !== 200)).toBe(true);
  });

  it("with no route answering, reports unavailable with the most recent infrastructure cause", async () => {
    const c = clock();
    const out = await runWithFallback([route("a", [network()]), route("b", [quota()])], CONFIG, c.deps);
    expect(out).toMatchObject({ kind: "unavailable", cause: "quota", routesTried: [0, 1], budgetExhausted: false });
  });

  it("prefers an infrastructure cause over 'unusable': an outage is ours, not the work's", async () => {
    const c = clock();
    const out = await runWithFallback([route("a", [quota()]), route("b", [unusable("bad json")])], CONFIG, c.deps);
    expect(out).toMatchObject({ kind: "unavailable", cause: "quota", lastUnusableReason: "bad json" });
  });

  it("only if EVERY failure was unusable output is the cause 'unusable'", async () => {
    const c = clock();
    const out = await runWithFallback([route("a", [unusable("bad json")])], CONFIG, c.deps);
    expect(out).toMatchObject({ kind: "unavailable", cause: "unusable", lastUnusableReason: "bad json" });
  });

  it("no routes is unavailable, and asks nothing", async () => {
    const out = await runWithFallback([], CONFIG, clock().deps);
    expect(out).toMatchObject({ kind: "unavailable", routesTried: [] });
  });

  it("stops when the time budget cannot fit another attempt, and says so", async () => {
    const c = clock();
    const slow = (label: string) => route(label, [{ takes: 45_000, then: network() }], c.advance);
    const out = await runWithFallback(
      [slow("a"), slow("b")],
      { ...CONFIG, budgetMs: 100_000 },
      c.deps
    );
    expect(out).toMatchObject({ kind: "unavailable", budgetExhausted: true });
    expect(c.time()).toBeLessThanOrEqual(100_000);
  });

  it("a rate-limit wait is counted against the budget too: it is not taken if the attempt after it would not fit", async () => {
    // 45 s used, then the API asks for 5 s. Another attempt could take 45 s more, so
    // waiting and retrying could end at ~95 s, past a 91 s budget. It must give up.
    const c = clock();
    const a = route(
      "a",
      [
        { takes: 45_000, then: quota("Please retry in 5s") },
        { takes: 45_000, then: ok() },
      ],
      c.advance
    );
    const out = await runWithFallback([a], { ...CONFIG, budgetMs: 91_000 }, c.deps);
    expect(out.kind).toBe("unavailable");
    expect(c.sleeps).toEqual([]);
    expect(c.time()).toBeLessThanOrEqual(91_000);
  });

  it("never lets a run exceed its budget, whatever fails and however slowly (property)", async () => {
    // A seeded generator so a failure is reproducible.
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

    for (let run = 0; run < 300; run++) {
      const c = clock(rand);
      const cfg: ResilienceConfig = {
        ...CONFIG,
        attemptsPerRoute: 1 + Math.floor(rand() * 4),
        budgetMs: 20_000 + Math.floor(rand() * 200_000),
        attemptTimeoutMs: 5_000 + Math.floor(rand() * 40_000),
      };
      const makeSteps = (): Step[] =>
        Array.from({ length: 1 + Math.floor(rand() * 5) }, () => ({
          takes: Math.floor(rand() * cfg.attemptTimeoutMs),
          then: pick<RouteResponse<string> | Error>([
            network(),
            quota(),
            quota("Please retry in 300ms"),
            quota("Please retry in 20s"),
            unusable(),
            new Error("The judge did not respond within 45000ms."),
          ]),
        }));
      const routes = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => route(`r${i}`, makeSteps(), c.advance));
      await runWithFallback(routes, cfg, c.deps);
      expect(c.time(), `run ${run}`).toBeLessThanOrEqual(cfg.budgetMs);
    }
  });

  it("reports progress without putting anything but labels and causes in it", async () => {
    const c = clock();
    const events: string[] = [];
    await runWithFallback(
      [route("gemini:gemini-2.5-flash", [quota()])],
      CONFIG,
      { ...c.deps, onEvent: (m) => events.push(m) }
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.join("\n")).toContain("gemini:gemini-2.5-flash");
    expect(events.join("\n")).not.toMatch(/RESOURCE_EXHAUSTED/);
  });

  it("asks one route at a time", async () => {
    const c = clock();
    let inFlight = 0;
    let peak = 0;
    const mk = (label: string): JudgeRoute<string> => ({
      label,
      ask: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight--;
        throw network();
      },
    });
    await runWithFallback([mk("a"), mk("b")], CONFIG, c.deps);
    expect(peak).toBe(1);
  });
});

describe("configuration from the environment", () => {
  it("uses sensible defaults", () => {
    const cfg = resilienceConfigFromEnv({}, 45_000);
    expect(cfg.budgetMs).toBe(DEFAULT_BUDGET_MS);
    expect(cfg.quotaMaxWaitMs).toBe(DEFAULT_QUOTA_MAX_WAIT_MS);
    expect(cfg.attemptTimeoutMs).toBe(45_000);
    expect(cfg.attemptsPerRoute).toBe(3);
  });

  it("the default budget leaves room inside the verify route's 300 s cap", () => {
    expect(DEFAULT_BUDGET_MS).toBeLessThanOrEqual(240_000);
  });

  it("takes valid overrides", () => {
    const cfg = resilienceConfigFromEnv({ JUDGE_TOTAL_BUDGET_MS: "90000", JUDGE_QUOTA_RETRY_MAX_WAIT_MS: "2000" }, 30_000);
    expect(cfg.budgetMs).toBe(90_000);
    expect(cfg.quotaMaxWaitMs).toBe(2000);
  });

  it("a typo never turns a limit off: bad values fall back to the default", () => {
    for (const bad of ["", "  ", "abc", "-5", "0", "NaN", "Infinity"]) {
      expect(resilienceConfigFromEnv({ JUDGE_TOTAL_BUDGET_MS: bad }, 45_000).budgetMs, bad).toBe(DEFAULT_BUDGET_MS);
    }
  });

  it("there is no fallback unless one is configured", () => {
    expect(fallbackModelFromEnv({}, "gemini-2.5-flash")).toBeNull();
    expect(fallbackModelFromEnv({ JUDGE_FALLBACK_MODEL: "" }, "gemini-2.5-flash")).toBeNull();
    expect(fallbackModelFromEnv({ JUDGE_FALLBACK_MODEL: "   " }, "gemini-2.5-flash")).toBeNull();
  });

  it("a fallback that is the primary is not a fallback", () => {
    expect(fallbackModelFromEnv({ JUDGE_FALLBACK_MODEL: "gemini-2.5-flash" }, "gemini-2.5-flash")).toBeNull();
  });

  it("returns a distinct fallback, trimmed", () => {
    expect(fallbackModelFromEnv({ JUDGE_FALLBACK_MODEL: " gemini-3.1-flash-lite " }, "gemini-2.5-flash")).toBe(
      "gemini-3.1-flash-lite"
    );
  });
});
