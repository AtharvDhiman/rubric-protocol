"use client";

/**
 * THE INSPECTION ARM — the gutter rig on /task/[id].
 *
 * A gantry, not a fixed-base armature: a 1px vertical rail with a 9px carriage
 * block travelling it (the prismatic axis), and from that carriage a two-link
 * arm (L1 = 34px, L2 = 26px) ending in a 3px probe tip. The carriage does all
 * the vertical work; the arm only has to cross the gutter. That is what makes
 * the geometry fit: elbow x never exceeds rail + L1 = 46px inside a 64px
 * gutter, so nothing is clipped and nothing crosses the reading column.
 *
 * It is measuring something real. The targets are the datum dots beside the
 * SEALED CLAUSE rows the judge actually ruled on, and the probe comes to rest
 * on the clause that blocked the escrow. The citation is a coordinate.
 *
 * WHAT MAKES THIS SAFE TO SHIP (all four are load-bearing, none are polish)
 * ------------------------------------------------------------------------
 * 1. THE SERVER RENDERS THE FINISHED RUN. Every attribute in the JSX below is
 *    the TERMINAL frame, computed by the same `frameAt` the animation uses. The
 *    client rewinds to frame zero in a setTimeout(..., 0) after mount. So the
 *    completed inspection is what exists in the HTML, what a crawler sees, what
 *    renders with JS blocked, and what survives a hydration failure. The
 *    animation is a REWIND OF A COMPLETE DOCUMENT, never a build-up toward one.
 * 2. REDUCED MOTION IS CHECKED BEFORE THE FIRST FRAME IS SCHEDULED, so no rAF
 *    work is ever queued. The still frame is the same render function at the
 *    terminal state, not a separate fallback path.
 * 3. THE LOOP NEVER CALLS setState. It mutates SVG attributes through refs.
 *    React renders this component a handful of times in its life: mount,
 *    measurement, and a resize.
 * 4. IT ADMITS WHAT IT CANNOT DO. If `solveIK2` reports the target is outside
 *    the arm's annulus, the telemetry says OUT-OF-ENVELOPE and the rig drops to
 *    the 28px track rail rather than pointing confidently at nothing. That is
 *    the same code path as the mobile rig, so the failure path is exercised
 *    every time anyone opens this page on a phone.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { deg, endEffector, servoMs, solveIK2, type ArmPose } from "@/lib/rig";

/* ==========================================================================
   PUBLIC API
   ========================================================================== */

/** The five states a record can actually be in. There is no sixth. */
export type ArmRecordState =
  | "OPEN"
  | "SUBMITTED"
  | "HELD"
  | "SETTLED"
  | "REFUNDED";

/**
 * One clause ruling, exactly as `ClauseRulingSchema` returns it. `reasoning` is
 * not needed here - the arm draws the boolean, the table prints the prose.
 */
export interface ArmRuling {
  index: number;
  passed: boolean;
}

export interface InspectionArmProps {
  /**
   * The id of the sealed-clause `<ol>`. The arm measures the `[data-clause-index]`
   * rows inside it and parks on their vertical centres, so the probe touches the
   * datum dot of the row it is ruling on rather than a guessed offset.
   */
  listId: string;
  /** How many clauses were sealed. Drives CYCLE nn/nn even when nothing was ruled. */
  clauseCount: number;
  /** The per-clause rulings, or null/empty when no verdict exists yet. */
  rulings?: readonly ArmRuling[] | null;
  /** The record state. HELD is not REFUNDED and must never stamp as one. */
  state: ArmRecordState;
  /**
   * Optional id of the Σ OUTTOL row, so an all-pass run parks exactly on it.
   * Without it the arm parks at the foot of the rail, which is where that row
   * sits anyway.
   */
  sigmaRowId?: string;
  /**
   * Fires once per row as its STATUS cell registers, and again from frame zero
   * on a rewind. At most one call per row per run - this is a beat, not a frame,
   * so a parent may safely setState from it.
   */
  onRegister?: (index: number, passed: boolean) => void;
  /** Fires when the completed run is rewound to frame zero. */
  onRewind?: () => void;
}

/* ==========================================================================
   GEOMETRY CONSTANTS

   Pixels, in the SVG's own coordinate system, which is 1:1 with CSS pixels -
   the SVG is sized in px and its viewBox matches, so no scaling happens and a
   1px rule is a 1px rule.
   ========================================================================== */

/** Upper link and forearm. Fixed: these are the arm, not a style choice. */
const L1 = 34;
const L2 = 26;

/** The carriage block that travels the rail. */
const CARRIAGE = 9;

/** Where the carriage sits before the first measurement. */
const HOME_Y = 8;

/**
 * The folded pose, as a target relative to the carriage. Distance 8.94px, just
 * outside the annulus floor of |L1 - L2| = 8, so the links are nearly doubled
 * back on themselves - which is what "folded" looks like on a real arm, and is
 * a legal IK solution rather than a hand-drawn special case.
 */
const FOLD_DX = 8;
const FOLD_DY = -4;

/** The 64px gutter, and the 28px track it collapses to. */
const GUTTER_DEFAULT = 64;
const TRACK_WIDTH = 28;

/** Layout inside the 64px gutter: rail, probe stand-off, flag column. */
const ARM_RAIL_X = 12;
const ARM_TIP_INSET = 8;
const ARM_FLAG_X = 2;

/**
 * Layout inside the 28px track. The rail moves right and the flag column moves
 * hard left so a 4px flag and a 9px carriage never overlap: carriage spans
 * 5.5..14.5, flag spans 0..4.
 */
const TRACK_RAIL_X = 10;
const TRACK_DATUM_X = 22;
const TRACK_FLAG_X = 0;

