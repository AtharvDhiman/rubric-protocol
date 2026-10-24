/**
 * The landing page must never present an illustration as activity, or a goal as a
 * result. These tests pin the specific ways it used to.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIGURES, FIGURE_TAGS, FIGURES_NOTE, MARQUEE_ITEMS } from "./constants";
import {
  EXAMPLE_HEADING,
  HERO_EXAMPLE,
  LOG_BODY,
  LOG_CAPTION,
  LOG_LINES,
  STEPS,
  landingStrings,
  unlabelledTimingClaims,
} from "./landing-content";

describe("unlabelledTimingClaims", () => {
  it("finds a timing stated as a fact", () => {
    for (const text of [
      "Median verdict: 41 seconds.",
      "Pays in 0.4s.",
      "released in under a second",
      "settles in a second",
      "about one minute",
      "within 2 minutes",
      "confirmed in 350ms",
    ]) {
      expect(unlabelledTimingClaims(text), text).not.toEqual([]);
    }
  });

  it("accepts the same timing when the sentence marks it as a target", () => {
    expect(unlabelledTimingClaims("Target median verdict: 41 seconds.")).toEqual([]);
    expect(unlabelledTimingClaims("Our goal is under a second.")).toEqual([]);
  });

  it("the qualifier must be in the SAME sentence, not a neighbouring one", () => {
    expect(unlabelledTimingClaims("This is a target. Verdicts take 41 seconds.")).toEqual(["41 seconds"]);
  });

  it("does not flag numbers that are not durations", () => {
    for (const text of [
      "confidence 96",
      "500 of 500 labels",
      "2% flat protocol fee",
      "clause 1 sampled 50, focus check",
      "14:02:41 submission received",
      "Three clauses",
    ]) {
      expect(unlabelledTimingClaims(text), text).toEqual([]);
    }
  });
});

describe("everything the landing page says in words", () => {
  it("states no timing as a fact", () => {
    for (const s of landingStrings()) {
      expect(unlabelledTimingClaims(s), s).toEqual([]);
    }
  });

  it("never says 'finality': 0.4s was a slot time, and finality is a different, longer thing", () => {
    for (const s of landingStrings()) expect(s, s).not.toMatch(/finality/i);
    for (const l of LOG_LINES) expect(l.body).not.toMatch(/finality/i);
  });

  it("never claims the chain makes a rejection impossible without a clause: the judge's code refuses, the program does not check", () => {
    for (const s of landingStrings()) expect(s, s).not.toMatch(/impossible by design/i);
    expect(LOG_BODY).toMatch(/held, not issued/);
  });

  it("covers the copy that was previously inline", () => {
    expect(STEPS).toHaveLength(3);
    expect(MARQUEE_ITEMS.length).toBeGreaterThan(0);
    expect(landingStrings().length).toBeGreaterThan(10);
  });
});

describe("the illustrated ruling is an illustration", () => {
  it("is headed EXAMPLE", () => {
    expect(EXAMPLE_HEADING).toBe("EXAMPLE");
  });

  it("says, directly under itself, that it is not a feed and not a real matter", () => {
    expect(LOG_CAPTION).toMatch(/illustration/i);
    expect(LOG_CAPTION).toMatch(/not a live feed/i);
    expect(LOG_CAPTION).toMatch(/not a real matter/i);
  });

  it("reports no payout speed or amount it cannot show", () => {
    for (const l of LOG_LINES) {
      expect(l.body).not.toMatch(/USDC/);
      expect(l.body).not.toMatch(/\d\s?s\b/);
    }
  });
});

describe("the figures", () => {
  it("every figure says what kind of statement it is", () => {
    for (const f of FIGURES) expect(Object.keys(FIGURE_TAGS)).toContain(f.kind);
  });

  it("a figure with a time unit is a TARGET: it cannot be 'by design'", () => {
    for (const f of FIGURES) {
      if (/\d\s?(ms|s)$/.test(f.value)) expect(f.kind, f.label).toBe("target");
    }
  });

  it("the note explains both tags, and says neither is a measurement", () => {
    expect(FIGURES_NOTE).toMatch(/TARGET/);
    expect(FIGURES_NOTE).toMatch(/BY DESIGN/);
    expect(FIGURES_NOTE).toMatch(/not measurements|not statistics/);
  });

  it("there is no 'measured' kind: nothing on this page is a measurement", () => {
    expect(Object.keys(FIGURE_TAGS).sort()).toEqual(["design", "target"]);
  });

  it("the hero threshold is the shared constant, not a second copy", () => {
    expect(HERO_EXAMPLE.threshold).toBe(70);
  });
});

describe("the landing SOURCE", () => {
  // Code only. The comments in these files explain what used to be wrong ("LIVE", "Nº
  // 42"), and a scan that flagged its own explanation would force the explanation out.
  const read = (file: string) =>
    fs
      .readFileSync(path.join(process.cwd(), "components", "landing", file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const files = ["Sections.tsx", "VolumeHero.tsx"];

  it("never uses the 'chain paid' or 'alarm' colours: nothing here is real activity", () => {
    // The design reserves green for "the chain paid" and red for the alarm. This page has
    // no chain events, so it uses neither. A green pixel here would be a false statement.
    for (const f of files) {
      expect(read(f), f).not.toMatch(/--positive|--negative/);
    }
  });

  it("never labels anything LIVE", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/\bLIVE\b/);
  });

  it("never names a record number, which on mainnet would be somebody else's matter", () => {
    for (const f of files) {
      // "MATTER Nº <span>0042</span>" was how the hero printed it: markup sits between
      // the label and the number, so check for each part on its own.
      expect(read(f), f).not.toMatch(/MATTER\s+N[º°o]/i);
      expect(read(f), f).not.toMatch(/\b00\d\d\b/);
      expect(read(f), f).not.toMatch(/Nº\s*42|number 42/i);
    }
  });

  it("does not hard-code the launch cap, which lives on-chain and can change", () => {
    expect(read("VolumeHero.tsx")).not.toMatch(/50\.00 USDC/);
  });
});
