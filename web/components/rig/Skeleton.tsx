"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { servoMs } from "@/lib/rig";

import {
  BONES,
  CAMERAS,
  CAMERA_COUNT,
  DRIFT_AMPLITUDE_PX,
  DRIFT_BY_ID,
  GRID_LINES,
  MARKERS,
  MARKER_BY_ID,
  MARKER_ORDER,
  MOBILE_BONES,
  MOBILE_MARKERS,
  boneKey,
  driftOffset,
  isOccluded,
  type Bone,
  type DriftParams,
  type Marker,
  type MarkerId,
} from "./topology";

/**
 * THE LANDING MOCAP RIG.
 *
 * An instrumented capture volume that loses its solve, re-calibrates marker by
 * marker, and locks. Fourteen seconds, three phases, one loop.
 *
 * Five decisions drive the whole file, and they are all about honesty rather
 * than about graphics:
 *
 * 1. THE SERVER RENDERS THE FINISHED PICTURE. The markup that leaves the server
 *    is `computeFrame(TERMINAL_MS)` - a fully locked solve with every marker on
 *    ground truth, every bone solid, the bounding box drawn and the telemetry
 *    at its settled reading. The client REWINDS to frame zero in a
 *    setTimeout(..., 0) after mount. Nothing is ever built up toward
 *    completeness, so a crawler, a reader with JavaScript blocked, and a failed
 *    hydration all see a complete instrument rather than an empty box.
 *
 * 2. THE STILL FRAME IS THE SAME FUNCTION. Reduced motion is not a separate
 *    drawing. It is `computeFrame` evaluated at TERMINAL_MS and never
 *    re-evaluated. The check happens BEFORE the first requestAnimationFrame is
 *    scheduled, so no frame work is ever queued for a reader who asked for no
 *    motion - not queued and then cancelled, never queued.
 *
 * 3. EVERY PRINTED FIGURE IS THE DRAWING'S OWN STATE. RESIDUAL is the real RMS
 *    offset of the measured markers from ground truth, converted through one
 *    scale constant. It falls from 3.42mm to 0.41mm because the markers move,
 *    not because a countdown was scripted alongside them. Delete the markers
 *    and the number stops making sense - which is the test that it is real.
 *
 * 4. SOLID IS MEASURED, DASHED IS INFERRED. A bone touching an occluded marker
 *    is drawn in --rig-solved with a 3-2 dash. That is the same epistemic rule
 *    the verdict sheet uses for a held ruling, and it is why the rig may never
 *    animate opacity on a meaning-bearing line: an alpha ramp silently drops a
 *    line below its contrast floor mid-transition. Crossfades interpolate
 *    COLOUR between two endpoints that both clear 3:1.
 *
 * 5. NO STATE PER FRAME. The loop mutates SVG attributes through refs. React
 *    re-renders exactly twice in this component's life: once at mount, and
 *    once more if the viewport crosses 375px.
 */

/* ==========================================================================
   TIMING - the 14 second cycle
   ========================================================================== */

/** DRIFT runs from 0 to here: the solve has been lost and markers wander. */
const DRIFT_END_MS = 4_000;
/** CALIBRATE runs from DRIFT_END_MS to here: markers land in chain order. */
const CALIBRATE_END_MS = 9_200;
/** One full loop. LOCKED occupies everything between CALIBRATE_END_MS and this. */
const CYCLE_MS = 14_000;

/** Gap between one marker starting its move and the next one starting. */
const CALIBRATE_STAGGER_MS = 40;
/** How long a single marker takes to travel from drift onto ground truth. */
const CALIBRATE_MOVE_MS = 260;

/** The bounding box traces itself on at LOCKED, and retracts before the wrap. */
const BBOX_DRAW_MS = 320;

/**
 * The tail of LOCKED, over which the bones that are about to lose their marker
 * crossfade from --rig-line to --rig-solved.
 *
 * This exists so the loop does not jump-cut. It is a COLOUR interpolation
 * between two inks that both clear 3:1 on every volume ground; it is expressly
 * not an opacity ramp, which would pass through unreadable values on the way.
 */
const RELEASE_FADE_MS = 700;

/**
 * The moment the server draws, and the moment a reduced-motion reader is left
 * at. Inside LOCKED, after the bounding box has finished tracing (9520ms) and
 * before the crossfade back toward DRIFT begins (13300ms), so it is an
 * unambiguously settled solve.
 *
 * It is also what makes FRAME print 001482 in the HTML: 12350 * 0.12 = 1482.
 */
const TERMINAL_MS = 12_350;

/**
 * Frames per millisecond. 0.12 is 120 capture frames a second, a real mocap
 * rate.
 *
 * FRAME is derived from ELAPSED MILLISECONDS and never from a count of rAF
 * ticks. A tick counter follows the display refresh, so the identical animation
 * would print roughly double the frame number on a 120Hz laptop as on a 60Hz
 * one, and neither number would be reproducible on the server. A readout that
 * reports the monitor rather than the capture is a lie in a mono figure, which
 * is the one place this product promises figures can be trusted.
 */
const FRAMES_PER_MS = 0.12;

/** The readout is six digits wide, so the counter wraps rather than reflowing. */
const FRAME_MODULUS = 1_000_000;

/* ==========================================================================
   THE RESIDUAL SCALE

   RESIDUAL is the one figure that ties the drawing to the copy, so it is
   derived rather than scripted:

     residual_mm = FLOOR + rms_px * MM_PER_PX

   FLOOR is the noise floor of a solved capture - a real system never reports
   exactly zero, and a rig that did would be claiming infinite precision. The
   scale is fixed by the two published endpoints: the RMS of a sine of amplitude
   A is A / sqrt(2) per axis, which over two independent axes comes back to
   exactly A, so a fully drifting rig sits at DRIFT_AMPLITUDE_PX pixels of RMS
   error. Pinning 1.5px to 3.42mm and 0px to 0.41mm gives one constant, and
   every intermediate value then falls out of where the markers actually are.
   ========================================================================== */

const RESIDUAL_FLOOR_MM = 0.41;
const RESIDUAL_DRIFT_MM = 3.42;
const MM_PER_PX = (RESIDUAL_DRIFT_MM - RESIDUAL_FLOOR_MM) / DRIFT_AMPLITUDE_PX;

