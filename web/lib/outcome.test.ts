import { describe, it, expect } from "vitest";
import { refundWasRuling, storedOutcome } from "./outcome";

const verdict = (over: Record<string, unknown>) => ({
  approved: false,
  confidence: 90,
  summary: "x",
  clauses: [],
  ...over,
});

describe("storedOutcome", () => {
  it("reads the three outcomes the judge publishes", () => {
    for (const outcome of ["approved", "rejected", "needs_manual_review"] as const) {
      expect(storedOutcome(verdict({ outcome }))).toBe(outcome);
    }
  });

  it("is null for no verdict, junk, or a record that predates the field", () => {
    expect(storedOutcome(null)).toBeNull();
    expect(storedOutcome(undefined)).toBeNull();
    expect(storedOutcome("rejected")).toBeNull();
    expect(storedOutcome(42)).toBeNull();
    expect(storedOutcome(verdict({}))).toBeNull();
    expect(storedOutcome(verdict({ outcome: "maybe" }))).toBeNull();
  });
});

describe("refundWasRuling", () => {
  it("a rejection is a ruling", () => {
    expect(refundWasRuling(verdict({ outcome: "rejected" }))).toBe(true);
  });

  it("a task held and then reclaimed was NOT rejected, even though its stored verdict says approved: false", () => {
    // The mislabel this exists to prevent: approved is false for a hold too.
    const held = verdict({ outcome: "needs_manual_review", approved: false });
    expect(held.approved).toBe(false);
    expect(refundWasRuling(held)).toBe(false);
  });

  it("no verdict at all is not a rejection (an unjudged task that was reclaimed)", () => {
    expect(refundWasRuling(null)).toBe(false);
    expect(refundWasRuling(undefined)).toBe(false);
  });

  it("an approved outcome is not a refund ruling", () => {
    expect(refundWasRuling(verdict({ outcome: "approved", approved: true }))).toBe(false);
  });

  it("an explicit outcome wins over the approved flag, in both directions", () => {
    expect(refundWasRuling(verdict({ outcome: "needs_manual_review", approved: false }))).toBe(false);
    expect(refundWasRuling(verdict({ outcome: "rejected", approved: true }))).toBe(true);
  });

  it("a legacy record with no outcome is read by its approved flag", () => {
    expect(refundWasRuling(verdict({ approved: false }))).toBe(true);
    expect(refundWasRuling(verdict({ approved: true }))).toBe(false);
  });

  it("junk is never a ruling", () => {
    for (const v of ["rejected", 7, [], {}, { approved: "false" }]) {
      expect(refundWasRuling(v)).toBe(false);
    }
  });
});
