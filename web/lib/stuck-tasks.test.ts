import { describe, it, expect } from "vitest";
import { operationalHold } from "./holds";
import {
  DEFAULT_MIN_AGE_MS,
  MIN_AGE_FLOOR_MS,
  classifyStuck,
  selectStuck,
  type StuckRow,
} from "./stuck-tasks";

const NOW = new Date("2026-10-23T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

const row = (over: Partial<StuckRow> = {}): StuckRow => ({
  id: "t",
  state: "SUBMITTED",
  heldReason: null,
  submittedAt: ago(10 * MIN),
  updatedAt: ago(10 * MIN),
  hasSubmission: true,
  ...over,
});

describe("an unjudged Submitted task", () => {
  it("is stuck once it is old enough that the worker's own call has finished or died", () => {
    expect(classifyStuck(row({ submittedAt: ago(DEFAULT_MIN_AGE_MS) }), NOW)).toBe("unjudged");
    expect(classifyStuck(row({ submittedAt: ago(DEFAULT_MIN_AGE_MS + 1) }), NOW)).toBe("unjudged");
  });

  it("is NOT stuck while it is probably being judged right now", () => {
    // Judging it twice at once wastes quota and can race.
    expect(classifyStuck(row({ submittedAt: ago(DEFAULT_MIN_AGE_MS - 1) }), NOW)).toBeNull();
    expect(classifyStuck(row({ submittedAt: ago(30_000) }), NOW)).toBeNull();
  });

  it("honours a caller-chosen minimum age", () => {
    expect(classifyStuck(row({ submittedAt: ago(2 * MIN) }), NOW, MIN)).toBe("unjudged");
    expect(classifyStuck(row({ submittedAt: ago(2 * MIN) }), NOW, 3 * MIN)).toBeNull();
  });

  it("never goes below the floor, however short a minimum is asked for", () => {
    // 0 means "retry everything" to a hurried operator; it must not mean "race
    // the worker's own call that started five seconds ago".
    expect(classifyStuck(row({ submittedAt: ago(5_000) }), NOW, 0)).toBeNull();
    expect(classifyStuck(row({ submittedAt: ago(MIN_AGE_FLOOR_MS - 1) }), NOW, 0)).toBeNull();
    expect(classifyStuck(row({ submittedAt: ago(MIN_AGE_FLOOR_MS) }), NOW, 0)).toBe("unjudged");
  });

  it("falls back to updatedAt when submittedAt was never recorded", () => {
    expect(classifyStuck(row({ submittedAt: null, updatedAt: ago(10 * MIN) }), NOW)).toBe("unjudged");
    expect(classifyStuck(row({ submittedAt: null, updatedAt: ago(MIN) }), NOW)).toBeNull();
  });
});

describe("an operationally HELD task", () => {
  const held = (over: Partial<StuckRow> = {}) =>
    row({ state: "HELD", heldReason: operationalHold("settlement did not land"), ...over });

  it("is stuck: the judge ran, settlement did not land, and re-running is the fix", () => {
    expect(classifyStuck(held({ updatedAt: ago(5 * MIN) }), NOW)).toBe("operational-hold");
  });

  it("follows the same age rule as an unjudged task, so --older-than means one thing", () => {
    expect(classifyStuck(held({ updatedAt: ago(DEFAULT_MIN_AGE_MS - 1) }), NOW)).toBeNull();
    expect(classifyStuck(held({ updatedAt: ago(DEFAULT_MIN_AGE_MS) }), NOW)).toBe("operational-hold");
  });

  it("after a refill an operator can ask for 'just retry them now', down to the floor", () => {
    expect(classifyStuck(held({ updatedAt: ago(MIN_AGE_FLOOR_MS) }), NOW, MIN_AGE_FLOOR_MS)).toBe("operational-hold");
  });
});

describe("what is never retried", () => {
  it("a task HELD for a JUDGEMENT reason: a human is needed, and a retry buys the same answer", () => {
    const judgement = row({
      state: "HELD",
      heldReason: "Confidence 54 is below the 70 threshold required to settle automatically.",
      updatedAt: ago(60 * MIN),
    });
    expect(classifyStuck(judgement, NOW)).toBeNull();
  });

  it("a held task with no reason recorded", () => {
    expect(classifyStuck(row({ state: "HELD", heldReason: null }), NOW)).toBeNull();
  });

  it("a task with no submission, which the route would refuse anyway", () => {
    expect(classifyStuck(row({ hasSubmission: false }), NOW)).toBeNull();
    expect(
      classifyStuck(row({ state: "HELD", heldReason: operationalHold("x"), hasSubmission: false }), NOW)
    ).toBeNull();
  });

  it("anything terminal or not yet started", () => {
    for (const state of ["SETTLED", "REFUNDED", "OPEN", "PENDING"]) {
      expect(classifyStuck(row({ state }), NOW)).toBeNull();
    }
  });
});

describe("selectStuck", () => {
  it("returns only stuck tasks, oldest first, with the reason", () => {
    const rows = [
      row({ id: "newer", submittedAt: ago(20 * MIN) }),
      row({ id: "fresh", submittedAt: ago(MIN) }), // mid-judge
      row({ id: "oldest", submittedAt: ago(90 * MIN) }),
      row({
        id: "opHold",
        state: "HELD",
        heldReason: operationalHold("x"),
        submittedAt: ago(45 * MIN),
        updatedAt: ago(40 * MIN),
      }),
      row({ id: "judgementHold", state: "HELD", heldReason: "Confidence 54 is below the 70.", updatedAt: ago(99 * MIN) }),
      row({ id: "done", state: "SETTLED" }),
    ];
    const picked = selectStuck(rows, NOW);
    expect(picked.map((p) => p.row.id)).toEqual(["oldest", "opHold", "newer"]);
    expect(picked.map((p) => p.kind)).toEqual(["unjudged", "operational-hold", "unjudged"]);
  });

  it("selects nothing from an empty or healthy set", () => {
    expect(selectStuck([], NOW)).toEqual([]);
    expect(selectStuck([row({ state: "SETTLED" }), row({ state: "OPEN" })], NOW)).toEqual([]);
  });
});
