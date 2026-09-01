import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ARM_STATES,
  NOT_MEASURED,
  armCells,
  formatAngle,
  formatCycle,
  formatFrame,
  formatLoad,
  formatRatio,
  formatResidual,
  formatSolve,
  skeletonCells,
  type ArmTelemetryValues,
  type Cell,
  type SkeletonTelemetryValues,
} from "./Telemetry";

/**
 * The telemetry strip, enforced by machine.
 *
 * Three separate things are being defended here, and none of them survives on
 * review discipline alone:
 *
 * 1. PRECISION. Decimals shown = decimals actually measured. It is a one-token
 *    edit to print a confidence as 0.94 or a load to three places, and the
 *    result looks MORE precise, so nobody flags it in a diff.
 *
 * 2. NO FABRICATED FACTS. The readout must not state a physical measurement
 *    about a room or a machine that does not exist. Four such cells were
 *    deleted from an earlier draft; the source scan at the bottom is what stops
 *    them coming back, because "it looked good in the mock" is a persuasive
 *    argument and a comment saying "do not re-add" is not an obstacle.
 *
 * 3. THE WIDTH BUDGETS. Cells are fixed width and clip rather than reflow, so
 *    an under-budgeted cell does not throw an error - it quietly cuts the end
 *    off a figure, which is the single worst failure this component can have.
 *    Every budget is checked against the widest string the cell can hold.
 */

const SOURCE = readFileSync(join(process.cwd(), "components", "rig", "Telemetry.tsx"), "utf8");
const STYLES = readFileSync(
  join(process.cwd(), "components", "rig", "Telemetry.module.css"),
  "utf8"
);

/**
 * The same files with their comments removed.
 *
 * The scans below have to run against CODE and not against prose. This
 * component's comments necessarily NAME the four deleted cells and the
 * volume-only tokens, because that is how a future editor learns why they are
 * absent - and a naive substring search would flag the explanation as the
 * offence and push the next person to delete the explanation instead of
 * keeping the rule. The explanation is allowed; the cell is not.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments, both languages
    .replace(/(^|\s)\/\/.*$/gm, " "); // line comments, TypeScript only
}

const CODE = stripComments(SOURCE);
const CSS = stripComments(STYLES);

/** The terminal LOCKED figures the spec prints for the landing rig. */
const LANDING: SkeletonTelemetryValues = {
  residualMm: 0.41,
  raysLive: 8,
  raysTotal: 8,
  markersLive: 21,
  markersTotal: 21,
  solve: 96,
  frame: 1482,
};

/** The arm mid-traverse, as the spec prints it. */
const ARM: ArmTelemetryValues = {
  j1Deg: -34,
  j2Deg: 71.5,
  load: 0.18,
  cycle: 3,
  cycleTotal: 7,
  state: "TRAVERSE",
};

const line = (cells: Cell[]): string =>
  cells.map((c) => `${c.label} ${c.value}`).join("   ");

describe("the printed strips", () => {
  it("prints the landing readout exactly as specified", () => {
    expect(line(skeletonCells(LANDING))).toBe(
      "RESIDUAL 0.41 mm   RAYS 8/8   MARKERS 21/21   SOLVE 96   FRAME 001482"
    );
  });

  it("prints the arm readout exactly as specified", () => {
    expect(line(armCells(ARM))).toBe(
      "J1 -34.0°   J2 +71.5°   LOAD 0.18   CYCLE 03/07   STATE TRAVERSE"
    );
  });

  it("prints the idle arm as a cycle of zero, not as an empty strip", () => {
    // Nº 43 and Nº 44 have no verdict. Nothing has been measured, and the
    // readout has to say so rather than showing a plausible-looking pose.
    const idle = line(armCells({ ...ARM, cycle: 0, cycleTotal: 3, state: "IDLE" }));
    expect(idle).toContain("CYCLE 00/03");
    expect(idle).toContain("STATE IDLE");
  });
});

