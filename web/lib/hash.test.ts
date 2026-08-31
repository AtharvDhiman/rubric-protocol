/**
 * Hash stability tests.
 *
 * These matter more than they look. The 32 bytes this module produces are
 * written into a PDA and are the entire basis of "the criteria did not change".
 * If the canonical form ever drifts, every existing task becomes unjudgeable -
 * the verifier would recompute a different hash and refuse to rule.
 *
 * So: one test asserts an exact, hardcoded digest. If you change the canonical
 * format, that test SHOULD fail, and failing it should make you stop and think
 * about the tasks already on-chain rather than just updating the constant.
 */

import { describe, expect, it } from "vitest";
import {
  canonicalizeRubric,
  hashRubricHex,
  hashSubmissionHex,
  hashVerdictHex,
  normalizeText,
  stableStringify,
  validateRubric,
  fromHex,
  toHex,
} from "./hash";

const RUBRIC = {
  title: "Label 500 warehouse shelf photos",
  clauses: [
    "Every barcode is legible and in focus.",
    "Blurred frames are excluded, not guessed at.",
    "Exactly one label per image.",
  ],
};

describe("normalizeText", () => {
  it("collapses whitespace runs to a single space", () => {
    expect(normalizeText("a   b\t\tc")).toBe("a b c");
  });

  it("treats CRLF, CR and LF identically", () => {
    expect(normalizeText("a\r\nb")).toBe(normalizeText("a\nb"));
    expect(normalizeText("a\rb")).toBe(normalizeText("a\nb"));
  });

  it("normalizes Unicode to NFC", () => {
    // "é" as a single codepoint vs. "e" + combining acute.
    const composed = "café";
    const decomposed = "café";
    expect(normalizeText(composed)).toBe(normalizeText(decomposed));
  });

  it("trims the ends", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("does not lowercase - case is meaningful in a clause", () => {
    expect(normalizeText("MUST")).toBe("MUST");
  });
});

describe("canonicalizeRubric", () => {
  it("is stable across runs", () => {
    const a = canonicalizeRubric(RUBRIC);
    const b = canonicalizeRubric(RUBRIC);
    expect(a).toBe(b);
  });

  it("ignores whitespace-insignificant differences", () => {
    const messy = {
      title: "  Label 500   warehouse shelf photos\n",
      clauses: [
        "Every barcode is legible\r\nand in focus.".replace("\r\n", " "),
        "  Blurred frames are excluded, not guessed at.  ",
        "Exactly one label per image.",
      ],
    };
    // Reconstruct the first clause with an internal newline to prove line
    // endings inside a clause collapse too.
    messy.clauses[0] = "Every barcode is legible\r\nand in focus.";
    expect(canonicalizeRubric(messy)).toBe(canonicalizeRubric(RUBRIC));
  });

  it("drops clauses that are empty after normalization", () => {
    const withBlanks = { ...RUBRIC, clauses: [...RUBRIC.clauses, "   ", ""] };
    expect(canonicalizeRubric(withBlanks)).toBe(canonicalizeRubric(RUBRIC));
  });

  it("changes when a clause changes", () => {
    const altered = {
      ...RUBRIC,
      clauses: [...RUBRIC.clauses.slice(0, 2), "Exactly two labels per image."],
    };
    expect(canonicalizeRubric(altered)).not.toBe(canonicalizeRubric(RUBRIC));
  });

  it("changes when clause ORDER changes - §2 is not §3", () => {
    const reordered = { ...RUBRIC, clauses: [...RUBRIC.clauses].reverse() };
    expect(canonicalizeRubric(reordered)).not.toBe(canonicalizeRubric(RUBRIC));
  });

  it("cannot be forged by embedding a delimiter in a clause", () => {
    // The reason clauses are JSON-encoded rather than newline-joined: with a
    // newline join, this single clause would canonicalize identically to a
    // two-clause rubric. It must not.
    const oneClause = { title: "T", clauses: ['a", "b'] };
    const twoClauses = { title: "T", clauses: ["a", "b"] };
    expect(canonicalizeRubric(oneClause)).not.toBe(
      canonicalizeRubric(twoClauses)
    );
  });

  it("includes the version, so a future format change is detectable", () => {
    expect(canonicalizeRubric(RUBRIC).startsWith('{"v":1,')).toBe(true);
  });
});

describe("hashRubricHex", () => {
  it("produces 64 hex characters", () => {
    expect(hashRubricHex(RUBRIC)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashRubricHex(RUBRIC)).toBe(hashRubricHex(RUBRIC));
  });

  /**
   * THE GOLDEN TEST. This digest is pinned. If it fails, the canonical format
   * changed, and every task already sealed on-chain is now unjudgeable. Bump
   * CANONICAL_VERSION and keep the old path rather than editing this constant.
   */
  it("matches the pinned digest for the reference rubric", () => {
    expect(hashRubricHex(RUBRIC)).toBe(
      "56557fc400d7d1d32005d6c87012ee8dfe49f0866049827576e46370b3c80620"
    );
  });
});

describe("hashSubmission", () => {
  it("preserves internal whitespace - it can be meaningful in a deliverable", () => {
    expect(hashSubmissionHex("a  b")).not.toBe(hashSubmissionHex("a b"));
  });

  it("still normalizes line endings", () => {
    expect(hashSubmissionHex("a\r\nb")).toBe(hashSubmissionHex("a\nb"));
  });
});

describe("stableStringify", () => {
  it("sorts keys at every depth", () => {
    const a = { b: 1, a: { d: 2, c: 3 } };
    const b = { a: { c: 3, d: 2 }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("gives two structurally identical verdicts the same hash", () => {
    const v1 = { approved: true, confidence: 96, clauses: [{ index: 0, passed: true }] };
    const v2 = { clauses: [{ passed: true, index: 0 }], confidence: 96, approved: true };
    expect(hashVerdictHex(v1)).toBe(hashVerdictHex(v2));
  });
});

describe("hex round-tripping", () => {
  it("survives a round trip", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 254, 255]);
    expect(Array.from(fromHex(toHex(bytes)))).toEqual(Array.from(bytes));
  });

  it("rejects malformed hex", () => {
    expect(() => fromHex("zz")).toThrow();
    expect(() => fromHex("abc")).toThrow();
  });
});

describe("validateRubric", () => {
  it("accepts the reference rubric", () => {
    expect(validateRubric(RUBRIC)).toEqual([]);
  });

  it("rejects an empty title", () => {
    expect(validateRubric({ ...RUBRIC, title: "   " })).toContain(
      "A title is required."
    );
  });

  it("rejects a rubric with no clauses", () => {
    expect(validateRubric({ title: "T", clauses: ["", "  "] })).toContain(
      "At least one clause is required."
    );
  });

  it("rejects more than eight clauses", () => {
    const many = { title: "T", clauses: Array.from({ length: 9 }, (_, i) => `c${i}`) };
    expect(validateRubric(many).join(" ")).toContain("No more than 8 clauses");
  });
});
