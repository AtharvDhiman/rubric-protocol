import { describe, it, expect } from "vitest";

import {
  solveIK2,
  endEffector,
  trapezoid,
  settle,
  servo,
  servoMs,
  RAMP_MS,
  deg,
} from "./rig";

/**
 * The rigs are decorative, but wrong kinematics are not a cosmetic bug: an
 * unguarded acos returns NaN, NaN propagates into an SVG transform, and the
 * whole arm disappears from the page with nothing in the console. These tests
 * exist to make that failure loud here rather than silent in a browser.
 */

const L1 = 120;
const L2 = 90;

describe("solveIK2", () => {
  it("lands the end effector on reachable targets", () => {
    // Sweep the annulus rather than trusting one lucky point.
    for (const angle of [0, 0.4, 1.1, 2.0, -0.7, -2.4, 3.0]) {
      for (const r of [40, 80, 150, 205]) {
        const x = r * Math.cos(angle);
        const y = r * Math.sin(angle);
        const { a1, a2, clamped } = solveIK2(x, y, L1, L2);
        expect(clamped).toBe(false);
        const hit = endEffector(a1, a2, L1, L2);
        expect(hit.x).toBeCloseTo(x, 4);
        expect(hit.y).toBeCloseTo(y, 4);
      }
    }
  });

  it("never returns NaN, including at the singularities", () => {
    // Fully extended, fully folded, dead centre, and far outside reach: the
    // four inputs that break a naive implementation.
    const cases: Array<[number, number]> = [
      [L1 + L2, 0],
      [Math.abs(L1 - L2), 0],
      [0, 0],
      [9999, 9999],
      [-9999, 0],
    ];
    for (const [x, y] of cases) {
      const { a1, a2 } = solveIK2(x, y, L1, L2);
      expect(Number.isFinite(a1)).toBe(true);
      expect(Number.isFinite(a2)).toBe(true);
    }
  });

  it("reports clamping instead of pretending it reached", () => {
    expect(solveIK2(500, 0, L1, L2).clamped).toBe(true);
    expect(solveIK2(1, 0, L1, L2).clamped).toBe(true);
    expect(solveIK2(150, 0, L1, L2).clamped).toBe(false);
  });

  it("mirrors the elbow without moving the hand", () => {
    const up = solveIK2(140, 60, L1, L2, true);
    const down = solveIK2(140, 60, L1, L2, false);
    expect(up.a2).toBeCloseTo(-down.a2, 6);
    const a = endEffector(up.a1, up.a2, L1, L2);
    const b = endEffector(down.a1, down.a2, L1, L2);
    expect(a.x).toBeCloseTo(b.x, 4);
    expect(a.y).toBeCloseTo(b.y, 4);
  });
});

describe("trapezoid", () => {
  it("runs from 0 to exactly 1", () => {
    expect(trapezoid(0)).toBeCloseTo(0, 9);
    expect(trapezoid(1)).toBeCloseTo(1, 9);
  });

  it("never goes backwards", () => {
    let last = -1;
    for (let i = 0; i <= 200; i++) {
      const v = trapezoid(i / 200);
      expect(v).toBeGreaterThanOrEqual(last - 1e-12);
      last = v;
    }
  });

  it("actually cruises: mid-move velocity is constant", () => {
    // This is the signature of a trapezoid rather than a cubic. Sample the
    // derivative across the cruise band and require it flat.
    const h = 1e-4;
    const speeds = [0.45, 0.5, 0.55].map(
      (t) => (trapezoid(t + h) - trapezoid(t - h)) / (2 * h)
    );
    for (const s of speeds) expect(s).toBeCloseTo(speeds[0], 6);
  });

  it("starts and ends slower than it cruises", () => {
    const h = 1e-4;
    const v = (t: number) => (trapezoid(t + h) - trapezoid(t - h)) / (2 * h);
    expect(v(0.02)).toBeLessThan(v(0.5));
    expect(v(0.98)).toBeLessThan(v(0.5));
  });

  it("degenerates sanely at both extremes of ramp", () => {
    expect(trapezoid(0.5, 0.5)).toBeCloseTo(0.5, 6); // triangular
    expect(trapezoid(0.5, 1e-9)).toBeCloseTo(0.5, 4); // effectively linear
  });
});

