import { describe, it, expect } from "vitest";
import { holdDetail, isOperationalHold, operationalHold } from "./holds";

describe("operational holds", () => {
  it("marks a reason, and recognises the mark", () => {
    const r = operationalHold("The verifier wallet could not pay for it.");
    expect(isOperationalHold(r)).toBe(true);
    expect(holdDetail(r)).toBe("The verifier wallet could not pay for it.");
  });

  it("is idempotent: it never stacks prefixes", () => {
    const once = operationalHold("x");
    expect(operationalHold(once)).toBe(once);
  });

  it("a judgement hold is NOT operational", () => {
    // The seeded demo reason and the verifier's own confidence reasons.
    for (const reason of [
      "Confidence 54 is below the 70 threshold required to settle automatically.",
      "The rejection did not cite a specific failed clause.",
      "The clauses on record do not match the clauses sealed on-chain, so this task cannot be judged automatically.",
    ]) {
      expect(isOperationalHold(reason)).toBe(false);
      expect(holdDetail(reason)).toBe(reason);
    }
  });

  it("treats missing reasons as not operational, and as empty text", () => {
    expect(isOperationalHold(null)).toBe(false);
    expect(isOperationalHold(undefined)).toBe(false);
    expect(isOperationalHold("")).toBe(false);
    expect(holdDetail(null)).toBe("");
    expect(holdDetail(undefined)).toBe("");
  });

  it("only a LEADING marker counts, so quoting one inside a reason cannot reclassify it", () => {
    expect(isOperationalHold("The judge wrote: [operational] nothing.")).toBe(false);
  });
});