describe("precision", () => {
  it("gives the residual two decimals and the unit on the value", () => {
    expect(formatResidual(3.4249)).toBe("3.42 mm");
    expect(formatResidual(0.41)).toBe("0.41 mm");
    // Not "0.4 mm" and not "0.410 mm": two places, always.
    expect(formatResidual(0.4)).toBe("0.40 mm");
  });

  it("gives solve an integer, because that is what is measured", () => {
    expect(formatSolve(96)).toBe("96");
    expect(formatSolve(95.6)).toBe("96");
    expect(formatSolve(96)).not.toContain(".");
  });

  it("does not clamp a solve outside 0..100", () => {
    // A quality of 103 is a bug in the phase machine. Pinning it to 100 in the
    // readout would hide the fault instead of reporting it.
    expect(formatSolve(103)).toBe("103");
    expect(formatSolve(-4)).toBe("-4");
  });

  it("gives joint angles one decimal and an explicit sign", () => {
    expect(formatAngle(-34)).toBe("-34.0°");
    expect(formatAngle(71.47)).toBe("+71.5°");
    // The + is what keeps the field a constant width through zero.
    expect(formatAngle(0)).toBe("+0.0°");
  });

  it("gives load two decimals and reads exactly zero in a dwell", () => {
    expect(formatLoad(0.1804)).toBe("0.18");
    expect(formatLoad(0)).toBe("0.00");
  });

  it("never prints a negative zero", () => {
    // -0.04 rounds to -0.0 through a naive toFixed, which looks like a broken
    // sign on an axis that is simply at rest.
    expect(formatAngle(-0.04)).toBe("+0.0°");
    expect(formatLoad(-0.001)).toBe("0.00");
    expect(formatResidual(-0.002)).toBe("0.00 mm");
  });
});

describe("wrapping and padding", () => {
  it("wraps joint angles into [-180, 180)", () => {
    // solveIK2 returns a1 as a difference of two atan2 results and can land
    // outside a turn. -287.3 and +72.7 are the same orientation.
    expect(formatAngle(-287.3)).toBe("+72.7°");
    expect(formatAngle(400)).toBe("+40.0°");
    // The interval is half-open, so straight back has exactly one name and the
    // readout cannot flicker between two spellings of the same orientation.
    expect(formatAngle(180)).toBe("-180.0°");
    expect(formatAngle(-180)).toBe("-180.0°");
    expect(formatAngle(-540)).toBe("-180.0°");
  });

  it("zero-pads the frame to six digits", () => {
    expect(formatFrame(1482)).toBe("001482");
    expect(formatFrame(0)).toBe("000000");
    // A frame count is elapsed time; it cannot be negative.
    expect(formatFrame(-3)).toBe("000000");
  });

  it("zero-pads both halves of the cycle to the same width", () => {
    expect(formatCycle(3, 7)).toBe("03/07");
    expect(formatCycle(0, 3)).toBe("00/03");
    expect(formatCycle(3, 12)).toBe("03/12");
    expect(formatCycle(3, 120)).toBe("003/120");
  });

  it("does not pad the live/total ratios", () => {
    // 08/08 would imply a two-digit camera count that does not exist.
    expect(formatRatio(8, 8)).toBe("8/8");
    expect(formatRatio(21, 21)).toBe("21/21");
    expect(formatRatio(17, 21)).toBe("17/21");
  });
});

describe("a missing measurement is never printed as a number", () => {
  const bad = [NaN, Infinity, -Infinity];

  it("prints the not-measured mark rather than NaN or a plausible zero", () => {
    for (const n of bad) {
      expect(formatResidual(n)).toBe(NOT_MEASURED);
      expect(formatSolve(n)).toBe(NOT_MEASURED);
      expect(formatFrame(n)).toBe(NOT_MEASURED);
      expect(formatAngle(n)).toBe(NOT_MEASURED);
      expect(formatLoad(n)).toBe(NOT_MEASURED);
      expect(formatRatio(n, 8)).toBe(NOT_MEASURED);
      expect(formatCycle(1, n)).toBe(NOT_MEASURED);
    }
  });

  it("never lets NaN reach the strip as text", () => {
    const cells = [
      ...skeletonCells({
        residualMm: NaN,
        raysLive: NaN,
        raysTotal: 8,
        markersLive: 21,
        markersTotal: NaN,
        solve: NaN,
        frame: NaN,
      }),
      ...armCells({ j1Deg: NaN, j2Deg: NaN, load: NaN, cycle: NaN, cycleTotal: NaN, state: "OUT-OF-ENVELOPE" }),
    ];
    for (const cell of cells) {
      expect(cell.value.toLowerCase()).not.toContain("nan");
      expect(cell.value.toLowerCase()).not.toContain("infinity");
    }
  });
});