/** Marker radii. Constant - radius never encodes importance. */
const DATUM_R = 2.5;
const TIP_R = 1.5;
const FLAG = 4;

/**
 * The reach the arm needs before an articulated solve is worth drawing. Below
 * |L1 - L2| the target is inside the annulus hole and `solveIK2` clamps; the
 * +4 is margin, because a solve that lands exactly on the boundary draws both
 * links collinear and reads as a broken arm rather than a folded one.
 *
 * This is NOT the whole envelope test - see `buildGeom`. A short reach folds the
 * arm up, and a folded two-link arm throws its ELBOW outward: at dx = 14 the
 * solve is perfectly valid and reports clamped = false, but the elbow lands at
 * x = 36 in a 34px gutter and gets clipped by the strip edge. The elbow has to
 * be checked directly.
 */
const MIN_REACH = Math.abs(L1 - L2) + 4;

/** Row height assumed before the real clause list has been measured. */
const ROW_H_FALLBACK = 72;

/* ==========================================================================
   THE BEATS

   Every beat runs on `servoMs`, so the ramp is a fixed 70ms at both ends and a
   long move gets a longer CRUISE rather than a lazier curve. That single
   property is what reads as driven rather than tweened.

   ON THE 620ms CYCLE IN THE SPEC. The spec heads this section "per-clause cycle
   620ms" and then lists TRAVERSE 520 / DESCEND 140 / DWELL 140 / REGISTER 220 /
   RETRACT 140, which sum to 1160. Those two numbers cannot both be honoured, so
   here is the resolution and why it is this one rather than shortening a beat.
   The first three beats CANNOT overlap: the carriage has to be stationary while
   the probe is on the datum, or the drawing is lying about a measurement. That
   floor is 520 + 140 + 140 = 800ms. The two beats that CAN overlap are exactly
   the two the spec itself describes as overlapping - RETRACT is written as "arm
   folds, CARRIAGE CONTINUES", and REGISTER writes a table cell, which is not an
   arm motion at all. So both are lane-overlapped onto the next row's traverse,
   every stated beat duration survives at full length, and the period lands at
   800ms: as close to 620 as a single carriage can physically get.
   ========================================================================== */

const TRAVERSE_MS = 520;
const DESCEND_MS = 140;
const DWELL_MS = 140;
/** A failing row is looked at for three times as long. Doubling is generous. */
const DWELL_FAIL_MS = 420;
const REGISTER_MS = 220;
const RETRACT_MS = 140;
/** The drive to the Σ row, or back up to the first flagged clause. */
const PARK_MS = 700;
/** The stamp press: scale 1.25 -> 1.00, no overshoot. */
const STAMP_MS = 380;

/**
 * The hard stop. If rAF has been throttled, starved or descheduled, this fires
 * and force-completes every row regardless. A verdict sheet must never be left
 * half-resolved in front of someone asking whether they got paid.
 */
const WATCHDOG_MS = 6000;

/**
 * The declared maximum axis speed, in px per ms, that LOAD is normalised
 * against. LOAD is the normalised derivative of `servoMs` scaled by the actual
 * distance of the move, so it peaks on the cruise, tapers on the ramps, and
 * reads exactly 0.00 during a dwell - which is true of a real axis, and is the
 * whole reason this readout is defensible where a fabricated mm/s feed is not.
 */
const MAX_AXIS_PX_PER_MS = 0.5;

/* ==========================================================================
   TIMELINE

   Pure timing, deliberately free of geometry: the plan can be built from props
   alone and never needs re-deriving on a resize.
   ========================================================================== */

interface RowPlan {
  /** Clause index, 0-based. */
  index: number;
  passed: boolean;
  /** When the traverse toward this row begins. */
  startMs: number;
  /** When the dwell ends and the STATUS cell registers. */
  endMs: number;
}

type StampWord = "APPROVED" | "REJECTED" | "HELD";

interface Plan {
  rows: RowPlan[];
  /** Total clauses sealed - the CYCLE denominator, even with no verdict. */
  total: number;
  /** True when no verdict exists: nothing has been measured, so nothing moves. */
  idle: boolean;
  /** True when the escrow is untouched and the stamp may not say REJECTED. */
  held: boolean;
  parkStartMs: number;
  parkEndMs: number;
  stampEndMs: number;
  totalMs: number;
  /** The row to park on, or null to park at the Σ row on an all-pass run. */
  parkIndex: number | null;
  stampWord: StampWord | null;
  /** Clause indices that failed, in order. Flags are left at these rows. */
  failed: number[];
}

function buildPlan(
  clauseCount: number,
  rulings: readonly ArmRuling[] | null | undefined,
  state: ArmRecordState
): Plan {
  const held = state === "HELD";
  const count = Math.max(0, Math.floor(clauseCount));

  // OPEN and SUBMITTED have no verdict. Neither does anything else whose
  // rulings never arrived. Animating a measurement that never happened would be
  // the one lie this whole design exists to avoid, so the arm sits at home.
  const hasVerdict = !!rulings && rulings.length > 0 && count > 0;
  if (!hasVerdict) {
    return {
      rows: [],
      total: count,
      idle: true,
      held,
      parkStartMs: 0,
      parkEndMs: 0,
      stampEndMs: 0,
      totalMs: 0,
      parkIndex: null,
      stampWord: null,
      failed: [],
    };
  }

  const byIndex = new Map<number, ArmRuling>();
  for (const r of rulings) byIndex.set(r.index, r);

  // EVERY clause is inspected, including the ones after the first failure. The
  // judge ruled on all of them; stopping at the first fail would leave a row
  // reading "--" forever, which is a false unresolved state.
  const rows: RowPlan[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const passed = byIndex.get(i)?.passed ?? true;
    const dwell = passed ? DWELL_MS : DWELL_FAIL_MS;
    const startMs = cursor;
    const endMs = startMs + TRAVERSE_MS + DESCEND_MS + dwell;
    rows.push({ index: i, passed, startMs, endMs });
    cursor = endMs;
  }

  const failed = rows.filter((r) => !r.passed).map((r) => r.index);

  // The tail: the last row still has to finish registering before the arm is
  // free to park. REGISTER outlasts RETRACT, so it sets the tail length.
  const parkStartMs = cursor + REGISTER_MS;
  const parkEndMs = parkStartMs + PARK_MS;
  const stampEndMs = parkEndMs + STAMP_MS;

  return {
    rows,
    total: count,
    idle: false,
    held,
    parkStartMs,
    parkEndMs,
    stampEndMs,
    totalMs: stampEndMs,
    // On a clean run the arm parks at the Σ row - the consequence line. With
    // any failure it drives BACK UP to the FIRST flagged row, because that is
    // the clause that blocked the release and the stamp lands beside it.
    parkIndex: failed.length > 0 ? failed[0] : null,
    stampWord: held ? "HELD" : failed.length > 0 ? "REJECTED" : "APPROVED",
    failed,
  };
}