describe("settle", () => {
  it("is zero at both ends, so it cannot leave a standing offset", () => {
    expect(settle(0)).toBe(0);
    expect(settle(1)).toBe(0);
  });

  it("decays", () => {
    expect(Math.abs(settle(0.08))).toBeGreaterThan(Math.abs(settle(0.75)));
  });

  it("overshoots - it must cross the target, not creep onto it", () => {
    let sawPositive = false;
    let sawNegative = false;
    for (let i = 1; i < 100; i++) {
      const v = settle(i / 100);
      if (v > 1e-6) sawPositive = true;
      if (v < -1e-6) sawNegative = true;
    }
    expect(sawPositive && sawNegative).toBe(true);
  });
});

describe("servo", () => {
  it("ends exactly on target", () => {
    expect(servo(1)).toBeCloseTo(1, 9);
  });

  it("stays in bounds, so a rig cannot fly off-canvas mid-settle", () => {
    for (let i = 0; i <= 300; i++) {
      const v = servo(i / 300);
      expect(v).toBeGreaterThan(-0.1);
      expect(v).toBeLessThan(1.1);
    }
  });

  it("does not overshoot at its defaults - a trimmed axis, not a springy one", () => {
    // The default amplitude is 0 on purpose. If someone restores the bounce,
    // this fails, and the comment above servo() explains why that is wrong.
    for (let i = 0; i <= 400; i++) {
      expect(servo(i / 400)).toBeLessThanOrEqual(1);
    }
  });
});

describe("servoMs", () => {
  it("runs 0 to 1 over the stated duration and holds after", () => {
    expect(servoMs(0, 620)).toBeCloseTo(0, 9);
    expect(servoMs(620, 620)).toBeCloseTo(1, 9);
    expect(servoMs(9999, 620)).toBeCloseTo(1, 9);
    expect(servoMs(-50, 620)).toBeCloseTo(0, 9);
  });

  it("keeps the ramp fixed in TIME, so a longer move gets a longer cruise", () => {
    // This is the property that separates a motion controller from a bezier,
    // so it is asserted directly rather than trusted. Measure the fraction of
    // each move spent at (near) peak velocity.
    const cruiseFraction = (dur: number) => {
      const h = 0.5;
      const speeds: number[] = [];
      for (let ms = h; ms < dur - h; ms += 1) {
        speeds.push((servoMs(ms + h, dur) - servoMs(ms - h, dur)) / (2 * h));
      }
      const peak = Math.max(...speeds);
      return speeds.filter((s) => s > peak * 0.999).length / speeds.length;
    };
    const short = cruiseFraction(320);
    const long = cruiseFraction(620);
    expect(long).toBeGreaterThan(short);
    // And the ramp itself is the SAME wall-clock length in both.
    expect(long).toBeGreaterThan(0.7);
    expect(short).toBeLessThan(0.65);
  });

  it("degenerates to a triangular snap when there is no room to cruise", () => {
    // At or under 2x the ramp there is no plateau, which is correct for a snap.
    const dur = RAMP_MS * 2;
    const h = 0.5;
    const speeds: number[] = [];
    for (let ms = h; ms < dur - h; ms += 1) {
      speeds.push((servoMs(ms + h, dur) - servoMs(ms - h, dur)) / (2 * h));
    }
    const peak = Math.max(...speeds);
    const flat = speeds.filter((s) => s > peak * 0.999).length / speeds.length;
    expect(flat).toBeLessThan(0.1);
    expect(servoMs(dur, dur)).toBeCloseTo(1, 9);
  });

  it("survives a zero or negative duration instead of dividing by it", () => {
    expect(servoMs(10, 0)).toBe(1);
    expect(servoMs(10, -5)).toBe(1);
  });
});

describe("deg", () => {
  it("converts for the telemetry readout", () => {
    expect(deg(Math.PI)).toBeCloseTo(180, 9);
    expect(deg(-Math.PI / 2)).toBeCloseTo(-90, 9);
  });
});