/* ==========================================================================
   GEOMETRY CONSTANTS
   ========================================================================== */

/** Marker discs are a CONSTANT radius. Size encodes physical diameter in a real
 *  system and nothing else, so it may never be used here to mean importance. */
const MARKER_R = 2.5;
/** The ring left at the predicted position of a marker the cameras have lost. */
const RING_R = 4.5;
/** Half-length of a crosshair arm on a landed marker. */
const TICK_ARM = 3.5;
/** Padding between the marker extremes and the LOCKED bounding box. */
const BBOX_PAD = 12;
/** Radius of a join-key balloon. */
const BALLOON_R = 11;
/** Length of the terminal tick where a leader meets its marker. */
const LEADER_TICK = 3;
/** How far apart the two disagreeing PLV datum crosshairs sit during DRIFT. */
const DATUM_SPLIT_PX = 6;

/** Fallback viewBox before the panel has been measured, and for a no-JS reader. */
const DEFAULT_W = 960;
const DEFAULT_H = 540;
/** The narrow panel is 4:5 rather than 16:9. */
const DEFAULT_NARROW_W = 384;
const DEFAULT_NARROW_H = 480;

/** Below this the 13-marker subset is used and the balloons are dropped. */
/* The narrow rig and the narrow PANEL must switch at the same width, or there
   is a band where the panel has gone portrait while the rig is still laid out
   for a 16:9 box. 700px is that shared breakpoint (see .vh-volume in
   globals.css).

   375 was the wrong number for a second reason: almost no current phone is
   375px. An iPhone 14 is 390, a Pixel is 393, a Plus/Max is 428. A breakpoint
   at 375 would have left the reduced rig switched off on essentially every
   device it exists for. */
const NARROW_QUERY = "(max-width: 700px)";

/* ==========================================================================
   PRECOMPUTED DRAW TABLES

   Everything the frame loop needs is flattened here, once, at module load. The
   loop never does a Map lookup, never allocates, and never searches an array.
   ========================================================================== */

/** A marker, with everything the loop needs about it already resolved. */
interface Slot {
  marker: Marker;
  /** Position in the 21-marker chain. Drives the CALIBRATE stagger. */
  index: number;
  drift: DriftParams;
  /** True for the four markers the cameras lose during DRIFT. */
  occludable: boolean;
  /** When this marker begins its snap onto ground truth, in cycle time. */
  calibrateStart: number;
  /** The camera that had the best view of it - see nearestCamera, below. */
  camera: number;
}

/** A bone, with both endpoints resolved to chain indices. */
interface Link {
  key: string;
  a: number;
  b: number;
  /** True if either endpoint is one of the four that drop out during DRIFT. */
  everInferred: boolean;
}

function chainIndex(id: MarkerId): number {
  const i = MARKER_ORDER.get(id);
  if (i === undefined) {
    // Unreachable while MarkerId is derived from MARKERS, and asserted by
    // topology.test.ts. Throwing is the honest failure: a silent 0 would draw
    // every unknown marker on top of the pelvis and look almost right.
    throw new Error(`Marker ${id} is not in the chain`);
  }
  return i;
}

function driftFor(id: MarkerId): DriftParams {
  const d = DRIFT_BY_ID.get(id);
  if (d === undefined) throw new Error(`Marker ${id} has no drift parameters`);
  return d;
}

function markerOf(id: MarkerId): Marker {
  const m = MARKER_BY_ID.get(id);
  if (m === undefined) throw new Error(`Marker ${id} is not in the chain`);
  return m;
}

/**
 * The camera with the best view of a marker.
 *
 * This is what makes RAYS a real quantity instead of a decorative constant. A
 * marker drops out of a capture because the camera that could see it lost it,
 * so each occluded marker costs the ray from its nearest camera, and the
 * readout climbs back to 8/8 as the markers are recovered one at a time during
 * CALIBRATE. The four occluded markers happen to sit nearest four DIFFERENT
 * cameras, so the full rig reads RAYS 4/8 while drifting; the count is taken
 * from a Set either way, so it stays correct if the occlusion list is edited.
 */