/* ==========================================================================
   GEOMETRY
   ========================================================================== */

interface Geom {
  mode: "arm" | "track";
  /** True only when the IK genuinely could not reach, never on the mobile path. */
  outOfEnvelope: boolean;
  width: number;
  height: number;
  /** Distance from the component's top edge down to the clause list's top edge. */
  offsetTop: number;
  railX: number;
  datumX: number;
  flagX: number;
  /** Vertical centre of each clause row, in SVG coordinates. */
  rowY: number[];
  sigmaY: number;
  fold: ArmPose;
  reach: ArmPose;
  /** How far the tip travels between folded and extended - the LOAD distance. */
  reachDist: number;
}

/** Straight-line distance the tip covers between two poses. */
function tipTravel(a: ArmPose, b: ArmPose): number {
  const p = endEffector(a.a1, a.a2, L1, L2);
  const q = endEffector(b.a1, b.a2, L1, L2);
  return Math.hypot(q.x - p.x, q.y - p.y);
}

/**
 * Build the geometry for a given gutter width and set of row centres.
 *
 * The envelope test lives here and nowhere else: reach is derived from the
 * MEASURED gutter width, so a gutter that has collapsed produces a target the
 * arm cannot honestly draw and the whole rig switches to the track rail. The
 * mobile path and the failure path are the same code.
 *
 * Measured, by sweeping every integer width from 64 down to 26: the articulated
 * arm holds down to a 36px gutter and drops to the track at 35px and below. At
 * the two widths that actually ship - 64px and 28px - the result is the arm and
 * the track respectively, which is the intended behaviour rather than a
 * coincidence of the thresholds.
 */
function buildGeom(
  widthRaw: number,
  height: number,
  offsetTop: number,
  rowY: number[],
  sigmaY: number,
  forceTrack: boolean
): Geom {
  const width = widthRaw > 1 ? widthRaw : GUTTER_DEFAULT;
  const reachDx = width - ARM_RAIL_X - ARM_TIP_INSET;
  const reach = solveIK2(reachDx, 0, L1, L2, true);
  const fold = solveIK2(FOLD_DX, FOLD_DY, L1, L2, true);

  // Where the elbow sits in each of the two poses the arm interpolates between.
  // a1 runs monotonically between them and cosine is monotonic across that
  // range, so the widest the elbow ever gets is one of these two endpoints -
  // no need to sample the path.
  const elbowMax = Math.max(
    ARM_RAIL_X + L1 * Math.cos(reach.a1),
    ARM_RAIL_X + L1 * Math.cos(fold.a1)
  );

  const outOfEnvelope =
    reach.clamped || reachDx < MIN_REACH || elbowMax > width - 1;
  const track = forceTrack || outOfEnvelope;

  return {
    mode: track ? "track" : "arm",
    // The mobile rig is not a failure, so it does not claim to be one. Only a
    // genuine clamp sets this, and only this sets STATE OUT-OF-ENVELOPE.
    outOfEnvelope,
    width: track ? TRACK_WIDTH : width,
    height,
    offsetTop,
    railX: track ? TRACK_RAIL_X : ARM_RAIL_X,
    datumX: track ? TRACK_DATUM_X : ARM_RAIL_X + reachDx,
    flagX: track ? TRACK_FLAG_X : ARM_FLAG_X,
    rowY,
    sigmaY,
    fold,
    reach,
    reachDist: tipTravel(fold, reach),
  };
}

/** The geometry the server renders with: no DOM, so rows are evenly spaced. */
function defaultGeom(clauseCount: number): Geom {
  const n = Math.max(1, clauseCount);
  const height = n * ROW_H_FALLBACK;
  const rowY: number[] = [];
  for (let i = 0; i < clauseCount; i += 1) {
    rowY.push(ROW_H_FALLBACK / 2 + i * ROW_H_FALLBACK);
  }
  return buildGeom(GUTTER_DEFAULT, height, 0, rowY, height - 6, false);
}

/* ==========================================================================
   FRAMES

   One pure function from elapsed milliseconds to a complete pose. The animated
   frames, the server's terminal frame and the reduced-motion still frame all
   come out of this, which is what guarantees the still frame is the same
   drawing rather than a second implementation that can drift away from it.
   ========================================================================== */

