import { describe, it, expect } from "vitest";
import {
  countsAsVerdict,
  medianVerdictSeconds,
  verdictsSince,
  type DecisionRecord,
} from "./verdict-stats";
import { demoTasks } from "./demo";

const START_OF_DAY = new Date("2026-10-24T00:00:00.000Z");
const at = (ms: number) => new Date(START_OF_DAY.getTime() + ms);

const verdict = (over: Record<string, unknown>) => ({
  approved: false,
  confidence: 90,
  summary: "x",
  clauses: [],
  ...over,
});

const approved = verdict({ outcome: "approved", approved: true });
const rejected = verdict({ outcome: "rejected" });
// What a task held for a judgement reason keeps in verdictJson: approved is false, but
// nobody ruled against the work.
const held = verdict({ outcome: "needs_manual_review", confidence: 48 });

/** A settled task decided one hour into the day, 40 seconds after it was submitted. */
const record = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  state: "SETTLED",
  verdictJson: approved,
  decidedAt: at(3_600_000),
  submittedAt: at(3_600_000 - 40_000),
  ...over,
});

/** A record that took `seconds` to decide. */
const took = (seconds: number, over: Partial<DecisionRecord> = {}) =>
  record({ decidedAt: at(3_600_000), submittedAt: at(3_600_000 - seconds * 1000), ...over });

describe("countsAsVerdict", () => {
  it("a settled task is a verdict", () => {
    expect(countsAsVerdict(record())).toBe(true);
  });

  it("a settled task is a verdict whatever its stored verdict says", () => {
    // Settled is the judge approving. It never needs the refund test.
    expect(countsAsVerdict(record({ verdictJson: null }))).toBe(true);
  });

  it("a rejected task (REFUNDED by a ruling) is a verdict", () => {
    expect(countsAsVerdict(record({ state: "REFUNDED", verdictJson: rejected }))).toBe(true);
  });

  it("a reclaimed task with no verdict is NOT a verdict", () => {
    expect(countsAsVerdict(record({ state: "REFUNDED", verdictJson: null }))).toBe(false);
  });

  it("a task held for a judgement reason and then reclaimed is NOT a verdict", () => {
    // The miscount this exists to stop: REFUNDED, decidedAt set from the hold, and a
    // stored verdict that says approved: false.
    const heldThenReclaimed = record({ state: "REFUNDED", verdictJson: held });
    expect((heldThenReclaimed.verdictJson as { approved: boolean }).approved).toBe(false);
    expect(heldThenReclaimed.decidedAt).not.toBeNull();
    expect(countsAsVerdict(heldThenReclaimed)).toBe(false);
  });

  it("a legacy refunded record with approved: false and no outcome is a verdict", () => {
    const legacy = verdict({ approved: false });
    expect("outcome" in legacy).toBe(false);
    expect(countsAsVerdict(record({ state: "REFUNDED", verdictJson: legacy }))).toBe(true);
  });

  it("a task with no decidedAt is excluded, settled or rejected", () => {
    expect(countsAsVerdict(record({ decidedAt: null }))).toBe(false);
    expect(
      countsAsVerdict(record({ state: "REFUNDED", verdictJson: rejected, decidedAt: null }))
    ).toBe(false);
  });

  it("a task that is not yet terminal is never a verdict", () => {
    // A HELD task has a decidedAt (when the hold was recorded) and can even carry a
    // rejection-shaped verdict. It is still undecided.
    for (const state of ["OPEN", "SUBMITTED", "HELD", "PENDING"]) {
      expect(countsAsVerdict(record({ state, verdictJson: rejected }))).toBe(false);
    }
  });
});

describe("verdictsSince", () => {
  it("counts settled and rejected, and skips reclaimed ones decided the same day", () => {
    const tasks = [
      record(),
      record({ state: "REFUNDED", verdictJson: rejected }),
      record({ state: "REFUNDED", verdictJson: held }),
      record({ state: "REFUNDED", verdictJson: null }),
    ];
    expect(verdictsSince(tasks, START_OF_DAY)).toBe(2);
  });

  it("the start of the day is inclusive and the millisecond before it is not", () => {
    expect(verdictsSince([record({ decidedAt: at(0) })], START_OF_DAY)).toBe(1);
    expect(verdictsSince([record({ decidedAt: at(-1) })], START_OF_DAY)).toBe(0);
  });

  it("a verdict from a later day is still counted", () => {
    // `since` is a lower bound only, matching the query's `gte`.
    expect(verdictsSince([record({ decidedAt: at(86_400_000 * 3) })], START_OF_DAY)).toBe(1);
  });

  it("is zero for an empty list", () => {
    expect(verdictsSince([], START_OF_DAY)).toBe(0);
  });
});

