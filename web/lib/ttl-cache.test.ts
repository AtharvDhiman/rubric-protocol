import { describe, expect, it, vi } from "vitest";
import { singleFlightCache } from "./ttl-cache";

function setup(freshMs = 60_000, staleMs = 600_000) {
  let t = 1_000_000;
  const cache = singleFlightCache<string>({ freshMs, staleMs, now: () => t });
  return { cache, advance: (ms: number) => (t += ms), set: (ms: number) => (t = ms) };
}

/** A read that finishes when the test says so. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("freshness", () => {
  it("reads once, then serves the same value without reading again", async () => {
    const { cache, advance } = setup();
    const load = vi.fn(async () => "a");
    expect((await cache.get(load)).value).toBe("a");
    advance(59_999);
    const second = await cache.get(load);
    expect(second).toEqual({ value: "a", ageMs: 59_999, stale: false });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reads again once the value is exactly as old as freshMs", async () => {
    const { cache, advance } = setup();
    const load = vi.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b");
    await cache.get(load);
    advance(60_000);
    expect((await cache.get(load)).value).toBe("b");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a new reading starts at age zero", async () => {
    const { cache, advance } = setup();
    const load = vi.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b");
    await cache.get(load);
    advance(120_000);
    expect(await cache.get(load)).toEqual({ value: "b", ageMs: 0, stale: false });
  });

  it("a clock that steps backwards never makes a value look younger, or negative", async () => {
    const { cache, set } = setup();
    const load = vi.fn(async () => "a");
    await cache.get(load);
    set(500_000);
    const result = await cache.get(load);
    expect(result.ageMs).toBe(0);
    expect(result.stale).toBe(false);
  });
});

describe("single flight", () => {
  it("concurrent callers share one read", async () => {
    const { cache } = setup();
    const gate = deferred<string>();
    const load = vi.fn(() => gate.promise);
    const callers = [cache.get(load), cache.get(load), cache.get(load)];
    expect(load).toHaveBeenCalledTimes(1);
    gate.resolve("shared");
    const results = await Promise.all(callers);
    expect(results.map((r) => r.value)).toEqual(["shared", "shared", "shared"]);
  });

  it("an expired value with a burst of callers still reads once", async () => {
    const { cache, advance } = setup();
    const first = vi.fn(async () => "old");
    await cache.get(first);
    advance(61_000);
    const gate = deferred<string>();
    const reload = vi.fn(() => gate.promise);
    const burst = Array.from({ length: 10 }, () => cache.get(reload));
    gate.resolve("new");
    expect((await Promise.all(burst)).every((r) => r.value === "new" && !r.stale)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("after a read finishes, the next expired call starts a fresh read", async () => {
    const { cache, advance } = setup();
    const load = vi.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b").mockResolvedValueOnce("c");
    await cache.get(load);
    advance(61_000);
    await cache.get(load);
    advance(61_000);
    expect((await cache.get(load)).value).toBe("c");
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe("failure", () => {
  it("with nothing earlier to fall back on, the failure is thrown", async () => {
    const { cache } = setup();
    await expect(cache.get(async () => Promise.reject(new Error("rpc down")))).rejects.toThrow("rpc down");
  });

  it("falls back to an earlier value, marked stale, with its real age", async () => {
    const { cache, advance } = setup();
    await cache.get(async () => "good");
    advance(90_000);
    const result = await cache.get(async () => Promise.reject(new Error("rpc down")));
    expect(result).toEqual({ value: "good", ageMs: 90_000, stale: true });
  });

  it("stops serving the old value once it is older than staleMs", async () => {
    const { cache, advance } = setup(60_000, 600_000);
    await cache.get(async () => "good");
    advance(600_000);
    await expect(cache.get(async () => Promise.reject(new Error("rpc down")))).rejects.toThrow("rpc down");
  });

  it("serves the old value up to one millisecond before staleMs", async () => {
    const { cache, advance } = setup(60_000, 600_000);
    await cache.get(async () => "good");
    advance(599_999);
    expect((await cache.get(async () => Promise.reject(new Error("x")))).stale).toBe(true);
  });

  it("never caches a failure: the next call reads again and can succeed", async () => {
    const { cache } = setup();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValueOnce("recovered");
    await expect(cache.get(load)).rejects.toThrow();
    expect(await cache.get(load)).toEqual({ value: "recovered", ageMs: 0, stale: false });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a failed read does not wedge later callers behind it", async () => {
    const { cache } = setup();
    const gate = deferred<string>();
    const first = cache.get(() => gate.promise);
    const second = cache.get(async () => "never used");
    gate.reject(new Error("rpc down"));
    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    expect((await cache.get(async () => "fine")).value).toBe("fine");
  });

  it("a stale copy is replaced as soon as a read succeeds", async () => {
    const { cache, advance } = setup();
    await cache.get(async () => "v1");
    advance(90_000);
    expect((await cache.get(async () => Promise.reject(new Error("x")))).stale).toBe(true);
    expect(await cache.get(async () => "v2")).toEqual({ value: "v2", ageMs: 0, stale: false });
  });
});

describe("options", () => {
  it("refuses a stale window shorter than the fresh window", () => {
    expect(() => singleFlightCache({ freshMs: 10, staleMs: 5 })).toThrow(/freshMs <= staleMs/);
  });

  it("refuses a negative or non-numeric window", () => {
    expect(() => singleFlightCache({ freshMs: -1, staleMs: 5 })).toThrow();
    expect(() => singleFlightCache({ freshMs: Number.NaN, staleMs: 5 })).toThrow();
  });

  it("freshMs of zero means every call reads", async () => {
    const { cache } = setup(0, 0);
    const load = vi.fn(async () => "x");
    await cache.get(load);
    await cache.get(load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
