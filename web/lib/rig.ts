/**
 * Kinematics and servo motion for the Rubric rigs.
 *
 * Two rigs share this: the ambient mocap skeleton on the landing, and the
 * inspection arm that rules on real clauses on /task/[id]. Both need to move
 * like machinery rather than like a web animation, and that difference is
 * almost entirely in the easing.
 *
 * A CSS ease-in-out is a symmetric cubic. A real servo is not: it accelerates
 * at its torque limit, cruises at its velocity limit, decelerates, and then
 * SETTLES - a small damped oscillation as the control loop kills the last of
 * the error. The settle is the part that reads as "motor", and it is the part
 * every easing library omits, which is why library easing always looks like
 * animation and never like hardware.
 *
 * Everything here is pure and unit-testable. No DOM, no canvas, no time source:
 * callers pass normalised t. That keeps the choreography honest under test, and
 * lets the reduced-motion path evaluate the same functions at t=1 to get the
 * exact terminal pose rather than a hand-authored guess at it.
 */

/** A planar joint chain resolved to angles, in radians. */
export interface ArmPose {
  /** Shoulder angle from +x, counter-clockwise. */
  a1: number;
  /** Elbow angle RELATIVE to the upper link. */
  a2: number;
  /** True when the target was outside the annulus and the arm is reaching at it. */
  clamped: boolean;
}

/**
 * Two-link inverse kinematics by the law of cosines.
 *
 * The reachable set is an annulus: no closer than |l1 - l2| and no further than
 * l1 + l2. A target outside it has NO exact solution, and the honest response is
 * to point the arm at it and report that we clamped - not to silently return
 * NaN, which is what an unguarded acos does, and which propagates into the
 * render as an arm that vanishes from the page with nothing in the console.
 *
 * `elbowUp` picks between the two mirror solutions. Both are valid; the choice
 * is a style decision, and keeping it stable between frames is what stops the
 * elbow flipping through the body mid-traverse.
 */
export function solveIK2(
  x: number,
  y: number,
  l1: number,
  l2: number,
  elbowUp = true
): ArmPose {
  const distance = Math.hypot(x, y);
  const min = Math.abs(l1 - l2);
  const max = l1 + l2;

  // Clamp into the annulus BEFORE the cosine, so the argument to acos is inside
  // [-1, 1] by construction rather than by luck.
  const d = Math.min(Math.max(distance, min + 1e-9), max - 1e-9);
  const clamped = distance > max || distance < min;

  const cosA2 = (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2);
  const a2 = Math.acos(Math.min(1, Math.max(-1, cosA2))) * (elbowUp ? 1 : -1);

  // The angle to the target, less the correction for where the elbow throws the
  // forearm. atan2 covers every quadrant, including the straight-up case that a
  // plain atan divides by zero on.
  const a1 =
    Math.atan2(y, x) - Math.atan2(l2 * Math.sin(a2), l1 + l2 * Math.cos(a2));

  return { a1, a2, clamped };
}

/** Forward kinematics. The tests use it to prove the IK actually lands. */
export function endEffector(
  a1: number,
  a2: number,
  l1: number,
  l2: number
): { x: number; y: number } {
  return {
    x: l1 * Math.cos(a1) + l2 * Math.cos(a1 + a2),
    y: l1 * Math.sin(a1) + l2 * Math.sin(a1 + a2),
  };
}

/**
 * A trapezoidal velocity profile - the motion profile a real motion controller
 * runs, and the reason the rig reads as driven rather than tweened.
 *
 * `ramp` is the fraction of the move spent accelerating, and again
 * decelerating: ramp = 0.5 is a triangular profile with no cruise at all, and
 * ramp approaching 0 approaches a linear move. Returns distance travelled, 0..1.
 *
 * Integrating the velocity ramp gives position - the acceleration phase is
 * quadratic, the cruise linear, the deceleration a mirror of the acceleration.
 * Dividing by the area under the velocity trapezoid normalises the whole move
 * so it lands exactly on 1 for any ramp.
 */
export function trapezoid(t: number, ramp = 0.3): number {
  const u = Math.min(1, Math.max(0, t));
  const r = Math.min(0.5, Math.max(1e-6, ramp));
  const area = 1 - r;

  if (u < r) return (u * u) / (2 * r * area);
  if (u <= 1 - r) return (u - r / 2) / area;
  // Deceleration mirrors acceleration, measured back from the END of the move.
  // Only the residual term is normalised - dividing the whole expression by the
  // area instead overruns the target by 1/(1-r), which for the default ramp is
  // a 43% overshoot that no amount of settle can hide.
  const rem = 1 - u;
  return 1 - (rem * rem) / (2 * r * area);
}

/**
 * The settle: a damped oscillation on top of a completed move.
 *
 * Returns the residual error as a fraction of the move, so a caller adds it to
 * a finished position. It decays to zero, which matters - a rig that never
 * quite stops reads as jitter, not as precision.
 */
export function settle(
  t: number,
  amplitude = 0.02,
  cycles = 2.5,
  damping = 6
): number {
  if (t <= 0) return 0;
  if (t >= 1) return 0;
  return amplitude * Math.exp(-damping * t) * Math.sin(2 * Math.PI * cycles * t);
}

/**
 * A complete servo move: trapezoidal approach, then settle onto the target.
 *
 * The default amplitude is ZERO. A springy settle is what an UNCALIBRATED axis
 * does, and this rig is meant to read as one that has been trimmed - overshoot
 * here would say the opposite of what the product is claiming. `settle` remains
 * available and tested for anything that genuinely wants the bounce; nothing in
 * the rigs asks for it.
 */
export function servo(t: number, ramp = 0.3, amplitude = 0): number {
  const u = Math.min(1, Math.max(0, t));
  return trapezoid(u, ramp) + settle(u, amplitude);
}

/**
 * The ramp time, in milliseconds, shared by every axis in both rigs.
 *
 * This is the whole difference between machinery and a CSS transition, and it
 * is worth being precise about. A cubic-bezier scales its ENTIRE curve with the
 * duration, so a long move and a short move are the same shape played at
 * different speeds. A motion controller does not work that way: acceleration is
 * bounded by torque, which is a property of the motor and not of the move, so
 * the ramp lasts the same number of milliseconds however far the axis is going.
 * A long move therefore gets a longer flat CRUISE, not a lazier curve.
 *
 * That single property is what the eye reads as "driven".
 */
export const RAMP_MS = 70;

/**
 * A servo move expressed in real time rather than normalised t.
 *
 * Converts a fixed millisecond ramp into the fractional ramp `trapezoid` wants.
 * The `dur / 2` clamp keeps short moves valid: below 2x the ramp there is no
 * room for a cruise, and the profile degenerates to triangular, which is the
 * correct shape for a snap.
 *
 * At RAMP_MS = 70 the cruise fraction runs: 620ms -> 77%, 520ms -> 73%,
 * 320ms -> 56%, 220ms -> 36%, and anything at or under 140ms -> 0%.
 */
export function servoMs(elapsed: number, dur: number, ramp = RAMP_MS): number {
  if (dur <= 0) return 1;
  const t = Math.min(1, Math.max(0, elapsed / dur));
  return trapezoid(t, Math.min(ramp, dur / 2) / dur);
}

/** Degrees, for the telemetry readout. Rigs think in radians; operators do not. */
export const deg = (radians: number): number => (radians * 180) / Math.PI;