interface Frame {
  carriageY: number;
  elbowX: number;
  elbowY: number;
  tipX: number;
  tipY: number;
  /** Probe extension, 0 folded to 1 on the datum. Drives the track-mode stub. */
  extend: number;
  a1: number;
  a2: number;
  /** How many rows have registered. Flags appear as their row registers. */
  registered: number;
  stateWord: string;
  load: number;
  stamped: boolean;
  stampScale: number;
  parkY: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The instantaneous rate of `servoMs`, per millisecond, by central difference.
 *
 * Numeric rather than analytic on purpose: LOAD is then literally the
 * derivative of the profile that is driving the axis, so it cannot drift out of
 * agreement with the motion the way a hand-differentiated copy would.
 */
function servoRate(e: number, dur: number): number {
  if (dur <= 0) return 0;
  const lo = Math.max(0, e - 0.5);
  const hi = Math.min(dur, e + 0.5);
  const span = hi - lo;
  if (span <= 0) return 0;
  return (servoMs(hi, dur) - servoMs(lo, dur)) / span;
}

/** Normalised axis load for a move of `distance` px at elapsed `e` of `dur`. */
function loadFor(distance: number, e: number, dur: number): number {
  return clamp01((Math.abs(distance) * servoRate(e, dur)) / MAX_AXIS_PX_PER_MS);
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

function frameAt(tRaw: number, g: Geom, plan: Plan): Frame {
  const t = Math.min(Math.max(tRaw, 0), Math.max(plan.totalMs, 0));
  const rows = plan.rows;
  const n = rows.length;

  const parkY =
    plan.parkIndex !== null && g.rowY[plan.parkIndex] !== undefined
      ? g.rowY[plan.parkIndex]
      : g.sigmaY;

  let carriageY = HOME_Y;
  let extend = 0;
  let load = 0;
  let stateWord = "IDLE";
  let stamped = false;
  let stampScale = 1;
  let registered = 0;

  if (n === 0) {
    // No verdict: home position, arm folded, nothing measured, nothing claimed.
    return finish(g, HOME_Y, 0, 0, "IDLE", 0, false, 1, parkY);
  }

  for (const r of rows) if (t >= r.endMs) registered += 1;

  const last = rows[n - 1];

  if (t < last.endMs) {
    // ---- inside the row sequence ----
    let i = 0;
    while (i < n - 1 && t >= rows[i].endMs) i += 1;
    const row = rows[i];
    const e = t - row.startMs;
    const fromY = i === 0 ? HOME_Y : g.rowY[rows[i - 1].index] ?? HOME_Y;
    const toY = g.rowY[row.index] ?? HOME_Y;

    if (e < TRAVERSE_MS) {
      carriageY = lerp(fromY, toY, servoMs(e, TRAVERSE_MS));
      load = loadFor(toY - fromY, e, TRAVERSE_MS);
      if (i > 0 && e < RETRACT_MS) {
        // The previous row's fold, running while this row's traverse is already
        // under way. Two axes are moving, so LOAD reports the busier of them.
        extend = 1 - servoMs(e, RETRACT_MS);
        load = Math.max(load, loadFor(g.reachDist, e, RETRACT_MS));
        stateWord = "RETRACT";
      } else if (i > 0 && e < REGISTER_MS) {
        // The previous row's STATUS cell is still being written.
        stateWord = "REGISTER";
      } else {
        stateWord = "TRAVERSE";
      }
    } else if (e < TRAVERSE_MS + DESCEND_MS) {
      carriageY = toY;
      extend = servoMs(e - TRAVERSE_MS, DESCEND_MS);
      load = loadFor(g.reachDist, e - TRAVERSE_MS, DESCEND_MS);
      stateWord = "DESCEND";
    } else {
      // The dwell. Zero motion, and LOAD reads exactly 0.00 because of it.
      carriageY = toY;
      extend = 1;
      load = 0;
      stateWord = "DWELL";
    }
  } else if (t < plan.parkStartMs) {
    // ---- the last row's tail: fold, then finish registering ----
    carriageY = g.rowY[last.index] ?? HOME_Y;
    const e = t - last.endMs;
    if (e < RETRACT_MS) {
      extend = 1 - servoMs(e, RETRACT_MS);
      load = loadFor(g.reachDist, e, RETRACT_MS);
      stateWord = "RETRACT";
    } else {
      stateWord = "REGISTER";
    }
  } else if (t < plan.parkEndMs) {
    // ---- the park drive: to the Σ row, or back up to the first flagged row ----
    const fromY = g.rowY[last.index] ?? HOME_Y;
    const e = t - plan.parkStartMs;
    carriageY = lerp(fromY, parkY, servoMs(e, PARK_MS));
    load = loadFor(parkY - fromY, e, PARK_MS);
    stateWord = "TRAVERSE";
  } else {
    // ---- parked: the probe extends onto the parked datum, the stamp presses --
    carriageY = parkY;
    const e = t - plan.parkEndMs;
    extend = servoMs(Math.min(e, DESCEND_MS), DESCEND_MS);
    load = e < DESCEND_MS ? loadFor(g.reachDist, e, DESCEND_MS) : 0;
    stamped = true;
    stampScale = 1.25 - 0.25 * servoMs(e, STAMP_MS);
    stateWord =
      e < DESCEND_MS ? "DESCEND" : plan.held ? "INDETERMINATE" : "PARKED";
  }

  return finish(
    g,
    carriageY,
    extend,
    registered,
    stateWord,
    load,
    stamped,
    stampScale,
    parkY
  );
}

/** Resolve a carriage position and an extension into joint angles and points. */
function finish(
  g: Geom,
  carriageY: number,
  extend: number,
  registered: number,
  stateWord: string,
  load: number,
  stamped: boolean,
  stampScale: number,
  parkY: number
): Frame {
  // BOTH JOINTS ARE DRIVEN AS ANGLES, not as an endpoint position: the pose is
  // interpolated in joint space between folded and extended, so the elbow
  // sweeps the way a real axis does instead of being back-solved every frame
  // from a straight-line tip path.
  const u = clamp01(extend);
  const a1 = lerp(g.fold.a1, g.reach.a1, u);
  const a2 = lerp(g.fold.a2, g.reach.a2, u);
  const tip = endEffector(a1, a2, L1, L2);

  return {
    carriageY,
    elbowX: g.railX + L1 * Math.cos(a1),
    elbowY: carriageY + L1 * Math.sin(a1),
    tipX: g.railX + tip.x,
    tipY: carriageY + tip.y,
    extend: u,
    a1,
    a2,
    registered,
    stateWord,
    load,
    stamped,
    stampScale,
    parkY,
  };
}

/* ==========================================================================
   FORMATTING

   Every figure here is monospace and reads at the precision it was actually
   measured to: joint angles 1dp, LOAD 2dp, CYCLE zero-padded. A true minus
   sign, not a hyphen, because these sit in a tabular column.
   ========================================================================== */

const MINUS = "−";
const DEGREE = "°";

function formatAngle(radians: number): string {
  const v = deg(radians);
  const sign = v < 0 ? MINUS : "+";
  return `${sign}${Math.abs(v).toFixed(1)}${DEGREE}`;
}

const formatLoad = (v: number) => v.toFixed(2);

const pad2 = (v: number) => String(Math.max(0, Math.floor(v))).padStart(2, "0");

const formatCycle = (registered: number, total: number) =>
  `${pad2(registered)}/${pad2(total)}`;

/** What the readout says, given that a genuine clamp overrides every beat. */
function stateText(frame: Frame, g: Geom): string {
  return g.outOfEnvelope ? "OUT-OF-ENVELOPE" : frame.stateWord;
}

/* ==========================================================================
   THE ACCESSIBLE NAME

   Names the TERMINAL state, never the frame on screen. Status is carried by the
   word, by an integer and by a shape, so nothing here depends on seeing colour.
   ========================================================================== */

function ariaLabel(plan: Plan, g: Geom): string {
  const envelope = g.outOfEnvelope
    ? " The arm is outside its working envelope, so the rig has fallen back to a plain track rail."
    : "";

  if (plan.idle) {
    return `Inspection arm at its home position. No verdict has been recorded for these ${plan.total} sealed clauses, so nothing has been measured.${envelope}`;
  }

  const failures = plan.failed.length;
  const blocking = plan.parkIndex !== null ? plan.parkIndex + 1 : null;

  if (plan.held) {
    return `Inspection arm parked at clause ${
      blocking ?? plan.total
    } of ${plan.total}, with ${failures} clause${
      failures === 1 ? "" : "s"
    } out of tolerance. The verdict is held for review and the escrow is untouched.${envelope}`;
  }

  if (blocking !== null) {
    return `Inspection arm parked at clause ${blocking}, the first of ${failures} clause${
      failures === 1 ? "" : "s"
    } out of tolerance across ${plan.total}. Release was blocked and the bounty was refunded.${envelope}`;
  }

  return `Inspection arm parked at the total row after ruling on all ${plan.total} sealed clauses. None is out of tolerance and the escrow released.${envelope}`;
}

/* ==========================================================================
   THE COMPONENT
   ========================================================================== */

/** useLayoutEffect warns during SSR; there is no layout to read there anyway. */
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function InspectionArm({
  listId,
  clauseCount,
  rulings,
  state,
  sigmaRowId,
  onRegister,
  onRewind,
}: InspectionArmProps) {
  const plan = useMemo(
    () => buildPlan(clauseCount, rulings, state),
    [clauseCount, rulings, state]
  );

  // Geometry lives in state ONLY so the JSX can server-render the terminal
  // frame and re-render on a resize. The animation reads it from the ref.
  const [geom, setGeom] = useState<Geom>(() => defaultGeom(clauseCount));

  const rootRef = useRef<HTMLDivElement | null>(null);
  const carriageRef = useRef<SVGRectElement | null>(null);
  const upperRef = useRef<SVGLineElement | null>(null);
  const foreRef = useRef<SVGLineElement | null>(null);
  const stubRef = useRef<SVGLineElement | null>(null);
  const tipRef = useRef<SVGCircleElement | null>(null);
  const flagRefs = useRef<Array<SVGRectElement | null>>([]);
  const j1Ref = useRef<HTMLSpanElement | null>(null);
  const j2Ref = useRef<HTMLSpanElement | null>(null);
  const loadRef = useRef<HTMLSpanElement | null>(null);
  const cycleRef = useRef<HTMLSpanElement | null>(null);
  const stateRef = useRef<HTMLSpanElement | null>(null);

  const geomRef = useRef<Geom>(geom);
  const planRef = useRef<Plan>(plan);
  const elapsedRef = useRef<number>(plan.totalMs);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const runningRef = useRef<boolean>(false);
  const registeredRef = useRef<number>(plan.rows.length);
  const stampedRef = useRef<boolean>(!plan.idle);

  // Callbacks through refs so a parent that re-creates them inline cannot
  // restart the animation.
  const onRegisterRef = useRef(onRegister);
  const onRewindRef = useRef(onRewind);

  /**
   * Mirror the current props into the refs the rAF loop reads.
   *
   * Declared FIRST among this component's effects on purpose. Layout effects
   * run in declaration order and all of them run before any passive effect, so
   * by the time either the frame-applying layout effect or the mount effect
   * below runs, these refs are already current. Assigning them during render
   * instead would be a render-phase side effect, which React's own lint rule
   * rejects and which breaks under a re-entrant render.
   */
  useIsoLayoutEffect(() => {
    planRef.current = plan;
    onRegisterRef.current = onRegister;
    onRewindRef.current = onRewind;
  });

  /**
   * Write one frame into the DOM. This is the only thing the rAF loop calls,
   * and it never touches React state.
   */
  const applyFrame = useCallback((t: number) => {
    const g = geomRef.current;
    const p = planRef.current;
    const f = frameAt(t, g, p);

    if (carriageRef.current) {
      carriageRef.current.setAttribute(
        "y",
        String(f.carriageY - CARRIAGE / 2)
      );
    }
    if (upperRef.current) {
      upperRef.current.setAttribute("y1", String(f.carriageY));
      upperRef.current.setAttribute("x2", String(f.elbowX));
      upperRef.current.setAttribute("y2", String(f.elbowY));
    }
    if (foreRef.current) {
      foreRef.current.setAttribute("x1", String(f.elbowX));
      foreRef.current.setAttribute("y1", String(f.elbowY));
      foreRef.current.setAttribute("x2", String(f.tipX));
      foreRef.current.setAttribute("y2", String(f.tipY));
    }
    if (stubRef.current) {
      // Track mode: the probe is a stub that grows out of the carriage on the
      // same DESCEND beat the articulated arm extends on.
      const x1 = g.railX + CARRIAGE / 2;
      stubRef.current.setAttribute("x1", String(x1));
      stubRef.current.setAttribute("y1", String(f.carriageY));
      stubRef.current.setAttribute(
        "x2",
        String(lerp(x1, g.datumX, f.extend))
      );
      stubRef.current.setAttribute("y2", String(f.carriageY));
    }
    if (tipRef.current) {
      const cx = g.mode === "track" ? lerp(g.railX + CARRIAGE / 2, g.datumX, f.extend) : f.tipX;
      const cy = g.mode === "track" ? f.carriageY : f.tipY;
      tipRef.current.setAttribute("cx", String(cx));
      tipRef.current.setAttribute("cy", String(cy));
    }

    // Flags appear as their row registers. Display, never opacity: a flag is
    // meaning-bearing geometry and fading one would put it below its contrast
    // floor on the way in.
    for (let i = 0; i < p.rows.length; i += 1) {
      const el = flagRefs.current[i];
      if (!el) continue;
      const shown = !p.rows[i].passed && f.registered > i;
      el.style.display = shown ? "" : "none";
    }

    if (j1Ref.current) j1Ref.current.textContent = formatAngle(f.a1);
    if (j2Ref.current) j2Ref.current.textContent = formatAngle(f.a2);
    if (loadRef.current) loadRef.current.textContent = formatLoad(f.load);
    if (cycleRef.current) {
      cycleRef.current.textContent = formatCycle(f.registered, p.total);
    }
    if (stateRef.current) stateRef.current.textContent = stateText(f, g);

    const root = rootRef.current;
    if (root) {
      // Published so the page's own stamp can sit beside the parked row and
      // press on the same clock, without this component owning that element.
      root.style.setProperty("--arm-park-y", `${g.offsetTop + f.parkY}px`);
      root.style.setProperty("--arm-stamp-scale", f.stampScale.toFixed(3));
      const word = f.stamped && p.stampWord ? p.stampWord : "";
      if (stampedRef.current !== f.stamped || root.dataset.stamp !== word) {
        stampedRef.current = f.stamped;
        root.dataset.stamp = word;
      }
    }

    // Beat-level callback, at most once per row per run.
    if (f.registered !== registeredRef.current) {
      const cb = onRegisterRef.current;
      if (cb) {
        for (let i = registeredRef.current; i < f.registered; i += 1) {
          const row = p.rows[i];
          if (row) cb(row.index, row.passed);
        }
      }
      registeredRef.current = f.registered;
    }

    elapsedRef.current = t;
  }, []);

  /* ---------------------------------------------------------------------
     MEASUREMENT

     One debounced ResizeObserver, on the clause <ol> and on this component -
     never one per <li>. Clause text is user-authored and variable-height, both
     fonts load asynchronously and reflow the list after first paint, and the
     grid reflows twice on the way down to a phone.
     --------------------------------------------------------------------- */

  const measure = useCallback((): Geom => {
    const root = rootRef.current;
    const list = document.getElementById(listId);
    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 375px), (pointer: coarse)").matches;

    if (!root || !list) return defaultGeom(clauseCount);

    const rootRect = root.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const rows = Array.from(
      list.querySelectorAll<HTMLElement>("[data-clause-index]")
    );

    if (listRect.height < 1 || rows.length === 0) {
      const fallback = defaultGeom(clauseCount);
      return { ...fallback, mode: coarse ? "track" : fallback.mode };
    }

    const rowY = rows.map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2 - listRect.top;
    });

    // The Σ row lives in the other column. If the page hands us its id we park
    // exactly on it; otherwise the foot of the rail, which is where it sits.
    let sigmaY = Math.max(listRect.height - 6, rowY[rowY.length - 1] + 24);
    if (sigmaRowId) {
      const sigma = document.getElementById(sigmaRowId);
      if (sigma) {
        const r = sigma.getBoundingClientRect();
        sigmaY = r.top + r.height / 2 - listRect.top;
      }
    }

    return buildGeom(
      rootRect.width,
      listRect.height,
      Math.max(0, listRect.top - rootRect.top),
      rowY,
      sigmaY,
      coarse
    );
  }, [clauseCount, listId, sigmaRowId]);

  /* ---------------------------------------------------------------------
     MOUNT: measure, then either leave the finished run alone or rewind it.
     --------------------------------------------------------------------- */

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let cancelled = false;
    let roFrame = 0;
    let watchdog = 0;
    let rewind = 0;
    let observer: ResizeObserver | null = null;
    let inView: IntersectionObserver | null = null;
    let pausedByVisibility = false;
    let pausedByViewport = false;

    // Signature comparison, so a ResizeObserver that fires on an unchanged box
    // cannot loop through setState.
    const signature = (g: Geom) =>
      [
        g.mode,
        g.outOfEnvelope,
        g.width,
        Math.round(g.height),
        Math.round(g.offsetTop),
        g.rowY.map((y) => Math.round(y)).join(","),
        Math.round(g.sigmaY),
      ].join("|");

    const refit = () => {
      const next = measure();
      if (signature(next) === signature(geomRef.current)) return;
      geomRef.current = next;
      // Re-solve every target and replay the CURRENT beat rather than
      // restarting: a resize must not rewind a run the reader is watching.
      setGeom(next);
      applyFrame(elapsedRef.current);
    };

    const stopLoop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };

    const tick = (now: number) => {
      if (!runningRef.current) return;
      const t = now - startRef.current;
      const total = planRef.current.totalMs;
      if (t >= total) {
        applyFrame(total);
        runningRef.current = false;
        rafRef.current = 0;
        return;
      }
      applyFrame(t);
      rafRef.current = requestAnimationFrame(tick);
    };

    const resumeAtBeat = () => {
      if (!runningRef.current || rafRef.current) return;
      if (pausedByVisibility || pausedByViewport) return;
      // Shift the origin so the run continues from the beat it was paused on
      // instead of jumping or restarting.
      startRef.current = performance.now() - elapsedRef.current;
      rafRef.current = requestAnimationFrame(tick);
    };

    const pause = () => stopLoop();

    const forceComplete = () => {
      runningRef.current = false;
      stopLoop();
      applyFrame(planRef.current.totalMs);
    };

    const onVisibility = () => {
      pausedByVisibility = document.visibilityState === "hidden";
      if (pausedByVisibility) pause();
      else resumeAtBeat();
    };

    // ---- decisions taken synchronously at mount, before any frame is queued --
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const rect = root.getBoundingClientRect();
    const visibleAtMount =
      rect.bottom > 0 && rect.top < (window.innerHeight || 0);

    // Geometry is measured either way: the still frame has to line up with the
    // real rows just as much as the animated one does.
    const settle = () => {
      geomRef.current = measure();
      setGeom(geomRef.current);
      applyFrame(planRef.current.totalMs);
    };

    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => {
        if (roFrame) return;
        roFrame = requestAnimationFrame(() => {
          roFrame = 0;
          if (!cancelled) refit();
        });
      });
      const list = document.getElementById(listId);
      if (list) observer.observe(list);
      observer.observe(root);
    }

    const fontsReady = async () => {
      // The clause list reflows when the webfont swaps in, and a solve against
      // the fallback metrics would point the probe at the wrong row.
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fonts && typeof fonts.ready?.then === "function") {
        try {
          await fonts.ready;
        } catch {
          // A font failing to load is not a reason to skip the rig.
        }
      }
    };

    if (reduced || plan.idle || !visibleAtMount) {
      // No rAF work is ever queued on any of these paths. The document already
      // holds the finished run; leaving it alone IS the correct render.
      void fontsReady().then(() => {
        if (!cancelled) settle();
      });
    } else {
      rewind = window.setTimeout(() => {
        void (async () => {
          await fontsReady();
          if (cancelled) return;

          geomRef.current = measure();
          setGeom(geomRef.current);

          // Frame zero. The complete document was in the HTML; this rewinds it.
          registeredRef.current = 0;
          applyFrame(0);
          onRewindRef.current?.();

          runningRef.current = true;
          startRef.current = performance.now();
          rafRef.current = requestAnimationFrame(tick);

          // The hard stop, measured from the moment the run actually begins.
          watchdog = window.setTimeout(forceComplete, WATCHDOG_MS);

          if (typeof IntersectionObserver === "function") {
            inView = new IntersectionObserver(
              (entries) => {
                const entry = entries[0];
                if (!entry) return;
                pausedByViewport = !entry.isIntersecting;
                if (pausedByViewport) pause();
                else resumeAtBeat();
              },
              { threshold: 0 }
            );
            inView.observe(root);
          }
        })();
      }, 0);
    }

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      runningRef.current = false;
      stopLoop();
      if (roFrame) cancelAnimationFrame(roFrame);
      if (watchdog) clearTimeout(watchdog);
      if (rewind) clearTimeout(rewind);
      observer?.disconnect();
      inView?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [applyFrame, listId, measure, plan]);

  /**
   * Re-assert the current frame after every render. React has just written the
   * TERMINAL attributes back into the DOM from the JSX below; this puts the
   * live pose back before the browser paints, so a resize mid-run does not
   * flash the finished frame.
   */
  useIsoLayoutEffect(() => {
    geomRef.current = geom;
    applyFrame(elapsedRef.current);
  }, [geom, applyFrame]);

  /* ---------------------------------------------------------------------
     RENDER — the terminal frame, always.
     --------------------------------------------------------------------- */

  const terminal = useMemo(
    () => frameAt(plan.totalMs, geom, plan),
    [geom, plan]
  );

  const label = ariaLabel(plan, geom);
  const track = geom.mode === "track";
  const stampWord = terminal.stamped && plan.stampWord ? plan.stampWord : "";

  // A failing row's flag takes the held colour on a held record: the escrow is
  // untouched there, and an alarm-red flag would say a refund happened.
  const flagColour = plan.held ? "var(--warning)" : "var(--negative)";

  return (
    <div
      ref={rootRef}
      className="volume"
      data-stamp={stampWord}
      style={{
        position: "relative",
        // The strip runs the full height of the clause list, plus the header
        // above it. Overflow hidden so no volume-only ink can ever be drawn
        // over the light plate outside - that leak is the exact bug class this
        // colour system is built to make impossible.
        height: geom.offsetTop + geom.height,
        overflow: "hidden",
        borderLeft: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        ["--arm-park-y" as string]: `${geom.offsetTop + terminal.parkY}px`,
        ["--arm-stamp-scale" as string]: terminal.stampScale.toFixed(3),
      }}
    >
      {/* The gutter header. Cells are fixed-width and clip rather than
          ellipsise - a truncated figure is worse than a clipped one. Hidden
          from assistive technology because it is a live rig readout that
          changes many times a second and duplicates nothing a reader needs;
          the accessible account of the run is the SVG's label below. */}
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 8px",
          padding: "8px 4px",
          color: "var(--text-muted)",
        }}
      >
        <TelemetryCell name="J1">
          <span className="telemetry" ref={j1Ref}>
            {formatAngle(terminal.a1)}
          </span>
        </TelemetryCell>
        <TelemetryCell name="J2">
          <span className="telemetry" ref={j2Ref}>
            {formatAngle(terminal.a2)}
          </span>
        </TelemetryCell>
        <TelemetryCell name="LOAD">
          <span className="telemetry" ref={loadRef}>
            {formatLoad(terminal.load)}
          </span>
        </TelemetryCell>
        <TelemetryCell name="CYCLE">
          <span className="telemetry" ref={cycleRef}>
            {formatCycle(terminal.registered, plan.total)}
          </span>
        </TelemetryCell>
        <TelemetryCell name="STATE" wrap>
          <span
            className="telemetry"
            ref={stateRef}
            style={{ whiteSpace: "normal", wordBreak: "break-word" }}
          >
            {stateText(terminal, geom)}
          </span>
        </TelemetryCell>
      </div>

      <svg
        role="img"
        aria-label={label}
        width={geom.width}
        height={geom.height}
        viewBox={`0 0 ${geom.width} ${geom.height}`}
        style={{
          position: "absolute",
          left: 0,
          top: geom.offsetTop,
          // The elbow rises up to 33px above the carriage. Visible overflow
          // lets it draw into the header strip, which is the same dark ground;
          // the root above clips anything that would leave the volume.
          overflow: "visible",
        }}
      >
        {/* The rail: the prismatic axis the carriage travels. */}
        <line
          x1={geom.railX}
          y1={0}
          x2={geom.railX}
          y2={geom.height}
          stroke="var(--text)"
          strokeWidth={1}
        />

        {/* Datum dots: one per sealed clause, at the row's vertical centre,
            plus a hollow ring at the Σ row - a total is not a clause, and the
            shape says so without relying on colour. */}
        {geom.rowY.map((y, i) => (
          <circle
            key={`datum-${i}`}
            cx={geom.datumX}
            cy={y}
            r={DATUM_R}
            fill="var(--marker)"
          />
        ))}
        {plan.parkIndex === null && !plan.idle && (
          <circle
            cx={geom.datumX}
            cy={geom.sigmaY}
            r={DATUM_R}
            fill="none"
            stroke="var(--marker)"
            strokeWidth={1}
          />
        )}

        {/* Flags left behind at every out-of-tolerance row. Square, not round:
            the shape is a second channel, so the failing rows are countable in
            greyscale. */}
        {plan.rows.map((row, i) => (
          <rect
            key={`flag-${row.index}`}
            ref={(el) => {
              flagRefs.current[i] = el;
            }}
            x={geom.flagX}
            y={(geom.rowY[row.index] ?? HOME_Y) - FLAG / 2}
            width={FLAG}
            height={FLAG}
            fill={flagColour}
            style={{
              display: !row.passed && terminal.registered > i ? "" : "none",
            }}
          />
        ))}

        {track ? (
          // TRACK MODE. The armature is REPLACED, not shrunk: an articulated
          // arm in 28px is illegible. Same carriage, same timings, same flags,
          // same parking - one dimension fewer.
          <line
            ref={stubRef}
            x1={geom.railX + CARRIAGE / 2}
            y1={terminal.carriageY}
            x2={lerp(
              geom.railX + CARRIAGE / 2,
              geom.datumX,
              terminal.extend
            )}
            y2={terminal.carriageY}
            stroke="var(--rig-line)"
            strokeWidth={1}
          />
        ) : (
          <>
            <line
              ref={upperRef}
              x1={geom.railX}
              y1={terminal.carriageY}
              x2={terminal.elbowX}
              y2={terminal.elbowY}
              stroke="var(--rig-line)"
              strokeWidth={1}
            />
            <line
              ref={foreRef}
              x1={terminal.elbowX}
              y1={terminal.elbowY}
              x2={terminal.tipX}
              y2={terminal.tipY}
              stroke="var(--rig-line)"
              strokeWidth={1}
            />
          </>
        )}

        {/* The carriage: filled with the volume ground so it occludes the rail
            it rides on, the way a real block would. */}
        <rect
          ref={carriageRef}
          x={geom.railX - CARRIAGE / 2}
          y={terminal.carriageY - CARRIAGE / 2}
          width={CARRIAGE}
          height={CARRIAGE}
          fill="var(--page)"
          stroke="var(--text)"
          strokeWidth={1}
        />

        {/* The probe tip. */}
        <circle
          ref={tipRef}
          cx={
            track
              ? lerp(geom.railX + CARRIAGE / 2, geom.datumX, terminal.extend)
              : terminal.tipX
          }
          cy={track ? terminal.carriageY : terminal.tipY}
          r={TIP_R}
          fill="var(--text)"
        />
      </svg>
    </div>
  );
}

/** One key/value pair in the gutter header. Key above value: 64px is narrow. */
function TelemetryCell({
  name,
  wrap,
  children,
}: {
  name: string;
  wrap?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        flex: wrap ? "1 1 100%" : "0 1 auto",
      }}
    >
      <span className="label">{name}</span>
      {children}
    </span>
  );
}

export default InspectionArm;