describe("fixed width budgets", () => {
  /**
   * The widest string each cell can ever hold. If a cell's declared budget is
   * smaller than this, the stylesheet clips a real figure and nobody finds out
   * until somebody squints at a screenshot.
   */
  function widest(cell: Cell, value: string): void {
    const printed = `${cell.label} ${value}`;
    expect(
      printed.length,
      `cell "${cell.id}" budgets ${cell.chars} chars but must hold "${printed}" (${printed.length})`
    ).toBeLessThanOrEqual(cell.chars);
  }

  it("budgets every landing cell for its widest value", () => {
    const cells = skeletonCells(LANDING);
    const by = (id: string) => cells.find((c) => c.id === id)!;

    // A residual in the low tens, which DRIFT can reach before the solve lands.
    widest(by("residual"), formatResidual(12.34));
    widest(by("residual"), NOT_MEASURED);
    // Two digits either side of the slash.
    widest(by("rays"), formatRatio(88, 88));
    widest(by("markers"), formatRatio(88, 88));
    widest(by("solve"), formatSolve(100));
    widest(by("solve"), NOT_MEASURED);
    // Six padded digits plus one more, so a long-lived page cannot clip itself.
    widest(by("frame"), formatFrame(9999999));
  });

  it("budgets every arm cell for its widest value", () => {
    const cells = armCells(ARM);
    const by = (id: string) => cells.find((c) => c.id === id)!;

    widest(by("j1"), formatAngle(-179.95));
    widest(by("j2"), formatAngle(-179.95));
    widest(by("load"), formatLoad(1));
    widest(by("load"), NOT_MEASURED);
    widest(by("cycle"), formatCycle(888, 888));

    // Every declared state, not just the current one. OUT-OF-ENVELOPE is the
    // longest, and it is the one case where clipping would be worst: it is the
    // rig admitting it cannot reach the target.
    for (const state of ARM_STATES) {
      widest(by("state"), state);
    }
  });

  it("declares the per-character constant exactly once", () => {
    // Risk 2 in the spec: if this width ever has to move, it must be one edit.
    const declarations = STYLES.match(/--tele-ch\s*:/g) ?? [];
    expect(declarations).toHaveLength(1);
  });

  it("clips rather than ellipsising", () => {
    // A truncated residual is worse than a clipped one: an ellipsis says there
    // is more without saying how much, so a clipped figure cannot be told
    // apart from a rounded one.
    expect(STYLES).toContain("text-overflow: clip");
    expect(STYLES).not.toContain("ellipsis;");
  });
});

describe("the readout states no fact that is not real", () => {
  /**
   * Four cells were deleted from the source direction because each asserts a
   * physical measurement about a room or a machine that does not exist, inside
   * the same mono strip as the confidence score and the escrow amount. On a
   * product whose pitch is "pay on proof, not on trust", a readout that is
   * right about five figures and costume about four more is not partly
   * trustworthy - the reader cannot tell which is which.
   *
   * They are matched against comment-stripped code, so the words may still
   * appear in the prose above explaining why they are gone.
   */
  const FABRICATED: [RegExp, string][] = [
    [/\bVOL\b/, "VOL 6.0 x 6.0 x 3.0 m - a room that does not exist"],
    [/\bRIG 0?\d\b/, "RIG 01 - a serial number for a machine that does not exist"],
    [/\bFEED\b/, "FEED 12 mm/s - a feed rate for an SVG that cuts nothing"],
    [/\bPROBE Z\b/, "PROBE Z - a height above a surface that is not there"],
  ];

  it("contains none of the deleted cells", () => {
    for (const [pattern, why] of FABRICATED) {
      expect(CODE, `deleted on purpose: ${why}`).not.toMatch(pattern);
    }
  });

  it("prints no key beyond the ten that name a real quantity", () => {
    // The complementary check: the scan above catches the four known offenders
    // by name, this one catches a fifth nobody has thought of yet.
    const printed = [...skeletonCells(LANDING), ...armCells(ARM)].map((c) => c.label);
    expect(printed).toEqual([
      "RESIDUAL",
      "RAYS",
      "MARKERS",
      "SOLVE",
      "FRAME",
      "J1",
      "J2",
      "LOAD",
      "CYCLE",
      "STATE",
    ]);
  });

  it("prints no unit that is not attached to a measured quantity", () => {
    // mm and ° are the only units in the strip, and both belong to a figure the
    // simulation actually computes: the residual is an RMS offset, the angles
    // come out of deg() on the live pose.
    const units = line(skeletonCells(LANDING)) + line(armCells(ARM));
    expect(units).toContain(" mm");
    expect(units).toContain("°");
    expect(units).not.toContain("mm/s");
    expect(units).not.toMatch(/\bm\b(?!m)/);
  });
});

describe("colour is never named directly", () => {
  it("uses no hex literal anywhere in the component or its stylesheet", () => {
    // Every ink is a semantic token that the .volume scope in globals.css
    // redefines to the dark set. Naming a colour here - especially --marker,
    // which measures 1.26:1 on --page - is how a volume ink ends up on a light
    // ground, which is the exact bug class this project spent a session
    // eliminating.
    expect(CODE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("names no volume-only token, so none can leak onto a light ground", () => {
    const volumeOnly = [
      "--marker",
      "--rig-line",
      "--rig-solved",
      "--v-positive",
      "--v-negative",
      "--v-warning",
      "--ghost-vol",
      "--grid",
      "--d-",
    ];
    for (const token of volumeOnly) {
      expect(CSS, `${token} must not be named outside a .volume`).not.toContain(token);
      expect(CODE, `${token} must not be named outside a .volume`).not.toContain(token);
    }
  });
});