describe("medianVerdictSeconds", () => {
  it("is null when there is nothing to measure", () => {
    expect(medianVerdictSeconds([])).toBeNull();
  });

  it("is null when the only decided task is a reclaim", () => {
    expect(
      medianVerdictSeconds([took(47, { state: "REFUNDED", verdictJson: held })])
    ).toBeNull();
  });

  it("takes the middle of an odd number of durations, whatever order they arrive in", () => {
    expect(medianVerdictSeconds([took(30), took(10), took(20)])).toBe(20);
  });

  it("takes the mean of the two middle durations when the count is even", () => {
    expect(medianVerdictSeconds([took(10), took(20)])).toBe(15);
    expect(medianVerdictSeconds([took(40), took(10), took(30), took(20)])).toBe(25);
    // Not the upper middle (30) and not the lower middle (20), and not skewed by the tails.
    expect(medianVerdictSeconds([took(1), took(20), took(30), took(900)])).toBe(25);
  });

  it("rounds a half-second mean up, to a whole second", () => {
    expect(medianVerdictSeconds([took(38), took(41)])).toBe(40);
    expect(medianVerdictSeconds([took(10), took(11)])).toBe(11);
    expect(medianVerdictSeconds([took(10), took(13)])).toBe(12);
  });

  it("a single duration is its own median", () => {
    expect(medianVerdictSeconds([took(7)])).toBe(7);
  });

  it("a reclaimed task's hold time does not enter the median", () => {
    // A task held 260 hours before it was reclaimed. If it were counted the middle of
    // [10, 20, 30, 936000] would be 25; without it, 20.
    const reclaimed = took(260 * 3600, { state: "REFUNDED", verdictJson: held });
    expect(medianVerdictSeconds([took(30), reclaimed, took(10), took(20)])).toBe(20);
  });

  it("a rejection's time does enter the median", () => {
    const rejection = took(90, { state: "REFUNDED", verdictJson: rejected });
    expect(medianVerdictSeconds([took(10), rejection, took(500)])).toBe(90);
  });

  it("skips a verdict with no submittedAt", () => {
    expect(medianVerdictSeconds([took(10, { submittedAt: null })])).toBeNull();
    expect(medianVerdictSeconds([took(30), took(5, { submittedAt: null }), took(10), took(20)])).toBe(20);
  });

  it("skips a task with no decidedAt", () => {
    expect(medianVerdictSeconds([took(10, { decidedAt: null })])).toBeNull();
  });

  it("keeps a zero-second duration and drops a negative one", () => {
    expect(medianVerdictSeconds([took(0)])).toBe(0);
    expect(
      medianVerdictSeconds([record({ decidedAt: at(0), submittedAt: at(5_000) })])
    ).toBeNull();
  });

  it("rounds to the nearest whole second", () => {
    const gap = (ms: number) => record({ decidedAt: at(ms), submittedAt: at(0) });
    expect(medianVerdictSeconds([gap(1_400)])).toBe(1);
    expect(medianVerdictSeconds([gap(1_500)])).toBe(2);
  });
});

describe("the seeded demo docket", () => {
  const byId = (id: string) => {
    const task = demoTasks().find((t) => t.id === id);
    if (!task) throw new Error(`demo task ${id} is gone from lib/demo.ts`);
    return task;
  };

  it("the fixtures are the shapes this is about", () => {
    // Both are REFUNDED with a decidedAt, and both store approved: false. Only the
    // outcome tells them apart, so the tests below are not vacuous.
    for (const id of ["demo-reclaimed-held", "demo-refunded-transcripts"]) {
      const task = byId(id);
      expect(task.state).toBe("REFUNDED");
      expect(task.decidedAt).not.toBeNull();
      expect(task.verdictJson?.approved).toBe(false);
    }
  });

  it("the held-then-reclaimed task is not a verdict and the real rejection is", () => {
    expect(countsAsVerdict(byId("demo-reclaimed-held"))).toBe(false);
    expect(countsAsVerdict(byId("demo-refunded-transcripts"))).toBe(true);
  });

  it("counts exactly the settled task and the rejected one", () => {
    const ids = demoTasks()
      .filter((task) => countsAsVerdict(task))
      .map((task) => task.id)
      .sort();
    expect(ids).toEqual(["demo-refunded-transcripts", "demo-settled-labels"]);
    // The old rule (state alone) would have said 3.
    expect(verdictsSince(demoTasks(), new Date(0))).toBe(2);
  });

  it("the reclaim contributes no time, the rejection and the settlement do", () => {
    expect(medianVerdictSeconds([byId("demo-reclaimed-held")])).toBeNull();
    expect(medianVerdictSeconds([byId("demo-refunded-transcripts")])).toBe(38);
    expect(medianVerdictSeconds([byId("demo-settled-labels")])).toBe(41);
  });

  it("the docket's median is the mean of the two verdicts, 38s and 41s, not the slower one", () => {
    // The reclaim (47s) is excluded, leaving two durations: (38 + 41) / 2 = 39.5 -> 40.
    expect(medianVerdictSeconds(demoTasks())).toBe(40);
  });
});
