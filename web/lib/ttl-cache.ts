/**
 * A cache for one expensive read, with two properties a plain `if (cached) return cached`
 * does not have.
 *
 * SINGLE FLIGHT. When the value has expired and ten requests arrive together, one read
 * happens and all ten wait for it. Without this, a public page that reads the chain turns a
 * burst of visitors into a burst of `getProgramAccounts` calls, which is the call an RPC
 * provider rate-limits first.
 *
 * STALE, BUT SAID SO. If the read fails and there is an earlier value that is not too old,
 * it is returned with `stale: true` and its real age, so the caller can show it as a copy
 * and not as a fresh reading. A failure is never cached: the next request tries again.
 * A value older than `staleMs` is not served at all, because past that point an old number
 * is worse than an honest "could not read it".
 *
 * The clock is a parameter so the expiry rules can be tested without waiting.
 */

export interface Cached<T> {
  value: T;
  /** How long ago the value was read. */
  ageMs: number;
  /** True when the read just failed and this is an earlier copy. */
  stale: boolean;
}

export interface SingleFlightCache<T> {
  get(load: () => Promise<T>): Promise<Cached<T>>;
}

export interface CacheOptions {
  /** Within this age a value is served without a new read. */
  freshMs: number;
  /** A failed read may fall back to a value up to this old. Must be at least `freshMs`. */
  staleMs: number;
  now?: () => number;
}

interface Entry<T> {
  value: T;
  storedAt: number;
}

export function singleFlightCache<T>(options: CacheOptions): SingleFlightCache<T> {
  const { freshMs, staleMs } = options;
  const now = options.now ?? Date.now;
  if (!(freshMs >= 0) || !(staleMs >= freshMs)) {
    throw new Error("singleFlightCache: need 0 <= freshMs <= staleMs.");
  }

  let entry: Entry<T> | null = null;
  let inflight: Promise<Entry<T>> | null = null;

  // A clock that steps backwards must not make a value look younger than it is.
  const ageOf = (e: Entry<T>) => Math.max(0, now() - e.storedAt);

  return {
    async get(load) {
      if (entry && ageOf(entry) < freshMs) {
        return { value: entry.value, ageMs: ageOf(entry), stale: false };
      }

      if (!inflight) {
        inflight = load()
          .then((value) => {
            entry = { value, storedAt: now() };
            return entry;
          })
          .finally(() => {
            inflight = null;
          });
      }

      try {
        const fresh = await inflight;
        return { value: fresh.value, ageMs: ageOf(fresh), stale: false };
      } catch (error) {
        if (entry && ageOf(entry) < staleMs) {
          return { value: entry.value, ageMs: ageOf(entry), stale: true };
        }
        throw error;
      }
    },
  };
}
