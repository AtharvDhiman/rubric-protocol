import { describe, it, expect, vi } from "vitest";
import {
  BOUNDS,
  DEFAULTS,
  classifyResponse,
  classifyThrown,
  effectiveMinAgeMs,
  formatAge,
  parseRetryArgs,
  runRetries,
  type AttemptResult,
  type RetryArgs,
} from "./retry-stuck";
import { MIN_AGE_FLOOR_MS } from "./stuck-tasks";

const parse = (...argv: string[]) => parseRetryArgs(argv);
const okArgs = (...argv: string[]): RetryArgs => {
  const r = parse(...argv);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
};
const errOf = (...argv: string[]): string => {
  const r = parse(...argv);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("parseRetryArgs", () => {
  it("needs a base URL, and says why there is no default", () => {
    expect(errOf()).toMatch(/--base-url/);
    expect(errOf("--run")).toMatch(/--base-url/);
    expect(errOf()).toMatch(/no default/);
  });

  it("is a dry run unless --run is given", () => {
    expect(okArgs("--base-url", "https://rubric.example").run).toBe(false);
    expect(okArgs("--base-url", "https://rubric.example", "--run").run).toBe(true);
  });

  it("applies the documented defaults", () => {
    const a = okArgs("--base-url", "https://rubric.example");
    expect(a.olderThanMs).toBe(DEFAULTS.olderThanMinutes * 60_000);
    expect(a.limit).toBe(DEFAULTS.limit);
    expect(a.delayMs).toBe(DEFAULTS.delaySeconds * 1000);
    expect(a.maxFailures).toBe(DEFAULTS.maxFailures);
  });

  it("reduces the base URL to its origin, so a path or trailing slash cannot misdirect a request", () => {
    expect(okArgs("--base-url", "https://rubric.example/").baseUrl).toBe("https://rubric.example");
    expect(okArgs("--base-url", "https://rubric.example/some/page?x=1").baseUrl).toBe("https://rubric.example");
  });

  it("allows plain http only for the local machine", () => {
    expect(okArgs("--base-url", "http://localhost:3000").baseUrl).toBe("http://localhost:3000");
    expect(okArgs("--base-url", "http://127.0.0.1:3000").baseUrl).toBe("http://127.0.0.1:3000");
    expect(errOf("--base-url", "http://rubric.example")).toMatch(/https/);
  });

  it("rejects things that are not web URLs", () => {
    expect(errOf("--base-url", "not a url")).toMatch(/valid URL/);
    expect(errOf("--base-url", "ftp://rubric.example")).toMatch(/https/);
    expect(errOf("--base-url", "javascript:alert(1)")).toMatch(/https/);
  });

  it("rejects an unknown option instead of silently using a default", () => {
    // The point of strictness: a typo'd --limt must not quietly mean --limit 5.
    expect(errOf("--base-url", "https://rubric.example", "--limt", "1")).toMatch(/Unknown option --limt/);
  });

  it("rejects a stray positional argument", () => {
    expect(errOf("--base-url", "https://rubric.example", "oops")).toMatch(/Unexpected argument/);
  });

  it("rejects a value flag with no value, or whose value is the next flag", () => {
    expect(errOf("--base-url")).toMatch(/needs a value/);
    expect(errOf("--base-url", "https://rubric.example", "--limit")).toMatch(/needs a value/);
    expect(errOf("--base-url", "https://rubric.example", "--limit", "--run")).toMatch(/needs a value/);
  });

  it("takes whole numbers only, within bounds", () => {
    const base = ["--base-url", "https://rubric.example"];
    expect(okArgs(...base, "--limit", "1").limit).toBe(BOUNDS.limit.min);
    expect(okArgs(...base, "--limit", "50").limit).toBe(BOUNDS.limit.max);
    expect(errOf(...base, "--limit", "0")).toMatch(/between/);
    expect(errOf(...base, "--limit", "51")).toMatch(/between/);
    expect(errOf(...base, "--limit", "-3")).toMatch(/whole number/);
    expect(errOf(...base, "--limit", "2.5")).toMatch(/whole number/);
    expect(errOf(...base, "--limit", "1e3")).toMatch(/whole number/);
    expect(errOf(...base, "--limit", "")).toMatch(/whole number|needs a value/);
    expect(errOf(...base, "--limit", "many")).toMatch(/whole number/);
  });

  it("converts minutes and seconds to milliseconds", () => {
    const a = okArgs("--base-url", "https://rubric.example", "--older-than", "20", "--delay", "12");
    expect(a.olderThanMs).toBe(20 * 60_000);
    expect(a.delayMs).toBe(12_000);
  });

  it("refuses a fractional --older-than rather than letting the floor quietly change it", () => {
    expect(errOf("--base-url", "https://rubric.example", "--older-than", "0.5")).toMatch(/whole number/);
  });

  it("accepts --older-than 0 and --delay 0, which the floor and the breaker still bound", () => {
    const a = okArgs("--base-url", "https://rubric.example", "--older-than", "0", "--delay", "0");
    expect(a.olderThanMs).toBe(0);
    expect(a.delayMs).toBe(0);
  });

  it("bounds --max-failures", () => {
    const base = ["--base-url", "https://rubric.example"];
    expect(errOf(...base, "--max-failures", "0")).toMatch(/between/);
    expect(okArgs(...base, "--max-failures", "10").maxFailures).toBe(10);
    expect(errOf(...base, "--max-failures", "11")).toMatch(/between/);
  });
});

describe("effectiveMinAgeMs", () => {
  it("never goes below the floor in stuck-tasks", () => {
    expect(effectiveMinAgeMs(0)).toBe(MIN_AGE_FLOOR_MS);
    expect(effectiveMinAgeMs(MIN_AGE_FLOOR_MS - 1)).toBe(MIN_AGE_FLOOR_MS);
    expect(effectiveMinAgeMs(20 * 60_000)).toBe(20 * 60_000);
  });
});

describe("classifyResponse", () => {
  it("a 200 is a decision, whatever it was, and carries the outcome word", () => {
    expect(classifyResponse(200, { outcome: "approved" })).toEqual({ kind: "decided", outcome: "approved" });
    expect(classifyResponse(200, { outcome: "needs_manual_review" })).toEqual({
      kind: "decided",
      outcome: "needs_manual_review",
    });
    expect(classifyResponse(200, null)).toEqual({ kind: "decided", outcome: "decided" });
  });

  it("404 and 409 are skips: someone else got there first, or it cannot be judged", () => {
    expect(classifyResponse(404, {}).kind).toBe("skipped");
    expect(classifyResponse(409, { error: "This task has already been decided." }).kind).toBe("skipped");
  });

  it("a refusal because the verifier cannot settle is its own thing, with the level", () => {
    expect(classifyResponse(503, { code: "VERIFIER_UNAVAILABLE", level: "empty" })).toEqual({
      kind: "unavailable",
      subject: "verifier",
      level: "empty",
    });
    expect(classifyResponse(503, { code: "VERIFIER_UNAVAILABLE" })).toEqual({
      kind: "unavailable",
      subject: "verifier",
      level: "unknown",
    });
  });

  it("a refusal because the JUDGE cannot be asked is unavailable too, and not mistaken for the verifier", () => {
    // Out of quota or down: every other task would fail the same way, so stop at once.
    expect(classifyResponse(503, { code: "JUDGE_UNAVAILABLE", error: "x" })).toEqual({
      kind: "unavailable",
      subject: "judge",
      level: "unavailable",
    });
  });

  it("a plain 503 (e.g. the chain could not be read) is a failure, not 'the verifier is empty'", () => {
    expect(classifyResponse(503, { error: "Could not read the task from the chain." })).toEqual({
      kind: "failed",
      reason: "HTTP 503",
    });
  });

  it("a failed settlement is a failure", () => {
    expect(classifyResponse(502, { code: "SETTLEMENT_FAILED" })).toEqual({
      kind: "failed",
      reason: "settlement did not land",
    });
  });

  it("anything unexpected is a failure that names only the status", () => {
    expect(classifyResponse(500, "<html>boom</html>")).toEqual({ kind: "failed", reason: "HTTP 500" });
    expect(classifyResponse(418, undefined)).toEqual({ kind: "failed", reason: "HTTP 418" });
  });

  it("never echoes a response body into its result", () => {
    const secret = "postgres://user:hunter2@host/db";
    const r = classifyResponse(500, { error: secret, code: secret, level: secret });
    expect(JSON.stringify(r)).not.toContain("hunter2");
  });
});

describe("classifyThrown", () => {
  it("names a timeout", () => {
    const e = new Error("signal timed out");
    e.name = "TimeoutError";
    expect(classifyThrown(e)).toEqual({ kind: "failed", reason: "timed out" });
    const a = new Error("aborted");
    a.name = "AbortError";
    expect(classifyThrown(a)).toEqual({ kind: "failed", reason: "timed out" });
  });

  it("anything else is a network error, and the message, which can hold the URL, is dropped", () => {
    const r = classifyThrown(new TypeError("fetch failed: https://rubric.example/api?key=SECRET"));
    expect(r).toEqual({ kind: "failed", reason: "network error" });
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(classifyThrown("a string")).toEqual({ kind: "failed", reason: "network error" });
  });
});

describe("runRetries", () => {
  const opts = { limit: 5, maxFailures: 2, delayMs: 1000 };
  const decided: AttemptResult = { kind: "decided", outcome: "approved" };
  const failed: AttemptResult = { kind: "failed", reason: "HTTP 500" };
  const skipped: AttemptResult = { kind: "skipped", reason: "already decided or not judgeable" };
  const unavailable: AttemptResult = { kind: "unavailable", subject: "verifier", level: "empty" };

  /** Attempts return the scripted results in order. */
  const scripted = (results: AttemptResult[]) => {
    const queue = [...results];
    return {
      attempt: vi.fn(async () => {
        const next = queue.shift();
        if (!next) throw new Error("attempted more items than scripted");
        return next;
      }),
      sleep: vi.fn(async () => {}),
    };
  };

  it("judges every item, in order, when all goes well", async () => {
    const deps = scripted([decided, decided, decided]);
    const out = await runRetries(["a", "b", "c"], opts, deps);
    expect(deps.attempt.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["a", "b", "c"]);
    expect(out.stoppedBecause).toBe("done");
    expect(out.notAttempted).toBe(0);
    expect(out.results).toHaveLength(3);
  });

  it("does nothing for nothing", async () => {
    const deps = scripted([]);
    const out = await runRetries([], opts, deps);
    expect(out).toEqual({ results: [], stoppedBecause: "done", notAttempted: 0 });
    expect(deps.attempt).not.toHaveBeenCalled();
  });

  it("stops at once when the verifier cannot settle: the rest would fail the same way", async () => {
    const deps = scripted([unavailable]);
    const out = await runRetries(["a", "b", "c", "d"], opts, deps);
    expect(out.stoppedBecause).toBe("unavailable");
    expect(out.notAttempted).toBe(3);
    expect(deps.attempt).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured failures IN A ROW", async () => {
    const deps = scripted([failed, failed]);
    const out = await runRetries(["a", "b", "c", "d"], opts, deps);
    expect(out.stoppedBecause).toBe("too-many-failures");
    expect(out.notAttempted).toBe(2);
    expect(deps.attempt).toHaveBeenCalledTimes(2);
  });

  it("a success in between resets the streak, so scattered failures do not trip it", async () => {
    const deps = scripted([failed, decided, failed, decided]);
    const out = await runRetries(["a", "b", "c", "d"], opts, deps);
    expect(out.stoppedBecause).toBe("done");
  });

  it("a skip also resets the streak: another run deciding a task says nothing about the verifier", async () => {
    const deps = scripted([failed, skipped, failed, decided]);
    const out = await runRetries(["a", "b", "c", "d"], opts, deps);
    expect(out.stoppedBecause).toBe("done");
  });

  it("a thrown error counts as a failure rather than crashing the run", async () => {
    const deps = {
      attempt: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
      sleep: vi.fn(async () => {}),
    };
    const out = await runRetries(["a", "b", "c"], opts, deps);
    expect(out.stoppedBecause).toBe("too-many-failures");
    expect(out.results.map((r) => r.result)).toEqual([
      { kind: "failed", reason: "network error" },
      { kind: "failed", reason: "network error" },
    ]);
  });

  it("stops at the per-run limit and says how many were left", async () => {
    const deps = scripted([decided, decided]);
    const out = await runRetries(["a", "b", "c", "d", "e"], { ...opts, limit: 2 }, deps);
    expect(out.stoppedBecause).toBe("limit");
    expect(out.notAttempted).toBe(3);
    expect(deps.attempt).toHaveBeenCalledTimes(2);
  });

  it("failures count toward the limit too: a failed attempt still spent quota", async () => {
    const deps = scripted([failed, decided, failed]);
    const out = await runRetries(["a", "b", "c", "d"], { ...opts, limit: 3, maxFailures: 5 }, deps);
    expect(out.stoppedBecause).toBe("limit");
    expect(deps.attempt).toHaveBeenCalledTimes(3);
  });

  it("skips cost nothing: they do not use up the limit", async () => {
    const deps = scripted([skipped, skipped, decided, decided]);
    const out = await runRetries(["a", "b", "c", "d", "e"], { ...opts, limit: 2 }, deps);
    expect(deps.attempt).toHaveBeenCalledTimes(4);
    expect(out.stoppedBecause).toBe("limit");
    expect(out.notAttempted).toBe(1);
  });

  it("pauses between judged tasks, but not after a skip, not after the last, and not before stopping", async () => {
    const deps = scripted([decided, skipped, decided, decided]);
    await runRetries(["a", "b", "c", "d"], { ...opts, limit: 5 }, deps);
    // After a, c. Not after b (a skip) and not after d (the last).
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledWith(1000);

    const capped = scripted([decided, decided]);
    await runRetries(["a", "b", "c"], { ...opts, limit: 2 }, capped);
    // Pauses after a, but not after b: the cap is reached, so there is nothing to wait for.
    expect(capped.sleep).toHaveBeenCalledTimes(1);
  });

  it("does not pause at all when the delay is zero", async () => {
    const deps = scripted([decided, decided]);
    await runRetries(["a", "b"], { ...opts, delayMs: 0 }, deps);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it("reports each result as it happens", async () => {
    const seen: Array<[string, string]> = [];
    const deps = { ...scripted([decided, failed]), onResult: (item: string, r: AttemptResult) => seen.push([item, r.kind]) };
    await runRetries(["a", "b"], opts, deps);
    expect(seen).toEqual([
      ["a", "decided"],
      ["b", "failed"],
    ]);
  });

  it("never attempts more than one item at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    const deps = {
      attempt: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight--;
        return decided;
      },
      sleep: async () => {},
    };
    await runRetries(["a", "b", "c", "d"], opts, deps);
    expect(peak).toBe(1);
  });
});

describe("formatAge", () => {
  it("reads at a glance", () => {
    expect(formatAge(0)).toBe("0m");
    expect(formatAge(7 * 60_000)).toBe("7m");
    expect(formatAge(3 * 3_600_000 + 20 * 60_000)).toBe("3h 20m");
    expect(formatAge(2 * 86_400_000 + 4 * 3_600_000)).toBe("2d 4h");
  });

  it("never goes negative when a clock is slightly ahead", () => {
    expect(formatAge(-5_000)).toBe("0m");
  });
});
