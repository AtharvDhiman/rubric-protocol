import { describe, it, expect } from "vitest";
import {
  MAX_REASON_LENGTH,
  MAX_SUMMARY_LENGTH,
  REVIEW_CONFIDENCE,
  buildReviewedVerdict,
  decisionApproves,
  decisionHash,
  isReviewer,
  parseReviewers,
  reviewAuthMessage,
  reviewerModel,
  reviewerOfModel,
  validateDecision,
} from "./review";

const A = "4kTkVfPqXn1s8pQx9hZmR3wJdG7bN2cY6vL5tA8wHKa";
const B = "7gRz1nQb3YtWcXe5LmP9dVhA2uJ8sKfNo4TyUiD6xBqE";

const decision = (over: Record<string, unknown> = {}) => ({
  clauses: [
    { index: 0, passed: true, reason: "It says blue." },
    { index: 1, passed: false, reason: "No mention of green." },
  ],
  summary: "One clause missed.",
  ...over,
});

const ok = (raw: unknown, n = 2) => {
  const r = validateDecision(raw, n);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
};
const err = (raw: unknown, n = 2) => {
  const r = validateDecision(raw, n);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("validateDecision", () => {
  it("accepts a complete ruling", () => {
    expect(ok(decision()).clauses).toHaveLength(2);
  });

  it("is not a ruling unless it covers EVERY clause exactly once", () => {
    expect(err(decision({ clauses: [{ index: 0, passed: true, reason: "x" }] }))).toMatch(/every clause/);
    expect(err(decision({ clauses: [] }))).toMatch(/every clause/);
    expect(
      err(decision({ clauses: [
        { index: 0, passed: true, reason: "x" },
        { index: 0, passed: true, reason: "y" },
      ] }))
    ).toMatch(/exactly once/);
    expect(
      err(decision({ clauses: [
        { index: 0, passed: true, reason: "x" },
        { index: 2, passed: true, reason: "y" },
      ] }))
    ).toMatch(/exactly once/);
    expect(
      err(decision({ clauses: [
        { index: -1, passed: true, reason: "x" },
        { index: 1, passed: true, reason: "y" },
      ] }))
    ).toMatch(/exactly once/);
  });

  it("rejects malformed clause rulings", () => {
    for (const bad of [
      { index: "0", passed: true, reason: "x" },
      { index: 0.5, passed: true, reason: "x" },
      { index: 0, passed: "yes", reason: "x" },
      { index: 0, passed: true },
      null,
      "text",
    ]) {
      expect(err(decision({ clauses: [bad, { index: 1, passed: true, reason: "y" }] })), JSON.stringify(bad)).toMatch(
        /index, a pass or fail, and a reason/
      );
    }
  });

  it("every clause needs a reason, even a pass: rulings are public", () => {
    expect(
      err(decision({ clauses: [
        { index: 0, passed: true, reason: "   " },
        { index: 1, passed: true, reason: "y" },
      ] }))
    ).toMatch(/Clause 1 needs a reason/);
  });

  it("bounds the reason and the summary", () => {
    const long = (n: number) => "a".repeat(n);
    expect(
      err(decision({ clauses: [
        { index: 0, passed: true, reason: long(MAX_REASON_LENGTH + 1) },
        { index: 1, passed: true, reason: "y" },
      ] }))
    ).toMatch(/over 400/);
    expect(err(decision({ summary: long(MAX_SUMMARY_LENGTH + 1) }))).toMatch(/over 600/);
    expect(validateDecision(decision({ summary: long(MAX_SUMMARY_LENGTH) }), 2).ok).toBe(true);
  });

  it("needs a summary", () => {
    expect(err(decision({ summary: "" }))).toMatch(/summary/);
    expect(err(decision({ summary: "   " }))).toMatch(/summary/);
    expect(err(decision({ summary: 5 }))).toMatch(/summary/);
    expect(err({ clauses: decision().clauses })).toMatch(/summary/);
  });

  it("rejects things that are not a ruling at all", () => {
    for (const v of [null, undefined, "x", 3, [], true]) expect(err(v)).toMatch(/missing/);
  });

  it("normalises text, so the client and the server hash the same bytes", () => {
    const v = ok(decision({ summary: "  One\r\n clause   missed.  " }));
    expect(v.summary).toBe("One clause missed.");
    // NFC: e + combining acute is the same as the precomposed character.
    const a = ok(decision({ clauses: [
      { index: 0, passed: true, reason: "café" },
      { index: 1, passed: true, reason: "y" },
    ] }));
    expect(a.clauses[0].reason).toBe("café");
  });

  it("returns the rulings in clause order whatever order they arrived in", () => {
    const v = ok(decision({ clauses: [
      { index: 1, passed: false, reason: "b" },
      { index: 0, passed: true, reason: "a" },
    ] }));
    expect(v.clauses.map((c) => c.index)).toEqual([0, 1]);
  });
});

describe("the outcome is derived, never chosen", () => {
  it("approves only if every clause passed", () => {
    expect(decisionApproves(ok(decision()))).toBe(false);
    expect(
      decisionApproves(ok(decision({ clauses: [
        { index: 0, passed: true, reason: "a" },
        { index: 1, passed: true, reason: "b" },
      ] })))
    ).toBe(true);
  });

  it("ignores any `approved` the caller tries to smuggle in", () => {
    const v = ok({ ...decision(), approved: true, outcome: "approved" });
    expect(decisionApproves(v)).toBe(false);
    expect(JSON.stringify(v)).not.toMatch(/approved|outcome/);
  });
});

describe("decisionHash", () => {
  it("is stable, and independent of the order the rulings arrived in", () => {
    const a = ok(decision());
    const b = ok(decision({ clauses: [...decision().clauses].reverse() }));
    expect(decisionHash(a)).toBe(decisionHash(b));
    expect(decisionHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with ANY part of the ruling", () => {
    const base = decisionHash(ok(decision()));
    expect(decisionHash(ok(decision({ summary: "Another." })))).not.toBe(base);
    expect(
      decisionHash(ok(decision({ clauses: [
        { index: 0, passed: false, reason: "It says blue." },
        { index: 1, passed: false, reason: "No mention of green." },
      ] })))
    ).not.toBe(base);
    expect(
      decisionHash(ok(decision({ clauses: [
        { index: 0, passed: true, reason: "It says blue!" },
        { index: 1, passed: false, reason: "No mention of green." },
      ] })))
    ).not.toBe(base);
  });
});

describe("reviewAuthMessage", () => {
  const p = { taskId: "t1", reviewerAddress: A, decisionHash: "ab".repeat(32), issuedAt: "2026-10-23T12:00:00.000Z" };

  it("names the task, the reviewer, the ruling and the time", () => {
    const m = reviewAuthMessage(p);
    for (const part of [p.taskId, p.reviewerAddress, p.decisionHash, p.issuedAt]) expect(m).toContain(part);
  });

  it("says plainly that it releases or refunds escrow and is public", () => {
    const m = reviewAuthMessage(p);
    expect(m).toMatch(/release or refund the escrowed bounty/);
    expect(m).toMatch(/public/);
  });

  it("is different for every input, so a signature binds all of them", () => {
    const base = reviewAuthMessage(p);
    expect(reviewAuthMessage({ ...p, taskId: "t2" })).not.toBe(base);
    expect(reviewAuthMessage({ ...p, reviewerAddress: B })).not.toBe(base);
    expect(reviewAuthMessage({ ...p, decisionHash: "cd".repeat(32) })).not.toBe(base);
    expect(reviewAuthMessage({ ...p, issuedAt: "2026-10-23T12:00:01.000Z" })).not.toBe(base);
  });
});

describe("parseReviewers", () => {
  it("is empty, meaning review is OFF, when unset or blank", () => {
    for (const v of [undefined, "", "   ", ",,,"]) expect(parseReviewers(v).addresses).toEqual([]);
  });

  it("reads commas and whitespace, and de-duplicates", () => {
    expect(parseReviewers(`${A}, ${B}\n${A}`).addresses).toEqual([A, B]);
  });

  it("FAILS CLOSED: an invalid entry is reported and ignored, never trusted", () => {
    const r = parseReviewers(`${A},not-a-key,0OIl,${B}`);
    expect(r.addresses).toEqual([A, B]);
    expect(r.invalid).toEqual(["not-a-key", "0OIl"]);
  });

  it("isReviewer is exact", () => {
    const r = parseReviewers(A);
    expect(isReviewer(A, r)).toBe(true);
    expect(isReviewer(B, r)).toBe(false);
    expect(isReviewer(A.toLowerCase(), r)).toBe(false);
    expect(isReviewer("", r)).toBe(false);
  });
});

describe("what is published", () => {
  const d = ok(decision());
  const params = { decision: d, outcome: "rejected" as const, reviewerAddress: A, rubricTitle: "T", clauseCount: 2 };

  it("has the same shape as an AI verdict, so it hashes and renders the same way", () => {
    expect(Object.keys(buildReviewedVerdict(params)).sort()).toEqual(
      ["approved", "clauseCount", "clauses", "confidence", "model", "outcome", "rubricTitle", "summary"].sort()
    );
  });

  it("names the reviewer in `model`, and that is recoverable", () => {
    const v = buildReviewedVerdict(params);
    expect(v.model).toBe(reviewerModel(A));
    expect(reviewerOfModel(v.model)).toBe(A);
  });

  it("reviewerOfModel is null for an AI model, junk, or an empty reviewer", () => {
    for (const m of ["gemini-2.5-flash", "human:", "", null, undefined, 5]) expect(reviewerOfModel(m)).toBeNull();
  });

  it("approved follows the outcome, and confidence is the documented constant", () => {
    expect(buildReviewedVerdict(params).approved).toBe(false);
    expect(buildReviewedVerdict({ ...params, outcome: "approved" }).approved).toBe(true);
    expect(buildReviewedVerdict(params).confidence).toBe(REVIEW_CONFIDENCE);
  });
});
