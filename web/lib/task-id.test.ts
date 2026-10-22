import { describe, it, expect } from "vitest";
import {
  LEGACY_ID_LIMIT,
  TASK_ID_RANDOM_BITS,
  formatRecordNumber,
  nextOnchainTaskId,
  recordNumber,
} from "./task-id";

const MAX_RANDOM = (1n << TASK_ID_RANDOM_BITS) - 1n;
const U64_MAX = (1n << 64n) - 1n;
const I64_MAX = (1n << 63n) - 1n;

describe("legacy ids keep the record number they always showed", () => {
  it("passes a dense legacy id straight through", () => {
    expect(recordNumber(1n)).toBe(1n);
    expect(recordNumber(45n)).toBe(45n);
    expect(formatRecordNumber(45n)).toBe("0045");
  });

  it("the largest legacy id is still a legacy id", () => {
    expect(recordNumber(LEGACY_ID_LIMIT - 1n)).toBe(LEGACY_ID_LIMIT - 1n);
  });

  it("accepts the string form the my-work page receives", () => {
    expect(formatRecordNumber("46")).toBe("0046");
  });
});

describe("nextOnchainTaskId", () => {
  it("starts a poster's first task at record number 1", () => {
    const id = nextOnchainTaskId(null, 0n);
    expect(recordNumber(id)).toBe(1n);
    expect(id).toBeGreaterThanOrEqual(LEGACY_ID_LIMIT);
  });

  it("continues a legacy poster's count: 45 -> 46", () => {
    expect(recordNumber(nextOnchainTaskId(45n, 123n))).toBe(46n);
  });

  it("continues an encoded poster's count, whatever the random bits were", () => {
    for (const previousRandom of [0n, 1n, 12345n, MAX_RANDOM]) {
      const previous = nextOnchainTaskId(45n, previousRandom);
      expect(recordNumber(previous)).toBe(46n);
      expect(recordNumber(nextOnchainTaskId(previous, 999n))).toBe(47n);
    }
  });

  it("puts the random bits in the low 24 bits and nowhere else", () => {
    const id = nextOnchainTaskId(10n, 0xabcdefn);
    expect(id & MAX_RANDOM).toBe(0xabcdefn);
    expect(id >> TASK_ID_RANDOM_BITS).toBe(11n);
  });

  it("masks oversized random input instead of corrupting the sequence", () => {
    // A caller handing in 32 bits must not be able to bump the record number.
    const id = nextOnchainTaskId(10n, 0xffffffffffn);
    expect(recordNumber(id)).toBe(11n);
  });

  it("two tasks with the same record number get different ids", () => {
    // The whole point: the id an attacker would have to guess is not a function
    // of what is visible on the docket.
    expect(nextOnchainTaskId(10n, 1n)).not.toBe(nextOnchainTaskId(10n, 2n));
  });
});

describe("ORDER BY onchainTaskId DESC still finds the newest task", () => {
  // The route picks `latest` with exactly that query, so a newer task must always
  // sort above an older one - including the unlucky case where the older task drew
  // the largest random bits and the newer one drew the smallest.
  it("a newer id is strictly greater than the previous one, for every random draw", () => {
    const worstCaseOlder = nextOnchainTaskId(45n, MAX_RANDOM);
    const bestCaseNewer = nextOnchainTaskId(worstCaseOlder, 0n);
    expect(bestCaseNewer).toBeGreaterThan(worstCaseOlder);
  });

  it("an encoded id always sorts above every legacy id", () => {
    expect(nextOnchainTaskId(LEGACY_ID_LIMIT - 1n, 0n)).toBeGreaterThan(
      LEGACY_ID_LIMIT - 1n
    );
    expect(nextOnchainTaskId(null, 0n)).toBeGreaterThan(LEGACY_ID_LIMIT - 1n);
  });

  it("holds along a long chain of tasks", () => {
    let latest: bigint | null = null;
    let previous = 0n;
    for (let i = 1; i <= 500; i++) {
      // deterministic spread across the whole random range
      const random = (BigInt(i) * 2_654_435_761n) & MAX_RANDOM;
      latest = nextOnchainTaskId(latest, random);
      expect(latest).toBeGreaterThan(previous);
      expect(recordNumber(latest)).toBe(BigInt(i));
      previous = latest;
    }
  });
});

describe("ids stay representable", () => {
  it("a realistic id fits an unsigned 64-bit PDA seed and a signed Postgres bigint", () => {
    // 100 million tasks by a single poster is far beyond reality.
    const id = nextOnchainTaskId(100_000_000n, MAX_RANDOM);
    expect(id).toBeLessThanOrEqual(U64_MAX);
    expect(id).toBeLessThanOrEqual(I64_MAX);
  });

  it("the sequence has 39 bits of headroom before a signed bigint overflows", () => {
    const sequenceMax = (1n << 39n) - 1n;
    const id = nextOnchainTaskId((sequenceMax - 1n) << TASK_ID_RANDOM_BITS, MAX_RANDOM);
    expect(recordNumber(id)).toBe(sequenceMax);
    expect(id).toBeLessThanOrEqual(I64_MAX);
  });
});