function nearestCamera(marker: Marker): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < CAMERAS.length; i++) {
    const camera = CAMERAS[i];
    const d = Math.hypot(camera.x - marker.x, camera.y - marker.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

function buildSlots(markers: readonly Marker[]): readonly Slot[] {
  return markers.map((marker) => {
    const index = chainIndex(marker.id);
    return {
      marker,
      index,
      drift: driftFor(marker.id),
      occludable: isOccluded(marker.id),
      // The stagger is taken from the position in the FULL chain even on the
      // reduced rig, so the mobile figure calibrates in the same order and with
      // the same rhythm as the desktop one - it simply skips the markers it
      // does not draw, which reads as a shorter take rather than as a
      // different machine.
      calibrateStart: DRIFT_END_MS + index * CALIBRATE_STAGGER_MS,
      camera: nearestCamera(marker),
    };
  });
}

function buildLinks(bones: readonly Bone[]): readonly Link[] {
  return bones.map((bone) => ({
    key: boneKey(bone),
    a: chainIndex(bone[0]),
    b: chainIndex(bone[1]),
    everInferred: isOccluded(bone[0]) || isOccluded(bone[1]),
  }));
}

const FULL_SLOTS = buildSlots(MARKERS);
const FULL_LINKS = buildLinks(BONES);
const MOBILE_SLOTS = buildSlots(MOBILE_MARKERS);
const MOBILE_LINKS = buildLinks(MOBILE_BONES);

/**
 * The join keys. The same three numbers head the SEAL / JUDGE / PAID columns
 * below the panel, which is what makes them keys rather than decoration: remove
 * the drawing and the numbers downstairs stop indexing anything.
 *
 * The offsets are in panel pixels rather than in normalised units, so a balloon
 * stays the same distance from its joint at every panel size instead of
 * drifting into the figure on a narrow layout.
 */
const BALLOONS: readonly {
  key: string;
  marker: MarkerId;
  dx: number;
  dy: number;
}[] = [
  { key: "01", marker: "THX", dx: -92, dy: -48 },
  { key: "02", marker: "R_WR", dx: 88, dy: -16 },
  { key: "03", marker: "L_AN", dx: -88, dy: 18 },
];

/* ==========================================================================
   THE FRAME
   ========================================================================== */

type Phase = "DRIFT" | "CALIBRATE" | "LOCKED";

/**
 * Everything the renderer needs for one instant, in preallocated arrays.
 *
 * Marker arrays are always 21 long and indexed by chain position, whichever
 * marker set is in use, so an index means the same thing on both rigs.
 */
interface FrameState {
  phase: Phase;
  x: Float64Array;
  y: Float64Array;
  occluded: boolean[];
  landed: boolean[];
  boneInferred: boolean[];
  /** 0 = --rig-line, 1 = --rig-solved, between = a colour crossfade. */
  boneFade: number[];
  bboxVisible: boolean;
  /** 1 = undrawn, 0 = fully traced. */
  bboxOffset: number;
  datumVisible: boolean;
  datumMeasuredX: number;
  datumMeasuredY: number;
  datumSolvedX: number;
  datumSolvedY: number;
  residualMm: number;
  rays: number;
  visible: number;
  solve: number;
  frame: number;
}

function createFrameState(boneCount: number): FrameState {
  return {
    phase: "LOCKED",
    x: new Float64Array(MARKERS.length),
    y: new Float64Array(MARKERS.length),
    occluded: new Array<boolean>(MARKERS.length).fill(false),
    landed: new Array<boolean>(MARKERS.length).fill(true),
    boneInferred: new Array<boolean>(boneCount).fill(false),
    boneFade: new Array<number>(boneCount).fill(0),
    bboxVisible: true,
    bboxOffset: 0,
    datumVisible: false,
    datumMeasuredX: 0,
    datumMeasuredY: 0,
    datumSolvedX: 0,
    datumSolvedY: 0,
    residualMm: RESIDUAL_FLOOR_MM,
    rays: CAMERA_COUNT,
    visible: 0,
    solve: 100,
    frame: 0,
  };
}

/**
 * The whole simulation, as one pure function of elapsed milliseconds.
 *
 * The server calls it once at TERMINAL_MS to emit the finished picture. The
 * client calls it per frame with a live clock. A reduced-motion reader gets the
 * server's call and nothing else. There is no second code path anywhere, which
 * is the only way to be sure the still frame and the animation agree.
 *
 * It writes into `out` rather than returning a new object: at 60Hz a fresh
 * object per frame is garbage generated sixty times a second, and the whole
 * reason attributes are mutated through refs is to keep the frame allocation
 * free.
 */
function computeFrame(
  out: FrameState,
  elapsedMs: number,
  w: number,
  h: number,
  slots: readonly Slot[],
  links: readonly Link[]
): void {
  const cycle = ((elapsedMs % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
  out.phase =
    cycle < DRIFT_END_MS
      ? "DRIFT"
      : cycle < CALIBRATE_END_MS
        ? "CALIBRATE"
        : "LOCKED";

  let sumSquares = 0;
  let measured = 0;
  const blockedCameras = new Set<number>();

  for (const slot of slots) {
    const i = slot.index;

    // How far this marker has travelled onto ground truth. servoMs saturates at
    // 1, so a marker whose move has finished simply stays there and LOCKED
    // needs no special case at all.
    const progress =
      cycle < slot.calibrateStart
        ? 0
        : servoMs(cycle - slot.calibrateStart, CALIBRATE_MOVE_MS);

    // Occlusion ends the instant a marker's own calibration move begins - the
    // camera reacquires it, and that is why RAYS climbs during CALIBRATE.
    const occluded = slot.occludable && cycle < slot.calibrateStart;
    out.occluded[i] = occluded;
    out.landed[i] = progress >= 0.999;

    let dx = 0;
    let dy = 0;
    if (!occluded) {
      // Drift is evaluated on the ABSOLUTE clock, not on cycle time, so the
      // wobble does not repeat itself identically every fourteen seconds. It is
      // still a pure function of the clock, so the server and the client agree
      // about any instant either of them is asked for.
      const offset = driftOffset(slot.drift, elapsedMs);
      // The drift is scaled out by the calibration. This is what makes the
      // printed residual the drawing's own state: the same multiplier moves the
      // marker and lowers the number.
      dx = offset.dx * (1 - progress);
      dy = offset.dy * (1 - progress);
      sumSquares += dx * dx + dy * dy;
      measured++;
    } else {
      // A marker nobody can see has no measurement. It is drawn at the solver's
      // estimate - ground truth - with a ring rather than a disc, so the ring,
      // the dashed bones hanging off it and the residual all agree about
      // exactly what is known.
      blockedCameras.add(slot.camera);
    }

    out.x[i] = slot.marker.x * w + dx;
    out.y[i] = slot.marker.y * h + dy;
  }

  // Drift is measured at the camera, in pixels, so the residual does not change
  // when the panel is resized. That is correct: a wider browser window does not
  // make a capture less accurate.
  const rmsPx = measured > 0 ? Math.sqrt(sumSquares / measured) : 0;
  out.residualMm = RESIDUAL_FLOOR_MM + rmsPx * MM_PER_PX;
  out.rays = CAMERA_COUNT - blockedCameras.size;
  out.visible = measured;
  // A quality integer, derived from the residual rather than invented beside
  // it: 100 less the residual in tenths of a millimetre. A settled solve at
  // 0.41mm reads 96, which is what an instrument reports when it has been
  // trimmed and is not pretending to be perfect.
  out.solve = Math.max(0, 100 - Math.round(out.residualMm * 10));
  out.frame = Math.floor(elapsedMs * FRAMES_PER_MS) % FRAME_MODULUS;

  const fadeStart = CYCLE_MS - RELEASE_FADE_MS;
  const fade = cycle >= fadeStart ? (cycle - fadeStart) / RELEASE_FADE_MS : 0;

  for (let k = 0; k < links.length; k++) {
    const link = links[k];
    const inferred = out.occluded[link.a] || out.occluded[link.b];
    out.boneInferred[k] = inferred;
    // Already inferred: full --rig-solved. About to be inferred at the wrap:
    // ride the crossfade. Otherwise: --rig-line.
    out.boneFade[k] = inferred ? 1 : link.everInferred ? fade : 0;
  }

  if (out.phase === "LOCKED") {
    out.bboxVisible = true;
    const traced = servoMs(cycle - CALIBRATE_END_MS, BBOX_DRAW_MS);
    const retractStart = CYCLE_MS - BBOX_DRAW_MS;
    const retracted =
      cycle >= retractStart ? servoMs(cycle - retractStart, BBOX_DRAW_MS) : 0;
    // Trace on at the start of LOCKED, retract just before the wrap. The two
    // windows cannot overlap, so a max is enough to combine them - and the box
    // is never removed in a single frame, which would read as a glitch.
    out.bboxOffset = Math.max(1 - traced, retracted);
  } else {
    out.bboxVisible = false;
    out.bboxOffset = 1;
  }

  // THE PLV DATUM. Two crosshairs that ought to coincide, drawn apart: the
  // solved datum sits on ground truth, the measured one sits DATUM_SPLIT_PX
  // away along whichever direction the pelvis is currently drifting. They close
  // as the pelvis calibrates - it is first in the chain, so the datum resolving
  // is the first thing that happens in CALIBRATE - and by LOCKED they are the
  // same point, at which stage only the marker's own crosshair is drawn.
  const pelvis = markerOf("PLV");
  const pelvisIndex = chainIndex("PLV");
  const pelvisStart = DRIFT_END_MS + pelvisIndex * CALIBRATE_STAGGER_MS;
  const pelvisProgress =
    cycle < pelvisStart ? 0 : servoMs(cycle - pelvisStart, CALIBRATE_MOVE_MS);
  const split = DATUM_SPLIT_PX * (1 - pelvisProgress);
  const truthX = pelvis.x * w;
  const truthY = pelvis.y * h;
  const driftX = out.x[pelvisIndex] - truthX;
  const driftY = out.y[pelvisIndex] - truthY;
  // The pelvis is never occluded, so this is a real measured offset. The `|| 1`
  // only guards the instant the sine passes through zero, where the direction
  // is undefined and the separation is about to be scaled by it anyway.
  const driftLength = Math.hypot(driftX, driftY) || 1;
  out.datumSolvedX = truthX;
  out.datumSolvedY = truthY;
  out.datumMeasuredX = truthX + (driftX / driftLength) * split;
  out.datumMeasuredY = truthY + (driftY / driftLength) * split;
  out.datumVisible = split > 0.1;
}

/* ==========================================================================
   SMALL PURE HELPERS
   ========================================================================== */

const fmt = (n: number): string => n.toFixed(2);

const crosshairPath = (x: number, y: number): string =>
  `M ${fmt(x - TICK_ARM)} ${fmt(y)} H ${fmt(x + TICK_ARM)} ` +
  `M ${fmt(x)} ${fmt(y - TICK_ARM)} V ${fmt(y + TICK_ARM)}`;

const padFrame = (n: number): string => String(n).padStart(6, "0");

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The LOCKED bounding box: the extent of the solved subject, plus padding. */
function boundingBox(slots: readonly Slot[], w: number, h: number): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const slot of slots) {
    minX = Math.min(minX, slot.marker.x * w);
    maxX = Math.max(maxX, slot.marker.x * w);
    minY = Math.min(minY, slot.marker.y * h);
    maxY = Math.max(maxY, slot.marker.y * h);
  }
  return {
    x: minX - BBOX_PAD,
    y: minY - BBOX_PAD,
    width: maxX - minX + BBOX_PAD * 2,
    height: maxY - minY + BBOX_PAD * 2,
  };
}

interface Leader {
  balloonX: number;
  balloonY: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tickX1: number;
  tickY1: number;
  tickX2: number;
  tickY2: number;
}

/** A balloon, its leader, and the 3px tick where the leader meets the joint. */
function leaderGeometry(
  marker: Marker,
  dx: number,
  dy: number,
  w: number,
  h: number
): Leader {
  const mx = marker.x * w;
  const my = marker.y * h;
  const bx = mx + dx;
  const by = my + dy;
  const vx = mx - bx;
  const vy = my - by;
  const length = Math.hypot(vx, vy) || 1;
  const ux = vx / length;
  const uy = vy / length;
  // Start clear of the balloon outline and stop clear of the marker disc, so
  // the leader touches neither and reads as an annotation rather than a bone.
  const x1 = bx + ux * (BALLOON_R + 2);
  const y1 = by + uy * (BALLOON_R + 2);
  const x2 = mx - ux * (MARKER_R + 2.5);
  const y2 = my - uy * (MARKER_R + 2.5);
  // The terminal tick is perpendicular to the leader: (ux, uy) rotated by 90
  // degrees is (uy, -ux), which is why the components look swapped here.
  const half = LEADER_TICK / 2;
  return {
    balloonX: bx,
    balloonY: by,
    x1,
    y1,
    x2,
    y2,
    tickX1: x2 + uy * half,
    tickY1: y2 - ux * half,
    tickX2: x2 - uy * half,
    tickY2: y2 + ux * half,
  };
}

type RGB = readonly [number, number, number];

/**
 * Parse whatever a browser hands back for a custom property.
 *
 * The colours are read from the live cascade by TOKEN NAME - no hex literal for
 * a design token appears anywhere in this file - which means the value arrives
 * as a string and has to be turned into numbers before it can be interpolated.
 * Anything unrecognised returns null and the crossfade degrades to a hard
 * switch: a worse transition, and still a correct colour.
 */
function parseColour(value: string): RGB | null {
  const v = value.trim();

  if (v.startsWith("#")) {
    const hex = v.slice(1);
    if (hex.length === 3) {
      const r = Number.parseInt(hex[0] + hex[0], 16);
      const g = Number.parseInt(hex[1] + hex[1], 16);
      const b = Number.parseInt(hex[2] + hex[2], 16);
      return Number.isNaN(r + g + b) ? null : [r, g, b];
    }
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      return Number.isNaN(r + g + b) ? null : [r, g, b];
    }
    return null;
  }

  const match = /rgba?\(([^)]+)\)/.exec(v);
  if (match) {
    const parts = match[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

/**
 * The stroke for a bone at a given point in the crossfade.
 *
 * At both ends it returns the TOKEN, not a computed colour, so the ordinary
 * state of the DOM reads `var(--rig-line)` and a token change would still be
 * picked up. Only the 700ms in between carries a literal, and that literal is
 * an interpolation between two values that were themselves read from tokens.
 */
function strokeFor(fade: number, line: RGB | null, solved: RGB | null): string {
  if (fade <= 0) return "var(--rig-line)";
  if (fade >= 1) return "var(--rig-solved)";
  if (!line || !solved) {
    return fade >= 0.5 ? "var(--rig-solved)" : "var(--rig-line)";
  }
  const r = Math.round(line[0] + (solved[0] - line[0]) * fade);
  const g = Math.round(line[1] + (solved[1] - line[1]) * fade);
  const b = Math.round(line[2] + (solved[2] - line[2]) * fade);
  return `rgb(${r}, ${g}, ${b})`;
}

/* ==========================================================================
   THE NARROW BREAKPOINT

   useSyncExternalStore rather than a useState set inside an effect: it gives
   React an explicit SERVER snapshot, so the emitted markup is deterministic
   (always the full rig), and the client re-reads the real media query during
   hydration without a mismatch warning.
   ========================================================================== */

function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getNarrow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(NARROW_QUERY).matches;
}

const getNarrowOnServer = (): boolean => false;

/* ==========================================================================
   STYLE

   Scoped to .cv-skeleton and kept in the component rather than in globals.css
   so the rig is one self-contained file. Every colour here is a token by name,
   and every one of them is a volume-only token - which is legal here and ONLY
   here because the root element carries `volume`, inside which .volume{} remaps
   the ground and ink tokens to the dark set. --marker is 1.26:1 on --page;
   letting one of these escape onto a light surface is the exact bug this scope
   exists to make impossible.
   ========================================================================== */

const SKELETON_CSS = `
.cv-skeleton { display: block; margin: 0; width: 100%; }
.cv-skeleton .cv-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--d-ground);
  border: 1px solid var(--border);
  overflow: hidden;
}
.cv-skeleton .cv-svg { display: block; width: 100%; height: 100%; }
.cv-skeleton .cv-grid line { stroke: var(--grid); stroke-width: 1; }
.cv-skeleton .cv-cam { fill: none; stroke: var(--rig-line); stroke-width: 1; }
.cv-skeleton .cv-bone { stroke-width: 1; stroke-linecap: butt; }
.cv-skeleton .cv-marker { fill: var(--marker); }
.cv-skeleton .cv-ring { fill: none; stroke: var(--v-warning); stroke-width: 1; }
.cv-skeleton .cv-tick { fill: none; stroke: var(--marker); stroke-width: 1; }
.cv-skeleton .cv-bbox { fill: none; stroke: var(--rig-line); stroke-width: 1; }
.cv-skeleton .cv-datum-measured { fill: none; stroke: var(--marker); stroke-width: 1; }
.cv-skeleton .cv-datum-solved {
  fill: none;
  stroke: var(--rig-solved);
  stroke-width: 1;
  stroke-dasharray: 2 2;
}
.cv-skeleton .cv-leader { fill: none; stroke: var(--rig-line); stroke-width: 1; }
.cv-skeleton .cv-balloon {
  fill: var(--d-ground);
  stroke: var(--rig-line);
  stroke-width: 1;
}
.cv-skeleton .cv-balloon-text { fill: currentColor; }
.cv-skeleton .cv-telemetry {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 24px;
  color: var(--d-muted);
}
@media (max-width: 700px) {
  .cv-skeleton .cv-stage { aspect-ratio: 4 / 5; }
  .cv-skeleton .cv-telemetry {
    left: 12px;
    right: 12px;
    bottom: 12px;
    gap: 4px 16px;
  }
}
`;

/* ==========================================================================
   THE COMPONENT
   ========================================================================== */

export interface SkeletonProps {
  /** Extra classes on the figure. The `volume` scope is always applied. */
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    getNarrow,
    getNarrowOnServer
  );

  const slots = narrow ? MOBILE_SLOTS : FULL_SLOTS;
  const links = narrow ? MOBILE_LINKS : FULL_LINKS;
  const defaultW = narrow ? DEFAULT_NARROW_W : DEFAULT_W;
  const defaultH = narrow ? DEFAULT_NARROW_H : DEFAULT_H;

  /**
   * The finished picture. This is what the server writes into the HTML, what a
   * reader with JavaScript disabled keeps, and what a reduced-motion reader is
   * left looking at - produced by the same computeFrame the animation runs.
   */
  const terminal = useMemo(() => {
    const state = createFrameState(links.length);
    computeFrame(state, TERMINAL_MS, defaultW, defaultH, slots, links);
    return state;
  }, [slots, links, defaultW, defaultH]);

  const bbox = useMemo(
    () => boundingBox(slots, defaultW, defaultH),
    [slots, defaultW, defaultH]
  );

  const leaders = useMemo(
    () =>
      BALLOONS.map((balloon) => ({
        balloon,
        geometry: leaderGeometry(
          markerOf(balloon.marker),
          balloon.dx,
          balloon.dy,
          defaultW,
          defaultH
        ),
      })),
    [defaultW, defaultH]
  );

  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const gridEls = useRef<(SVGLineElement | null)[]>([]);
  const camEls = useRef<(SVGGElement | null)[]>([]);
  const boneEls = useRef<(SVGLineElement | null)[]>([]);
  const markerEls = useRef<(SVGCircleElement | null)[]>([]);
  const ringEls = useRef<(SVGCircleElement | null)[]>([]);
  const tickEls = useRef<(SVGPathElement | null)[]>([]);
  const bboxEl = useRef<SVGRectElement | null>(null);
  const datumEl = useRef<SVGGElement | null>(null);
  const datumMeasuredEl = useRef<SVGPathElement | null>(null);
  const datumSolvedEl = useRef<SVGPathElement | null>(null);
  const leaderEls = useRef<(SVGGElement | null)[]>([]);

  const residualEl = useRef<HTMLSpanElement | null>(null);
  const raysEl = useRef<HTMLSpanElement | null>(null);
  const visibleEl = useRef<HTMLSpanElement | null>(null);
  const solveEl = useRef<HTMLSpanElement | null>(null);
  const frameEl = useRef<HTMLSpanElement | null>(null);

  /**
   * The animation clock, held OUTSIDE the effect so it survives the effect
   * being torn down and rebuilt when the viewport crosses 375px. Crossing that
   * boundary swaps the marker set; it should not restart the take.
   *
   * It starts at TERMINAL_MS to match the markup the server produced.
   */
  const elapsedRef = useRef<number>(TERMINAL_MS);
  const rewoundRef = useRef<boolean>(false);

  useEffect(() => {
    const svg = svgRef.current;
    const stage = stageRef.current;
    if (!svg || !stage) return;

    const state = createFrameState(links.length);
    const size = { w: defaultW, h: defaultH };

    // Read the two rig inks once, from the live cascade, by token name. If the
    // cascade cannot be read at all, the crossfade falls back to a hard switch
    // rather than to a hardcoded colour.
    let rigLine: RGB | null = null;
    let rigSolved: RGB | null = null;
    try {
      const computed = getComputedStyle(svg);
      rigLine = parseColour(computed.getPropertyValue("--rig-line"));
      rigSolved = parseColour(computed.getPropertyValue("--rig-solved"));
    } catch {
      rigLine = null;
      rigSolved = null;
    }

    /**
     * Re-derive the viewBox from the measured panel.
     *
     * The viewBox is set to the panel's CSS pixel size, so one user unit is one
     * device-independent pixel. That is what keeps a marker disc at exactly
     * 2.5px and a bone at exactly 1px at every panel width - a fixed viewBox
     * would scale both with the panel, and "constant radius" would quietly stop
     * being true on a small screen.
     */
    const measure = (): boolean => {
      const rect = stage.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      size.w = rect.width;
      size.h = rect.height;
      svg.setAttribute("viewBox", `0 0 ${fmt(rect.width)} ${fmt(rect.height)}`);
      return true;
    };

    /** Everything that only moves when the panel does. */
    const layout = (): void => {
      const { w, h } = size;

      for (let i = 0; i < GRID_LINES.length; i++) {
        const el = gridEls.current[i];
        if (!el) continue;
        const line = GRID_LINES[i];
        el.setAttribute("x1", fmt(line.a.x * w));
        el.setAttribute("y1", fmt(line.a.y * h));
        el.setAttribute("x2", fmt(line.b.x * w));
        el.setAttribute("y2", fmt(line.b.y * h));
      }

      for (let i = 0; i < CAMERAS.length; i++) {
        const el = camEls.current[i];
        if (!el) continue;
        const camera = CAMERAS[i];
        el.setAttribute(
          "transform",
          `translate(${fmt(camera.x * w)} ${fmt(camera.y * h)}) ` +
            `rotate(${camera.angleDeg.toFixed(3)})`
        );
      }

      // The occlusion rings sit at the PREDICTED position, which is ground
      // truth - a lost marker has no measurement to draw.
      for (const slot of slots) {
        const el = ringEls.current[slot.index];
        if (!el) continue;
        el.setAttribute("cx", fmt(slot.marker.x * w));
        el.setAttribute("cy", fmt(slot.marker.y * h));
      }

      const box = bboxEl.current;
      if (box) {
        const next = boundingBox(slots, w, h);
        box.setAttribute("x", fmt(next.x));
        box.setAttribute("y", fmt(next.y));
        box.setAttribute("width", fmt(next.width));
        box.setAttribute("height", fmt(next.height));
      }

      // Leaders annotate the SOLVED joint, so they terminate on ground truth
      // and do not chase a drifting sample around the panel.
      for (let i = 0; i < BALLOONS.length; i++) {
        const group = leaderEls.current[i];
        if (!group) continue;
        const balloon = BALLOONS[i];
        const geometry = leaderGeometry(
          markerOf(balloon.marker),
          balloon.dx,
          balloon.dy,
          w,
          h
        );
        const line = group.querySelector<SVGLineElement>(".cv-leader-line");
        const tick = group.querySelector<SVGLineElement>(".cv-leader-tick");
        const disc = group.querySelector<SVGCircleElement>(".cv-balloon");
        const text = group.querySelector<SVGTextElement>(".cv-balloon-text");
        if (line) {
          line.setAttribute("x1", fmt(geometry.x1));
          line.setAttribute("y1", fmt(geometry.y1));
          line.setAttribute("x2", fmt(geometry.x2));
          line.setAttribute("y2", fmt(geometry.y2));
        }
        if (tick) {
          tick.setAttribute("x1", fmt(geometry.tickX1));
          tick.setAttribute("y1", fmt(geometry.tickY1));
          tick.setAttribute("x2", fmt(geometry.tickX2));
          tick.setAttribute("y2", fmt(geometry.tickY2));
        }
        if (disc) {
          disc.setAttribute("cx", fmt(geometry.balloonX));
          disc.setAttribute("cy", fmt(geometry.balloonY));
        }
        if (text) {
          text.setAttribute("x", fmt(geometry.balloonX));
          text.setAttribute("y", fmt(geometry.balloonY));
        }
      }
    };

    // Telemetry is written through textContent, and only when the string has
    // actually changed: five needless writes a frame is five needless style
    // recalculations a frame, for a readout that mostly does not move.
    const printed = {
      residual: "",
      rays: "",
      visible: "",
      solve: "",
      frame: "",
    };
    const print = (
      el: HTMLSpanElement | null,
      key: keyof typeof printed,
      value: string
    ): void => {
      if (!el || printed[key] === value) return;
      printed[key] = value;
      el.textContent = value;
    };

    /** One frame. Attribute writes only - never a React render. */
    const draw = (ms: number): void => {
      computeFrame(state, ms, size.w, size.h, slots, links);

      for (const slot of slots) {
        const i = slot.index;
        const occluded = state.occluded[i];

        const disc = markerEls.current[i];
        if (disc) {
          disc.setAttribute("cx", fmt(state.x[i]));
          disc.setAttribute("cy", fmt(state.y[i]));
          disc.style.display = occluded ? "none" : "";
        }

        const ring = ringEls.current[i];
        if (ring) ring.style.display = occluded ? "" : "none";

        const tick = tickEls.current[i];
        if (tick) {
          if (state.landed[i]) {
            tick.setAttribute("d", crosshairPath(state.x[i], state.y[i]));
            tick.style.display = "";
          } else {
            tick.style.display = "none";
          }
        }
      }

      for (let k = 0; k < links.length; k++) {
        const el = boneEls.current[k];
        if (!el) continue;
        const link = links[k];
        el.setAttribute("x1", fmt(state.x[link.a]));
        el.setAttribute("y1", fmt(state.y[link.a]));
        el.setAttribute("x2", fmt(state.x[link.b]));
        el.setAttribute("y2", fmt(state.y[link.b]));
        el.style.stroke = strokeFor(state.boneFade[k], rigLine, rigSolved);
        // Solid is measured, 3-2 dash is inferred. A product-wide rule, not a
        // decoration - and the redundant channel that carries the same meaning
        // as the --rig-line / --rig-solved step for a reader who cannot
        // separate those two greys.
        el.style.strokeDasharray = state.boneInferred[k] ? "3 2" : "none";
      }

      const box = bboxEl.current;
      if (box) {
        box.style.display = state.bboxVisible ? "" : "none";
        box.setAttribute("stroke-dashoffset", state.bboxOffset.toFixed(4));
      }

      const datum = datumEl.current;
      if (datum) datum.style.display = state.datumVisible ? "" : "none";
      if (state.datumVisible) {
        const measuredPath = datumMeasuredEl.current;
        const solvedPath = datumSolvedEl.current;
        if (measuredPath) {
          measuredPath.setAttribute(
            "d",
            crosshairPath(state.datumMeasuredX, state.datumMeasuredY)
          );
        }
        if (solvedPath) {
          solvedPath.setAttribute(
            "d",
            crosshairPath(state.datumSolvedX, state.datumSolvedY)
          );
        }
      }

      print(residualEl.current, "residual", state.residualMm.toFixed(2));
      print(raysEl.current, "rays", String(state.rays));
      print(visibleEl.current, "visible", String(state.visible));
      print(solveEl.current, "solve", String(state.solve));
      print(frameEl.current, "frame", padFrame(state.frame));
    };

    measure();
    layout();
    draw(elapsedRef.current);

    // Re-derive the mapping whenever the panel changes size. Under reduced
    // motion this is the only thing that ever runs again, and it still routes
    // through the same draw() at the same instant.
    const resize = new ResizeObserver(() => {
      if (!measure()) return;
      layout();
      draw(elapsedRef.current);
    });
    resize.observe(stage);

    // THE REDUCED-MOTION GUARD. Checked here, before anything is scheduled, so
    // no requestAnimationFrame work is ever queued for a reader who asked for
    // none - not queued and cancelled, never queued. The terminal frame is
    // already drawn above, by the same function the animation uses.
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      return () => resize.disconnect();
    }

    let raf = 0;
    let last = 0;
    let running = false;
    let inView = true;

    const tick = (now: number): void => {
      // Clamp the step. A tab that was backgrounded, or a long main-thread
      // stall, would otherwise hand us a delta of several seconds and skip the
      // rig through most of a phase in a single frame.
      const dt = Math.min(100, Math.max(0, now - last));
      last = now;
      elapsedRef.current += dt;
      draw(elapsedRef.current);
      raf = requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (running) return;
      running = true;
      // Resume from NOW, so the paused interval is not credited to the clock.
      // The rig picks up at the beat it stopped on instead of restarting.
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const stop = (): void => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };

    const sync = (): void => {
      if (inView && !document.hidden) start();
      else stop();
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) inView = entry.isIntersecting;
          sync();
        },
        { threshold: 0 }
      );
      observer.observe(stage);
    }

    const onVisibilityChange = (): void => sync();
    document.addEventListener("visibilitychange", onVisibilityChange);

    // THE REWIND. The finished solve is already in the DOM; this drops it back
    // to frame zero one tick after mount and lets it play forward. The rig is
    // never assembled out of nothing - it is a complete document, rewound.
    const rewind = window.setTimeout(() => {
      if (!rewoundRef.current) {
        rewoundRef.current = true;
        elapsedRef.current = 0;
      }
      draw(elapsedRef.current);
      sync();
    }, 0);

    return () => {
      window.clearTimeout(rewind);
      stop();
      resize.disconnect();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [slots, links, defaultW, defaultH]);

  /**
   * The accessible name states the TERMINAL reading - the picture that is in
   * the HTML and the picture a reduced-motion reader keeps. Describing the
   * animation instead would name something a screen reader user never gets.
   */
  const label =
    `Motion capture volume: a locked solve. All ${slots.length} markers ` +
    `measured on ground truth, ${CAMERA_COUNT} of ${CAMERA_COUNT} camera rays ` +
    `contributing, residual ${RESIDUAL_FLOOR_MM.toFixed(2)} millimetres, ` +
    `solve quality ${terminal.solve} of 100.`;

  return (
    <figure
      className={
        className ? `volume cv-skeleton ${className}` : "volume cv-skeleton"
      }
    >
      <style>{SKELETON_CSS}</style>

      <div className="cv-stage" ref={stageRef}>
        <svg
          ref={svgRef}
          className="cv-svg"
          viewBox={`0 0 ${defaultW} ${defaultH}`}
          role="img"
          aria-label={label}
        >
          {/* The floor. Carries no information, is referenced by nothing, and
              is the one element in the system deliberately below 3:1. */}
          <g className="cv-grid" aria-hidden="true">
            {GRID_LINES.map((line, i) => (
              <line
                key={`${line.axis}-${i}`}
                ref={(el) => {
                  gridEls.current[i] = el;
                }}
                x1={fmt(line.a.x * defaultW)}
                y1={fmt(line.a.y * defaultH)}
                x2={fmt(line.b.x * defaultW)}
                y2={fmt(line.b.y * defaultH)}
              />
            ))}
          </g>

          {/* Eight perimeter cameras, each a small frustum with one ray toward
              volume centre. The glyph is written once in a local frame and
              rotated into place by the angle topology.ts already derived. */}
          <g aria-hidden="true">
            {CAMERAS.map((camera, i) => (
              <g
                key={camera.id}
                ref={(el) => {
                  camEls.current[i] = el;
                }}
                transform={
                  `translate(${fmt(camera.x * defaultW)} ` +
                  `${fmt(camera.y * defaultH)}) ` +
                  `rotate(${camera.angleDeg.toFixed(3)})`
                }
              >
                <polygon className="cv-cam" points="0,-2.5 0,2.5 12,6 12,-6" />
                <line className="cv-cam" x1="12" y1="0" x2="32" y2="0" />
              </g>
            ))}
          </g>

          {/* The LOCKED bounding box. pathLength 1 turns the whole perimeter
              into a single unit of dash, so one dashoffset traces it on and
              retracts it - no per-edge maths, and no opacity. */}
          <rect
            className="cv-bbox"
            ref={bboxEl}
            x={fmt(bbox.x)}
            y={fmt(bbox.y)}
            width={fmt(bbox.width)}
            height={fmt(bbox.height)}
            pathLength="1"
            strokeDasharray="1 1"
            strokeDashoffset={terminal.bboxOffset.toFixed(4)}
            style={{ display: terminal.bboxVisible ? undefined : "none" }}
          />

          <g>
            {links.map((link, k) => (
              <line
                key={link.key}
                className="cv-bone"
                ref={(el) => {
                  boneEls.current[k] = el;
                }}
                x1={fmt(terminal.x[link.a])}
                y1={fmt(terminal.y[link.a])}
                x2={fmt(terminal.x[link.b])}
                y2={fmt(terminal.y[link.b])}
                style={{
                  // The server has no cascade to read, so it emits the token
                  // ends of the crossfade. At TERMINAL_MS every bone is solid
                  // --rig-line, so nothing is lost.
                  stroke: strokeFor(terminal.boneFade[k], null, null),
                  strokeDasharray: terminal.boneInferred[k] ? "3 2" : "none",
                }}
              />
            ))}
          </g>

          {/* The PLV datum: two crosshairs that ought to coincide, drawn 6px
              apart while the solve is lost. Hidden once they agree. */}
          <g
            ref={datumEl}
            aria-hidden="true"
            style={{ display: terminal.datumVisible ? undefined : "none" }}
          >
            <path
              className="cv-datum-solved"
              ref={datumSolvedEl}
              d={crosshairPath(terminal.datumSolvedX, terminal.datumSolvedY)}
            />
            <path
              className="cv-datum-measured"
              ref={datumMeasuredEl}
              d={crosshairPath(
                terminal.datumMeasuredX,
                terminal.datumMeasuredY
              )}
            />
          </g>

          {/* Rings mark the markers the cameras lose during DRIFT, at the
              solver's predicted position. Absent from the terminal frame. */}
          <g>
            {slots
              .filter((slot) => slot.occludable)
              .map((slot) => (
                <circle
                  key={`ring-${slot.marker.id}`}
                  className="cv-ring"
                  ref={(el) => {
                    ringEls.current[slot.index] = el;
                  }}
                  cx={fmt(slot.marker.x * defaultW)}
                  cy={fmt(slot.marker.y * defaultH)}
                  r={RING_R}
                  style={{
                    display: terminal.occluded[slot.index] ? undefined : "none",
                  }}
                />
              ))}
          </g>

          {/* A crosshair tick appears on each marker as it lands. */}
          <g aria-hidden="true">
            {slots.map((slot) => (
              <path
                key={`tick-${slot.marker.id}`}
                className="cv-tick"
                ref={(el) => {
                  tickEls.current[slot.index] = el;
                }}
                d={crosshairPath(
                  terminal.x[slot.index],
                  terminal.y[slot.index]
                )}
                style={{
                  display: terminal.landed[slot.index] ? undefined : "none",
                }}
              />
            ))}
          </g>

          <g>
            {slots.map((slot) => (
              <circle
                key={slot.marker.id}
                className="cv-marker"
                ref={(el) => {
                  markerEls.current[slot.index] = el;
                }}
                cx={fmt(terminal.x[slot.index])}
                cy={fmt(terminal.y[slot.index])}
                r={MARKER_R}
                style={{
                  display: terminal.occluded[slot.index] ? "none" : undefined,
                }}
              />
            ))}
          </g>

          {/* Join keys 01 / 02 / 03, matching the SEAL / JUDGE / PAID columns
              below the panel. Dropped entirely on the narrow rig, where a
              leader would have to cross the figure to reach its joint - and the
              columns drop their numbers with it, rather than keeping numbers
              that index nothing. */}
          {!narrow && (
            <g aria-hidden="true">
              {leaders.map(({ balloon, geometry }, i) => (
                <g
                  key={balloon.key}
                  ref={(el) => {
                    leaderEls.current[i] = el;
                  }}
                >
                  <line
                    className="cv-leader cv-leader-line"
                    x1={fmt(geometry.x1)}
                    y1={fmt(geometry.y1)}
                    x2={fmt(geometry.x2)}
                    y2={fmt(geometry.y2)}
                  />
                  <line
                    className="cv-leader cv-leader-tick"
                    x1={fmt(geometry.tickX1)}
                    y1={fmt(geometry.tickY1)}
                    x2={fmt(geometry.tickX2)}
                    y2={fmt(geometry.tickY2)}
                  />
                  <circle
                    className="cv-balloon"
                    cx={fmt(geometry.balloonX)}
                    cy={fmt(geometry.balloonY)}
                    r={BALLOON_R}
                  />
                  <text
                    className="label cv-balloon-text"
                    x={fmt(geometry.balloonX)}
                    y={fmt(geometry.balloonY)}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {balloon.key}
                  </text>
                </g>
              ))}
            </g>
          )}
        </svg>

        {/* Telemetry. Every figure is a real quantity of the simulation's own
            state, in pipeline order with the frame counter last. It is
            aria-hidden because it rewrites itself many times a second and would
            flood a screen reader; the figure's accessible name states the same
            settled reading in words. Nothing here claims a physical fact about
            a room that does not exist - no feed rate, no volume dimensions. */}
        <div className="cv-telemetry telemetry" aria-hidden="true">
          <span>
            RESIDUAL <span ref={residualEl}>{terminal.residualMm.toFixed(2)}</span>{" "}
            mm
          </span>
          <span>
            RAYS <span ref={raysEl}>{terminal.rays}</span>/{CAMERA_COUNT}
          </span>
          <span>
            MARKERS <span ref={visibleEl}>{terminal.visible}</span>/{slots.length}
          </span>
          <span>
            SOLVE <span ref={solveEl}>{terminal.solve}</span>
          </span>
          <span>
            FRAME <span ref={frameEl}>{padFrame(terminal.frame)}</span>
          </span>
        </div>
      </div>
    </figure>
  );
}

export default Skeleton;
