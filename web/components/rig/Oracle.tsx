"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { servoMs } from "@/lib/rig";

import {
  VERTEX_FLOATS,
  buildIcosphere,
  meshLines,
  modelView,
  perspective,
  resolveShell,
  ringLines,
  rotation3,
  verticalScale,
  type Mesh,
  type Vec3,
} from "./oracleGeometry";

/**
 * THE VERDICT ORACLE - the rig on /task/[id].
 *
 * A wireframe shell with a lit core, drawn as a technical drawing straight onto
 * the light plate. It replaces the inspection arm, and the arm set the bar: it traversed the REAL sealed
 * clauses and came to rest on the one that blocked the escrow. A decorative orb
 * on the page that decides whether someone gets paid would be a downgrade, so
 * every visible property of this object is a property of the verdict.
 *
 * WHAT THE DRAWING SAYS, CHANNEL BY CHANNEL
 * -----------------------------------------
 * - HOW FINELY THE SHELL IS TESSELLATED  = the judge's confidence. Subdivision
 *   generations resolve in order; confidence 0 is the bare icosahedral cage and
 *   confidence 100 is the full mesh. See `resolveShell` in oracleGeometry.ts,
 *   which states the mapping and why it is resolution rather than opacity.
 * - SOLID OR DASHED                      = whether the confidence cleared the
 *   pass limit. Product-wide, dashed means inferred and solid means measured; a
 *   held task's panel is dashed for exactly this reason, and a verdict the
 *   system refused to act on is exactly a hypothesis. The topmost, incompletely
 *   resolved generation is always dashed on top of that, because it is the part
 *   that genuinely is not fully there.
 * - THE RING                             = passed clauses over sealed clauses.
 *   An arc gauge, not an enumeration: this component is given a COUNT, not a
 *   per-clause list, so it draws a proportion and makes no claim about WHICH
 *   clause failed. The table below the rig makes that claim, because it knows.
 * - THE CORE                             = what happened to the money. Steady
 *   at the identity ink when the chain paid, arrested in the alarm ink when it
 *   refunded, pulsing in the held ink while nothing has moved, and OFF when
 *   nothing has been judged.
 * - THE MOTION                           = whether the matter is resolved.
 *   Settled turns steadily. Refunded stops dead. Held never settles. Open and
 *   submitted do not move at all, because no measurement has happened and
 *   animating one would be a lie.
 *
 * WHAT MAKES IT SAFE TO SHIP
 * --------------------------
 * 1. THE SERVER RENDERS A COMPLETE OBJECT. A canvas cannot server-render, so
 *    the markup carries a POSTER: an inline SVG wireframe of the same mesh, at
 *    the same resting pose, through the same projection, in the same state ink.
 *    The canvas mounts over it and is revealed only once it has drawn a frame.
 *    With JS blocked, before hydration, with WebGL unavailable, or after an
 *    unrecoverable context loss, the poster is what the reader sees - and it is
 *    a deliberate drawing, not a blank rectangle.
 * 2. REDUCED MOTION IS CHECKED BEFORE THE FIRST FRAME IS SCHEDULED. Exactly one
 *    frame is drawn, at the terminal pose, by the same `poseAt` the loop uses.
 *    No rAF work is ever queued - not queued and cancelled, never queued.
 * 3. THE LOOP NEVER CALLS setState. It writes uniforms. React renders this
 *    component when its props change and at no other time.
 * 4. NO HEX LITERAL FOR A DESIGN COLOUR APPEARS IN THIS FILE. Every ink is read
 *    out of the live cascade by token name. If the cascade cannot be read, the
 *    canvas is not shown at all rather than guessing - the poster paints from
 *    var() and cannot be wrong.
 * 5. IT ADMITS FAILURE. Shader compile and link status are checked, context
 *    loss is handled, and any of them falls back to the poster with one console
 *    warning. The reference this was rebuilt from checks none of that and fails
 *    silently to black.
 */

/* ==========================================================================
   PUBLIC API
   ========================================================================== */

/** The five states a record can actually be in. There is no sixth. */
export type OracleState =
  | "OPEN"
  | "SUBMITTED"
  | "HELD"
  | "SETTLED"
  | "REFUNDED";

export interface OracleProps {
  /**
   * The judge's confidence, 0-100, or null when nothing has been judged.
   * A null confidence is never rendered as a number and never as a full shell.
   */
  confidence: number | null;
  /** The pass limit the verdict was gated on. Read from the server, not guessed. */
  threshold: number;
  /** How many clauses were sealed. */
  clauseCount: number;
  /** How many of them passed. Clamped into 0..clauseCount before it is drawn. */
  passedCount: number;
  /** The record state. HELD is not REFUNDED and must never look like one. */
  state: OracleState;
  /** Extra classes on the figure. */
  className?: string;
  /**
   * Whether the full-bleed page field is behind this rig.
   *
   * Only meaningful on the plate, and it buys exactly one thing: the core's
   * emission is additive, so how bright it may get before it saturates depends
   * on what is BEHIND the canvas. A flat --page and a --page with the field
   * adding light to it are two different ceilings. See GLOW_FIELD_SCALE.
   *
   * Defaults to false, which is the conservative reading for a new mount: a
   * flat backdrop is the one where the brighter scale is safe, so forgetting
   * this prop under a field costs brightness rather than correctness.
   */
  fieldBacked?: boolean;
  /**
   * Which ground the object is drawn on.
   *
   * "volume" is the bounded dark viewport. "plate" draws it straight onto the
   * light page as a technical drawing - no panel, no black rectangle, the
   * page's own field showing through the wireframe.
   *
   * This is NOT just a background swap. The volume inks are unusable on paper:
   * --marker measures 1.26:1 on --page, so an oracle that merely lost its panel
   * would lose the object with it. Every ink is remapped to its light-ground
   * equivalent, and each one clears 3:1 as a line - --accent 5.36, --hairline
   * 3.14, --negative 5.25, --warning 6.69.
   */
  surface?: OracleSurface;
}

export type OracleSurface = "volume" | "plate";

/**
 * The light-ground equivalent of every volume ink.
 *
 * Roles are preserved rather than colours: identity stays identity, inferred
 * geometry stays the quieter step below it, and the two status inks keep their
 * meaning. Because the mapping happens at READ time and the results are stored
 * under the original keys, every draw call downstream is unchanged.
 */
const PLATE_INK: Record<string, string> = {
  "--marker": "--accent",
  "--rig-line": "--text-faint",
  "--rig-solved": "--hairline",
  "--v-negative": "--negative",
  "--v-warning": "--warning",
  "--d-ground": "--page",
};

const inkToken = (token: string, surface: OracleSurface): string =>
  surface === "plate" ? (PLATE_INK[token] ?? token) : token;

/* ==========================================================================
   GEOMETRY CONSTANTS
   ========================================================================== */

/**
 * Two subdivisions: 162 vertices, 480 unique edges, split 120 / 120 / 240 by
 * generation.
 *
 * The reference asked three.js for detail 15, which is roughly two million
 * triangles and reads as a solid fog rather than as a wireframe. Two is the
 * level where the structure is still legible as structure: the coarse cage
 * stays visible under the fine mesh, and an edge is still long enough on screen
 * to carry a readable dash.
 */
const SHELL_SUBDIVISIONS = 2;
/** The core is a body, not a diagram. One subdivision is enough to read round. */
const CORE_SUBDIVISIONS = 1;
/**
 * The poster is coarser on purpose. The full shell is 480 edges, and 480 SVG
 * lines is not a reasonable thing to put in a document that also has to carry a
 * verdict. One subdivision is 120 - the same object, drawn at survey detail.
 */
const POSTER_SUBDIVISIONS = 1;

const SHELL_RADIUS = 1;
const CORE_RADIUS = 0.42;
const RING_RADIUS = 1.18;
const RING_SEGMENTS = 96;

/** Camera. Far enough back that the ring clears the frame at every aspect. */
const CAMERA_DIST = 3.6;
const FOV_Y = 0.86;
const NEAR_PLANE = 0.1;
const FAR_PLANE = 20;

/**
 * The resting pose. Chosen so no vertex sits exactly on the silhouette at the
 * centre line, where a wireframe collapses into a visible seam.
 */
const RESTING_YAW = 0.62;
const RESTING_PITCH = -0.26;

/** The arc the shell travels while it comes up to speed. */
const SPIN_ARC = 0.9;

/**
 * The spin-up move, and therefore the terminal instant.
 *
 * At 620ms and RAMP_MS = 70 the profile is 77% cruise, which is the shape
 * `lib/rig.ts` documents: a fixed-millisecond ramp with the extra distance
 * spent at constant velocity, not a bezier stretched over a longer duration.
 * That is the property that reads as a motor rather than as an animation, and
 * it is why this rig uses `servoMs` instead of a CSS transition.
 */
const SPINUP_MS = 620;

/** Steady yaw after spin-up, radians per millisecond. */
const SETTLED_YAW_RATE = 0.0003; // ~21 seconds per revolution
const HELD_YAW_RATE = 0.00009;

/**
 * How far the pointer may lean the OUTER shell, in radians. ~9 degrees.
 *
 * Raised from 0.11 now that the pointer is tracked across the whole page
 * rather than only while it is over the object: most of the time the cursor is
 * somewhere else entirely, so the lean has to be legible from the corner of the
 * eye to read as a response at all.
 */
const PARALLAX = 0.16;

/**
 * The core leans by this fraction of the shell's lean, and the SIGN is the
 * point: it is negative, so the core turns slightly AGAINST the shell.
 *
 * If both layers took the same offset the object would rotate as one rigid
 * body and the cursor would just be turning a turntable. Making the core lag
 * (a positive fraction) already separates them; making it counter-rotate
 * separates them roughly twice as far for a third of the movement, because the
 * two contributions add instead of cancelling:
 *
 *     lag       at +0.3   ->  0.160 - 0.048  =  0.112 rad of separation
 *     counter   at -0.3   ->  0.160 + 0.048  =  0.208 rad
 *
 * So the core moves only ~2.8 degrees - slight, as asked - while the visible
 * gap between the two shells nearly doubles. Counter-motion is also what the
 * eye actually reads as depth: two things drifting the same way look like one
 * thing sliding, and two things drifting apart look like one thing INSIDE
 * another.
 *
 * It stays small deliberately. Past about -0.5 the core stops reading as
 * suspended and starts reading as a second object with its own agenda, which
 * is a different drawing.
 */
const CORE_PARALLAX_RATIO = -0.3;

/**
 * Pointer speed, in CSS pixels per millisecond, that commands the full spin
 * boost. 2.5 is a brisk deliberate sweep across a laptop screen; a slow read
 * hovers well under 0.5, and a hard flick tops out around 5 or 6.
 */
const SPIN_SPEED_REF = 2.5;

/**
 * Extra yaw rate at full boost, radians per millisecond.
 *
 * Four times SETTLED_YAW_RATE, so a fast sweep takes the shell from a
 * 21-second revolution to roughly 4.2 seconds. Enough to read as the object
 * being dragged along by the movement; not so much that it becomes a fidget
 * spinner and stops looking like an instrument.
 */
const SPIN_BOOST_MAX = 0.0012;

/**
 * How fast the measured speed falls back to zero once the pointer stops.
 *
 * The decay lives on the SPEED, not on the accumulated rotation. That is the
 * whole design: when you stop moving, the shell winds back down to its base
 * rate over about half a second and stays wherever it got to. It does not
 * rewind - a wheel spun harder ends up further round, it does not snap back.
 */
const SPIN_DECAY_TAU_MS = 170;

/**
 * Below this pointer speed the rig considers the cursor stopped.
 *
 * Not zero, and not a "did an event arrive" check. A hand resting on a mouse
 * still emits tiny moves, and a gesture that pauses for a frame mid-sweep has
 * not stopped. A small positive floor is what separates held-still from
 * between-two-movements.
 */
const IDLE_SPEED_THRESHOLD = 0.05;

/**
 * How quickly the idle state comes and goes.
 *
 * Deliberately slower than the spin decay, because the delay is what makes the
 * pulse read as the object SETTLING rather than as a second thing that fires
 * whenever you pause. Two gates have to open in order: the measured speed has
 * to decay past IDLE_SPEED_THRESHOLD first, which takes ~660ms after a brisk
 * sweep, and only then does this ramp.
 *
 * Modelled from the real constants: half depth at ~910ms after the cursor
 * stops, full depth at ~1520ms. A 300ms or even a 600ms hesitation mid-gesture
 * reaches exactly 0.000, because the speed gate has not opened yet - the pause
 * guard is the speed decay, not this ramp.
 *
 * It leaves immediately on the next movement.
 */
const IDLE_TAU_MS = 380;

/**
 * Extra depth on the core's emission while the cursor is still.
 *
 * Rides the SAME oscillator as the shell's breathing rather than introducing a
 * second period. Two independent periods would drift against each other and
 * read as two mechanisms disagreeing; sharing one means the core simply
 * breathes deeper as the rig comes to rest, which is one mechanism with two
 * states.
 */
const IDLE_PULSE_DEPTH = 0.5;

/** Size on the same beat, so the core breathes rather than blinks. */
const IDLE_PULSE_RADIUS = 0.11;

/**
 * The core's emission is scaled down on the light plate, and this is what makes
 * the pulse possible rather than what dims it.
 *
 * The glow is ADDITIVE - blendFunc(ONE, ONE) - so it adds to whatever is behind
 * it: the ground the canvas cleared to in a volume, and on the plate the PAGE
 * itself, since the buffer is cleared transparent and the compositor does the
 * addition. On the near-black volume ground there is room to add almost
 * anything: --marker saturates at an intensity of 1.106 and the peak reaches
 * 0.718, so nothing clips.
 *
 * The light plate has almost no room. --accent over --page saturates at 0.368,
 * and the UNPULSED intensity was already 0.42. The core was clipped to white at
 * rest, which meant the top half of every breath was cropped flat: turning the
 * depth up made the trough deeper and could not make the peak brighter, because
 * the peak had nowhere to go.
 *
 * At 0.5 the peak lands on 0.359, just under the ceiling, and the swing goes
 * from about 1.1x of visible range to 4.0x. The core is dimmer at rest and the
 * breath is far stronger, which is the trade that was actually being asked for.
 *
 * That 0.009 of margin is real but it is computed against a FLAT --page, and it
 * only survives where the plate actually is flat. See GLOW_FIELD_SCALE.
 */
const GLOW_PLATE_SCALE = 0.5;

/**
 * The same headroom calculation, redone for a plate with the field behind it.
 *
 * Making the canvas transparent so the full-bleed field shows through moved the
 * backdrop out from under this number. The field ADDS light, and the glow adds
 * more on top, so the ceiling comes down - and it comes down past the peak:
 *
 *   flat --page          clips at intensity 0.368 (green)   peak 0.359 fits
 *   field, typical       clips at 0.322          (blue)     peak is 0.037 over
 *   field, at its peak   clips at 0.214          (blue)     peak is 0.145 over
 *
 * So it clipped at TYPICAL field values, not just extreme ones. The binding
 * channel also changes: on bare --page it is green, but the field's second ink
 * is --warning, whose blue (0.498) is higher than --accent's (0.388), so blue
 * saturates first once the field is contributing.
 *
 * The clip that results is worse than a static one. The ceiling moves as the
 * probe orbits, so the breath is cropped by a varying amount on a period the
 * rig's own oscillator does not own - an amplitude wobble driven by something
 * else on the page, which is exactly the kind of borrowed motion this rig is
 * built to avoid.
 *
 * The worst real backdrop is the field at full amplitude with its tint at the
 * --warning end of the mix, which is rgb(220, 229, 234) - and it has to be
 * taken from the actual mix rather than from a per-channel maximum, since the
 * tint is ONE colour along t and cannot be bluest and greenest at once. That
 * backdrop clips at intensity 0.2138.
 *
 * 0.27 puts the peak at 0.194, landing blue at 253 of 255. 0.29 also clears but
 * only by a single 8-bit unit, which is the quantisation noise floor rather
 * than a margin; 0.31 does NOT clear, despite looking like it should - it lands
 * at 256.
 *
 * Nothing is lost but absolute brightness. The swing is a pure scaling of
 * uIntensity, so its RATIO is unchanged at 3.0x, and since it no longer clips,
 * more of that swing is actually visible than before rather than less.
 *
 * /task/[id] keeps 0.5. AppShell paints an opaque --page over the fixed field
 * there, so that plate really is flat and dimming it would be paying for a
 * backdrop it does not have.
 */
const GLOW_FIELD_SCALE = 0.27;
/**
 * Time constant of the pointer filter.
 *
 * This is an exponential smoother and NOT a trapezoid, deliberately. A servo
 * profile is a move to a commanded position; the pointer is not a commanded
 * position, it is a signal that changes every frame, and you cannot run a
 * profile to a target that has already moved. Smoothing is the honest tool for
 * a continuously varying input, and the step is computed from the real frame
 * delta so it behaves the same at 60Hz and 120Hz.
 */
const TRACK_TAU_MS = 180;

/** Dash pitch in CSS pixels: 3 on, 2 off - the same "3 2" the rest of the app uses. */
const DASH_PITCH_PX = 5;
const DASH_DUTY = 0.6;

/* ==========================================================================
   THE MESHES AND THE BUFFER

   Built once at module load. The vertex data never changes - only the draw
   RANGES depend on the verdict - so one immutable interleaved buffer serves
   every state and every panel size.
   ========================================================================== */

const SHELL_MESH: Mesh = buildIcosphere(SHELL_SUBDIVISIONS);
const CORE_MESH: Mesh = buildIcosphere(CORE_SUBDIVISIONS);
const POSTER_MESH: Mesh = buildIcosphere(POSTER_SUBDIVISIONS);

const SHELL_BATCH = meshLines(SHELL_MESH, SHELL_RADIUS);
const CORE_BATCH = meshLines(CORE_MESH, CORE_RADIUS);
const RING_BATCH = ringLines(RING_RADIUS, RING_SEGMENTS);

/** Vertex offsets into the single interleaved buffer. */
const SHELL_FIRST = 0;
const CORE_FIRST = SHELL_BATCH.vertexCount;
const RING_FIRST = CORE_FIRST + CORE_BATCH.vertexCount;
const TOTAL_VERTICES = RING_FIRST + RING_BATCH.vertexCount;

const VERTEX_DATA = (() => {
  const data = new Float32Array(TOTAL_VERTICES * VERTEX_FLOATS);
  data.set(SHELL_BATCH.data, SHELL_FIRST * VERTEX_FLOATS);
  data.set(CORE_BATCH.data, CORE_FIRST * VERTEX_FLOATS);
  data.set(RING_BATCH.data, RING_FIRST * VERTEX_FLOATS);
  return data;
})();

/** The screen-filling triangle strip the core glow is painted through. */
const QUAD_DATA = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

/* ==========================================================================
   THE STATE TABLE

   One row per record state. Every visual difference between the five states
   lives here, so "does HELD look like REFUNDED?" is a question you answer by
   reading a table rather than by reading a render function.
   ========================================================================== */

interface Behaviour {
  /** Steady yaw rate after spin-up, rad/ms. 0 means the axis stops dead. */
  yawRate: number;
  /** Amplitude of a slow, never-repeating yaw wander. HELD only. */
  wander: number;
  wanderPeriodMs: number;
  /** Amplitude of the slow pitch nutation. HELD only. */
  nutation: number;
  nutationPeriodMs: number;
  /** Sine pulse depth on the shell scale, and on the core glow. HELD only. */
  pulseScale: number;
  pulseGlow: number;
  pulsePeriodMs: number;
  /** Near-hemisphere ink for the shell, by token name. */
  shellNear: string;
  /** Far-hemisphere ink. A COLOUR step, never an alpha ramp - see DESIGN.md. */
  shellFar: string;
  /** The core ink, or null when the core is off because nothing was judged. */
  core: string | null;
  /** The ink for the passed arc of the verdict ring. */
  ringArc: string;
  /** Peak glow intensity. 0 turns the glow pass off entirely. */
  glow: number;
  /** Whether the object responds to the pointer. An arrested object does not. */
  tracksPointer: boolean;
  /** Whether a frame loop runs at all. */
  animates: boolean;
  /**
   * True when the rig reaches a genuinely frozen pose and the loop can stop.
   * A stopped axis does not need sixty frames a second to stay stopped.
   */
  freezes: boolean;
}

/**
 * Every ink here is a volume-only token, which is legal because the root
 * element carries `volume` - inside which globals.css remaps the ground and ink
 * tokens to the dark set. --marker is 1.26:1 on --page; letting one of these
 * escape onto a light surface is the exact bug that scope exists to prevent.
 *
 * Note what is NOT here: --v-positive. Green in this system means "the chain
 * moved money" and is spent on the settled stamp and the receipt, once each. A
 * whole shell painted in it would make the page's one money-moved signal into
 * wallpaper, so the rig's settled ink is the volume identity colour instead.
 */
const BEHAVIOUR: Record<OracleState, Behaviour> = {
  /* Resolved and locked - and it TUMBLES rather than sitting on a turntable.
     This was one axis at 39 seconds a revolution, which is a lathe: correct
     about being calibrated, and so restrained that the object read as a still
     image with a slow drift. The reference tumbles on two axes at about 21
     seconds and breathes on a 3.14-second sine, and that is what makes it read
     as a thing suspended in a field rather than a diagram of one.

     The nutation is what supplies the second axis. It is deliberately NOT a
     second constant rate: two constant rates are a fixed compound rotation and
     the object still repeats on a short period, whereas a slow sine on pitch
     against a constant yaw never quite retraces the same path.

     Everything here is still phased to start at sin(0) = 0, so the terminal
     instant is scale 1 at the resting pitch in every state - which is what
     keeps the SSR poster a single fixed drawing rather than one frame of an
     animation. */
  SETTLED: {
    yawRate: SETTLED_YAW_RATE,
    wander: 0,
    wanderPeriodMs: 1,
    nutation: 0.13,
    nutationPeriodMs: 15700,
    // The reference pulses 5%. 3.5% here, because that shell carries a dashed
    // generation and a ring gauge: at 5% the dash pitch visibly breathes with
    // it, and a dash pattern in this product means "inferred", so it may not
    // wobble for decorative reasons.
    pulseScale: 0.035,
    pulseGlow: 0.14,
    // 3140ms - the reference's sin(Date.now() * 0.002), matched exactly.
    pulsePeriodMs: 3140,
    shellNear: "--marker",
    shellFar: "--rig-solved",
    core: "--marker",
    ringArc: "--marker",
    glow: 0.42,
    tracksPointer: true,
    animates: true,
    freezes: false,
  },
  // Out of tolerance is a STOP, not a wobble. The shell is intact and
  // achromatic - the measurement was good - and the alarm is in the core alone.
  // It does not follow the pointer either: an arrested object is arrested.
  REFUNDED: {
    yawRate: 0,
    wander: 0,
    wanderPeriodMs: 1,
    nutation: 0,
    nutationPeriodMs: 1,
    pulseScale: 0,
    pulseGlow: 0,
    pulsePeriodMs: 1,
    shellNear: "--rig-line",
    shellFar: "--rig-solved",
    core: "--v-negative",
    ringArc: "--rig-line",
    glow: 0.3,
    tracksPointer: false,
    animates: true,
    freezes: true,
  },
  // Unresolved. Two incommensurate periods on top of a slow rate, so the pose
  // never repeats and the object never arrives anywhere. The shell is drawn in
  // the inferred ink because a held ruling is exactly that.
  HELD: {
    yawRate: HELD_YAW_RATE,
    wander: 0.22,
    wanderPeriodMs: 11_300,
    nutation: 0.16,
    nutationPeriodMs: 9_700,
    pulseScale: 0.028,
    pulseGlow: 0.34,
    pulsePeriodMs: 5_300,
    shellNear: "--rig-solved",
    shellFar: "--rig-solved",
    core: "--v-warning",
    ringArc: "--v-warning",
    glow: 0.34,
    tracksPointer: true,
    animates: true,
    freezes: false,
  },
  // Nothing has been judged. Dim, unlit, and completely still: there is no
  // measurement to animate, and pretending otherwise is the one thing the rigs
  // in this product are not allowed to do.
  OPEN: {
    yawRate: 0,
    wander: 0,
    wanderPeriodMs: 1,
    nutation: 0,
    nutationPeriodMs: 1,
    pulseScale: 0,
    pulseGlow: 0,
    pulsePeriodMs: 1,
    shellNear: "--rig-solved",
    shellFar: "--rig-solved",
    core: null,
    ringArc: "--rig-solved",
    glow: 0,
    tracksPointer: false,
    animates: false,
    freezes: true,
  },
  SUBMITTED: {
    yawRate: 0,
    wander: 0,
    wanderPeriodMs: 1,
    nutation: 0,
    nutationPeriodMs: 1,
    pulseScale: 0,
    pulseGlow: 0,
    pulsePeriodMs: 1,
    shellNear: "--rig-solved",
    shellFar: "--rig-solved",
    core: null,
    ringArc: "--rig-solved",
    glow: 0,
    tracksPointer: false,
    animates: false,
    freezes: true,
  },
};

/** Every token the renderer needs, so they can be read in one pass. */
const INK_TOKENS = [
  "--marker",
  "--rig-line",
  "--rig-solved",
  "--v-negative",
  "--v-warning",
  "--d-ground",
] as const;

/* ==========================================================================
   THE POSE

   One pure function of elapsed milliseconds, exactly as the other rigs do it.
   The server evaluates it at SPINUP_MS to draw the poster; the client evaluates
   it per frame; a reduced-motion reader gets the server's instant and nothing
   else. There is no second code path, which is the only way to be certain the
   still frame and the animation agree.
   ========================================================================== */

interface Pose {
  yaw: number;
  pitch: number;
  /** Shell scale. Exactly 1 at the terminal instant, in every state. */
  scale: number;
  /** Glow multiplier. Exactly 1 at the terminal instant, in every state. */
  glowMul: number;
}

function poseAt(elapsed: number, b: Behaviour): Pose {
  // The spin-up: a real servo move through SPIN_ARC, landing exactly on the
  // resting yaw at SPINUP_MS. `servoMs` saturates at 1, so nothing special has
  // to happen at the end of the move.
  const approach = servoMs(elapsed, SPINUP_MS);
  const after = Math.max(0, elapsed - SPINUP_MS);

  // The steady rate begins where the ramp ends. The two are not blended: a
  // blend would stretch the ramp beyond RAMP_MS, and the fixed ramp duration is
  // the single property that makes this read as machinery. At 0.16 rad/s the
  // velocity step at the handover is far below anything the eye resolves.
  let yaw =
    RESTING_YAW - SPIN_ARC * (1 - approach) + b.yawRate * after;
  let pitch = RESTING_PITCH;

  if (b.wander > 0) {
    yaw += b.wander * Math.sin((2 * Math.PI * after) / b.wanderPeriodMs);
  }
  if (b.nutation > 0) {
    pitch += b.nutation * Math.sin((2 * Math.PI * after) / b.nutationPeriodMs);
  }

  // Every oscillator is phased from SPINUP_MS and starts at sin(0) = 0, so the
  // terminal instant is scale 1 and glow 1 in every state. That is what lets
  // the poster be a single fixed drawing rather than a frame of an animation.
  const pulse =
    b.pulsePeriodMs > 1
      ? Math.sin((2 * Math.PI * after) / b.pulsePeriodMs)
      : 0;

  return {
    yaw,
    pitch,
    scale: 1 + b.pulseScale * pulse,
    glowMul: 1 + b.pulseGlow * pulse,
  };
}

/* ==========================================================================
   THE DRAW PLAN

   Everything about the verdict that affects WHAT is drawn, resolved once from
   the props. The frame loop reads it and never recomputes it.
   ========================================================================== */

interface DrawPlan {
  /** Vertices of the fully resolved generations. */
  shellSolidVertices: number;
  /** Vertices of the topmost, partial generation. Always dashed. */
  shellPartialVertices: number;
  /**
   * True when the whole shell is dashed: the confidence did not clear the pass
   * limit, or there is no confidence at all. Same rule, same meaning, as the
   * dashed panel on a held task.
   */
  shellDashed: boolean;
  coreVisible: boolean;
  /** Vertices of the passed arc of the verdict ring. */
  ringArcVertices: number;
  ringVisible: boolean;
}

function planFor(props: OracleProps): DrawPlan {
  const resolution = resolveShell(SHELL_MESH, props.confidence);
  const cleared =
    props.confidence !== null &&
    Number.isFinite(props.confidence) &&
    props.confidence >= props.threshold;

  const clauses = Math.max(0, Math.floor(props.clauseCount));
  const passed = Math.min(clauses, Math.max(0, Math.floor(props.passedCount)));
  // Round to whole ring segments so the arc lands on a segment boundary and the
  // join with the dashed remainder is clean.
  const arcSegments =
    clauses > 0 ? Math.round((passed / clauses) * RING_SEGMENTS) : 0;

  return {
    shellSolidVertices: resolution.complete * 2,
    shellPartialVertices: resolution.partial * 2,
    shellDashed: !cleared,
    coreVisible: BEHAVIOUR[props.state].core !== null,
    ringArcVertices: arcSegments * 2,
    ringVisible: clauses > 0,
  };
}

/* ==========================================================================
   COLOUR

   Read from the live cascade by token name and converted to 0..1 floats for
   the shaders. Anything unparseable returns null, and a null anywhere means the
   canvas is never shown - the poster stays up instead. Guessing a colour here
   would put an unreviewed ink on screen, which is the failure this project has
   already shipped twice.
   ========================================================================== */

function parseColour(value: string): Vec3 | null {
  const v = value.trim();

  if (v.startsWith("#")) {
    const hex = v.slice(1);
    if (hex.length === 3) {
      const r = Number.parseInt(hex[0] + hex[0], 16);
      const g = Number.parseInt(hex[1] + hex[1], 16);
      const b = Number.parseInt(hex[2] + hex[2], 16);
      return Number.isNaN(r + g + b) ? null : [r / 255, g / 255, b / 255];
    }
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      return Number.isNaN(r + g + b) ? null : [r / 255, g / 255, b / 255];
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
      return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
    }
  }
  return null;
}

type Palette = Record<string, Vec3>;

function readPalette(el: Element, surface: OracleSurface): Palette | null {
  let computed: CSSStyleDeclaration;
  try {
    computed = getComputedStyle(el);
  } catch {
    return null;
  }
  const palette: Palette = {};
  for (const token of INK_TOKENS) {
    // Read the SURFACE'S token, store it under the canonical key. That keeps
    // the remap in exactly one place; nothing downstream knows it happened.
    const ink = parseColour(computed.getPropertyValue(inkToken(token, surface)));
    if (!ink) return null;
    palette[token] = ink;
  }
  return palette;
}

/* ==========================================================================
   SHADERS

   Two programs. The line program draws every wireframe in the rig; the glow
   program paints the core's emission as a screen-space falloff.
   ========================================================================== */

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

const LINE_VERTEX = `
attribute vec3 aPosition;
attribute float aArc;

uniform mat4 uModelView;
uniform mat4 uProjection;
uniform float uScale;
uniform float uDashPitch;

varying float vDepth;
varying float vPhase;

void main() {
  vec4 view = uModelView * vec4(aPosition * uScale, 1.0);
  // View-space z, for the near/far ink step. Negative in front of the camera.
  vDepth = view.z;
  // World arc length over a pitch that is recomputed on resize, so a dash is a
  // constant number of screen pixels at every panel size.
  vPhase = aArc / uDashPitch;
  gl_Position = uProjection * view;
}
`;

const LINE_FRAGMENT = `${PRECISION}
uniform vec3 uNear;
uniform vec3 uFar;
uniform float uCameraDist;
uniform float uBodyRadius;
uniform float uDash;
uniform float uDashDuty;

varying float vDepth;
varying float vPhase;

void main() {
  if (uDash > 0.5 && fract(vPhase) > uDashDuty) discard;

  // Map view z across the body: 0 at the far pole, 1 at the near pole.
  float t = clamp(
    (vDepth + uCameraDist + uBodyRadius) / (2.0 * uBodyRadius),
    0.0,
    1.0
  );
  t = t * t * (3.0 - 2.0 * t);

  // A COLOUR step between two inks that each clear 3:1 on the volume ground -
  // never an alpha ramp. An alpha ramp would carry the far hemisphere below the
  // contrast floor while it is still the thing being read.
  gl_FragColor = vec4(mix(uFar, uNear, t), 1.0);
}
`;

const GLOW_VERTEX = `
attribute vec2 aCorner;
varying vec2 vCorner;
void main() {
  vCorner = aCorner;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

const GLOW_FRAGMENT = `${PRECISION}
uniform vec2 uExtent;
uniform vec3 uColour;
uniform float uRadius;
uniform float uIntensity;
varying vec2 vCorner;

void main() {
  // uExtent normalises clip space against the SHORTER side, so the falloff is
  // circular in pixels rather than stretched with the panel.
  float d = length(vCorner * uExtent) / uRadius;

  /* ALPHA 0, and it is not a typo.

     This pass is additive - blendFunc(ONE, ONE) - so both colour AND alpha
     accumulate. Emitting 1.0 here would drive alpha to 1 across the WHOLE
     quad, including the vast majority of it where the exponential falloff has
     taken colour to nearly zero. On the transparent plate buffer that
     composites as premultiplied (0,0,0,1): an opaque BLACK rectangle exactly
     the size of the glow quad. Measured in a browser, not reasoned about.

     Emitting 0 gives the compositor rgb with no coverage, and source-over
     (result = src + dst * (1 - src_a)) then reduces to result = src + dst,
     which is exactly the additive light this pass is for. Superluminous
     premultiplied values are well defined in every engine tested.

     It is also a no-op in a volume, where the buffer was already cleared to
     alpha 1 and adding 0 leaves it there. */
  gl_FragColor = vec4(uColour * exp(-d * d * 2.4) * uIntensity, 0.0);
}
`;

/* ==========================================================================
   GL RESOURCES
   ========================================================================== */

interface LineLocations {
  aPosition: number;
  aArc: number;
  uModelView: WebGLUniformLocation | null;
  uProjection: WebGLUniformLocation | null;
  uScale: WebGLUniformLocation | null;
  uDashPitch: WebGLUniformLocation | null;
  uNear: WebGLUniformLocation | null;
  uFar: WebGLUniformLocation | null;
  uCameraDist: WebGLUniformLocation | null;
  uBodyRadius: WebGLUniformLocation | null;
  uDash: WebGLUniformLocation | null;
  uDashDuty: WebGLUniformLocation | null;
}

interface GlowLocations {
  aCorner: number;
  uExtent: WebGLUniformLocation | null;
  uColour: WebGLUniformLocation | null;
  uRadius: WebGLUniformLocation | null;
  uIntensity: WebGLUniformLocation | null;
}

interface Resources {
  lineProgram: WebGLProgram;
  glowProgram: WebGLProgram;
  vertexBuffer: WebGLBuffer;
  quadBuffer: WebGLBuffer;
  line: LineLocations;
  glow: GlowLocations;
}

/** Warn once per page load. A failing shader should not flood the console. */
let hasWarned = false;

function warnOnce(message: string): void {
  if (hasWarned) return;
  hasWarned = true;
  console.warn(`[Oracle] ${message} Falling back to the static poster.`);
}

/**
 * Compile a shader AND CHECK IT.
 *
 * The reference this was rebuilt from never checks, which means a typo in a
 * shader there produces a silent black rectangle with nothing in the console.
 * A rig that cannot draw must say so and get out of the way.
 */
function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    warnOnce(`Shader failed to compile: ${gl.getShaderInfoLog(shader) ?? ""}.`);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // The shaders are no longer needed once the program is linked; detaching and
  // deleting them here is what stops them accumulating across context restores.
  gl.detachShader(program, vertex);
  gl.detachShader(program, fragment);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    warnOnce(`Program failed to link: ${gl.getProgramInfoLog(program) ?? ""}.`);
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function createResources(gl: WebGLRenderingContext): Resources | null {
  const lineProgram = link(gl, LINE_VERTEX, LINE_FRAGMENT);
  if (!lineProgram) return null;
  const glowProgram = link(gl, GLOW_VERTEX, GLOW_FRAGMENT);
  if (!glowProgram) {
    gl.deleteProgram(lineProgram);
    return null;
  }

  const vertexBuffer = gl.createBuffer();
  const quadBuffer = gl.createBuffer();
  if (!vertexBuffer || !quadBuffer) {
    gl.deleteProgram(lineProgram);
    gl.deleteProgram(glowProgram);
    if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
    if (quadBuffer) gl.deleteBuffer(quadBuffer);
    return null;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, VERTEX_DATA, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_DATA, gl.STATIC_DRAW);

  return {
    lineProgram,
    glowProgram,
    vertexBuffer,
    quadBuffer,
    line: {
      aPosition: gl.getAttribLocation(lineProgram, "aPosition"),
      aArc: gl.getAttribLocation(lineProgram, "aArc"),
      uModelView: gl.getUniformLocation(lineProgram, "uModelView"),
      uProjection: gl.getUniformLocation(lineProgram, "uProjection"),
      uScale: gl.getUniformLocation(lineProgram, "uScale"),
      uDashPitch: gl.getUniformLocation(lineProgram, "uDashPitch"),
      uNear: gl.getUniformLocation(lineProgram, "uNear"),
      uFar: gl.getUniformLocation(lineProgram, "uFar"),
      uCameraDist: gl.getUniformLocation(lineProgram, "uCameraDist"),
      uBodyRadius: gl.getUniformLocation(lineProgram, "uBodyRadius"),
      uDash: gl.getUniformLocation(lineProgram, "uDash"),
      uDashDuty: gl.getUniformLocation(lineProgram, "uDashDuty"),
    },
    glow: {
      aCorner: gl.getAttribLocation(glowProgram, "aCorner"),
      uExtent: gl.getUniformLocation(glowProgram, "uExtent"),
      uColour: gl.getUniformLocation(glowProgram, "uColour"),
      uRadius: gl.getUniformLocation(glowProgram, "uRadius"),
      uIntensity: gl.getUniformLocation(glowProgram, "uIntensity"),
    },
  };
}

function destroyResources(
  gl: WebGLRenderingContext,
  resources: Resources
): void {
  gl.deleteBuffer(resources.vertexBuffer);
  gl.deleteBuffer(resources.quadBuffer);
  gl.deleteProgram(resources.lineProgram);
  gl.deleteProgram(resources.glowProgram);
}

/* ==========================================================================
   THE POSTER

   A canvas cannot server-render, so the markup carries a static SVG of the same
   object: the same mesh, the same resting pose, the same projection, the same
   state ink, at the same terminal instant the canvas starts from. It is what a
   reader sees with JS blocked, before hydration, when WebGL is unavailable, and
   after a context loss that could not be recovered.

   It is coarser - POSTER_SUBDIVISIONS, not SHELL_SUBDIVISIONS - because 480 SVG
   lines is not a reasonable thing to put in a document that also has to carry a
   verdict. It is the same object drawn at survey detail, not a different one.
   ========================================================================== */

const POSTER_SIZE = 480;
const POSTER_CENTRE = POSTER_SIZE / 2;

/** CSS-pixel scale of the poster projection, at the object's depth. */
const POSTER_PX_PER_WORLD =
  (POSTER_SIZE * verticalScale(FOV_Y, 1)) / (2 * CAMERA_DIST);

interface PosterLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** True when the segment's midpoint is in the hemisphere facing the reader. */
  near: boolean;
}

interface Poster {
  /** Fully resolved generations. */
  solid: readonly PosterLine[];
  /** The topmost, partial generation. Always drawn dashed. */
  partial: readonly PosterLine[];
}

/**
 * Project the poster mesh at the resting pose.
 *
 * Deliberately the SAME `rotation3` the GPU path folds into its model-view
 * matrix. One rotation function, two consumers - the still drawing and the
 * animation cannot describe different objects.
 */
function buildPoster(confidence: number | null): Poster {
  const m = rotation3(RESTING_PITCH, RESTING_YAW);
  const f = verticalScale(FOV_Y, 1);

  const project = (
    v: Vec3
  ): { x: number; y: number; z: number } => {
    const vx = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
    const vy = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
    const vz = m[6] * v[0] + m[7] * v[1] + m[8] * v[2] - CAMERA_DIST;
    const w = -vz;
    return {
      x: ((f * vx) / w) * POSTER_CENTRE + POSTER_CENTRE,
      y: POSTER_CENTRE - ((f * vy) / w) * POSTER_CENTRE,
      z: vz,
    };
  };

  const resolution = resolveShell(POSTER_MESH, confidence);
  const solid: PosterLine[] = [];
  const partial: PosterLine[] = [];

  for (let i = 0; i < resolution.total; i++) {
    const edge = POSTER_MESH.edges[i];
    const a = project(POSTER_MESH.vertices[edge.a]);
    const b = project(POSTER_MESH.vertices[edge.b]);
    (i < resolution.complete ? solid : partial).push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      // The shader mixes the two inks continuously; SVG cannot, so the poster
      // picks whichever ink the segment's midpoint is nearer to. An
      // approximation of the same rule, in a drawing that never moves.
      near: (a.z + b.z) / 2 > -CAMERA_DIST,
    });
  }

  return { solid, partial };
}

const fmt = (n: number): string => n.toFixed(1);

/* ==========================================================================
   THE ACCESSIBLE NAME

   It states the TERMINAL reading - the object in the HTML and the object a
   reduced-motion reader keeps - in words. Nothing about a verdict is knowable
   only through motion, and a null confidence is never printed as a number.
   ========================================================================== */

function describe(props: OracleProps): string {
  const { confidence, threshold, clauseCount, passedCount, state } = props;
  const clauses = Math.max(0, Math.floor(clauseCount));
  const passed = Math.min(clauses, Math.max(0, Math.floor(passedCount)));

  const shell =
    state === "SETTLED"
      ? "A resolved wireframe shell, turning steadily, with a lit core."
      : state === "REFUNDED"
        ? "A wireframe shell held still, intact, with an arrested core."
        : state === "HELD"
          ? "A wireframe shell drifting unresolved, with a core in the held state."
          : "A dim, unlit wireframe shell at its coarsest resolution, core off.";

  const ruling =
    state === "OPEN" || state === "SUBMITTED"
      ? `${clauses} sealed ${clauses === 1 ? "clause" : "clauses"}, none ruled on yet.`
      : `${passed} of ${clauses} sealed ${clauses === 1 ? "clause" : "clauses"} passed.`;

  const solve =
    confidence === null || !Number.isFinite(confidence)
      ? "No confidence figure was reported, so the shell is drawn at its coarsest resolution."
      : `Judge confidence ${Math.round(confidence)} against a pass limit of ` +
        `${Math.round(threshold)}; the shell's resolution is that confidence.`;

  const outcome =
    state === "SETTLED"
      ? "The escrow was released to the worker."
      : state === "REFUNDED"
        ? "The escrow was refunded to the poster."
        : state === "HELD"
          ? "The escrow is untouched, awaiting manual review."
          : "The escrow is untouched.";

  return `Verdict rig. ${shell} ${ruling} ${solve} ${outcome}`;
}

/* ==========================================================================
   STYLE

   Kept in the component rather than in globals.css so the rig is one
   self-contained file, exactly as the skeleton is. Every colour is a token by
   name, routed through four local custom properties that the component sets
   from the SAME behaviour table the canvas reads - so the poster and the canvas
   cannot describe different states.
   ========================================================================== */

const ORACLE_CSS = `
.cv-oracle { display: block; margin: 0; width: 100%; }
.cv-oracle .cvo-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 420px;
  background: var(--d-ground);
  border: 1px solid var(--border);
  overflow: hidden;
}
/* On the plate there is no panel at all: no ground, no border, no clip - the
   object is drawn straight onto the page, and the canvas over it now clears
   TRANSPARENT rather than to --page, so this rule finally means what it says.

   What is behind it therefore depends on the screen. On the landing that is the
   full-bleed field, which the object is drawn over. On an app screen AppShell
   paints an opaque --page over the fixed field, so it is flat there.

   The contrast figures hold on both. The field only ADDS to the ground, and
   adding light under dark ink raises contrast; its one darkening term, the scan
   line, subtracts 0.006 sRGB, which takes --page from luminance 0.7085 to
   0.6974 and leaves the tightest ink - --hairline - at 3.10:1 against a 3:1
   floor. */
.cv-oracle--plate .cvo-stage {
  background: transparent;
  border: 0;
  overflow: visible;
  max-height: none;
}
.cv-oracle .cvo-poster,
.cv-oracle .cvo-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}
.cv-oracle .cvo-canvas { z-index: 1; }
.cv-oracle .cvo-near { stroke: var(--cvo-near); stroke-width: 1; fill: none; }
.cv-oracle .cvo-far { stroke: var(--cvo-far); stroke-width: 1; fill: none; }
.cv-oracle .cvo-dashed { stroke-dasharray: 3 2; }
.cv-oracle .cvo-core {
  fill: none;
  stroke: var(--cvo-core);
  stroke-width: 1;
}
.cv-oracle .cvo-core-dot { fill: var(--cvo-core); stroke: none; }
.cv-oracle .cvo-ring-track {
  fill: none;
  stroke: var(--cvo-track);
  stroke-width: 1;
}
.cv-oracle .cvo-ring-arc {
  fill: none;
  stroke: var(--cvo-arc);
  stroke-width: 1;
}
`;

/* ==========================================================================
   THE COMPONENT
   ========================================================================== */

/** Panel measurements that only change when the panel does. */
interface ViewMetrics {
  cssWidth: number;
  cssHeight: number;
  /** CSS pixels per world unit at the object's depth. */
  pxPerWorld: number;
  /** Dash pitch in world units, giving DASH_PITCH_PX on screen. */
  dashPitch: number;
  /** Glow falloff radius, in units of half the shorter side. */
  glowRadius: number;
  extentX: number;
  extentY: number;
}

/**
 * Cancels a context loss so it can be restored later.
 *
 * A `webglcontextlost` event is only REVERSIBLE if it was cancelled. Teardown
 * deliberately loses the context to free it, so without this the loss is final
 * and the canvas can never render again. It is defined at module scope on
 * purpose: it is attached immediately before the loss is triggered and must
 * still be attached when the event is dispatched, which is after the effect
 * has finished cleaning up. A stable function reference also lets the DOM
 * de-duplicate the listener.
 */
function cancelLoss(event: Event): void {
  event.preventDefault();
}

export function Oracle(props: OracleProps) {
  // Defaults to the surface that actually ships. It used to default to
  // "volume", which meant a new mount that simply forgot the prop got a black
  // panel - the dead branch reachable by omission, which is the worst kind of
  // default. Both live mounts pass "plate" explicitly, so this changes nothing
  // that renders today.
  const surface: OracleSurface = props.surface ?? "plate";
  // False by default: a flat backdrop is the ceiling under which the brighter
  // scale is safe, so a mount that forgets this prop under the field loses
  // brightness rather than correctness.
  const fieldBacked = props.fieldBacked ?? false;
  const { confidence, threshold, clauseCount, passedCount, state, className } =
    props;

  const behaviour = BEHAVIOUR[state];
  const plan = useMemo(
    () => planFor({ confidence, threshold, clauseCount, passedCount, state }),
    [confidence, threshold, clauseCount, passedCount, state]
  );

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * The animation clock, held outside the effect so a prop change does not
   * restart the take. It starts at SPINUP_MS to match the poster the server
   * drew; the rewind after mount drops it to zero.
   */
  const elapsedRef = useRef<number>(SPINUP_MS);
  const rewoundRef = useRef<boolean>(false);

  /**
   * Extra yaw accumulated from pointer speed, in radians.
   *
   * Accumulated rather than applied as a rate change, and the difference
   * matters: the pose is a pure function of elapsed time, so raising `yawRate`
   * would retroactively rewrite the whole rotation history and jump the shell
   * to a new angle the instant the cursor moved. Integrating an extra rate into
   * an offset is continuous by construction.
   *
   * In a ref so a StrictMode remount resumes the rotation instead of snapping
   * it back to zero.
   */
  const spinRef = useRef<number>(0);

  /**
   * The WEBGL_lose_context handle, kept across mounts because it CANNOT be
   * re-fetched once the context is lost: getExtension returns null on a lost
   * context. Teardown deliberately loses the context, so under React StrictMode
   * - which mounts, unmounts and remounts in development - the second mount got
   * the same dead context back from the same canvas element, every compile
   * failed with an EMPTY info log, and the rig fell back to its poster for the
   * rest of the session. The empty log is the signature of that bug rather than
   * of a broken shader.
   */
  const loseExtRef = useRef<WEBGL_lose_context | null>(null);

  /**
   * Bumped when a dead context has actually been restored, to re-run the effect
   * and build on the live one. A restore cannot be handled inside the run that
   * found the context dead: that run has to return before the browser will
   * dispatch the event, so the work has to happen in a LATER run, and a state
   * bump is what schedules one.
   */
  const [contextEpoch, setContextEpoch] = useState(0);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    // Hand the poster back BEFORE anything can fail. Five early returns sit
    // between here and the definition of showCanvas - no WebGL, a lost context,
    // an unreadable cascade, a failed shader build - and a re-run that takes one
    // of them after a previous run had hidden the poster would otherwise leave
    // nothing on screen at all. The visible poster is the correct resting state
    // for this effect; only a canvas that has actually drawn may take it away.
    {
      const parked = stage.querySelector<SVGElement>(".cvo-poster");
      if (parked) parked.style.visibility = "";
    }

    const options: WebGLContextAttributes = {
      // Opaque inside a volume, where the canvas paints the ground itself and
      // every contrast figure is therefore exact. Transparent on the plate, and
      // the clear now honours it - for a while this asked for a transparent
      // buffer and then filled it anyway, which is why the landing field was
      // being covered by a --page-coloured rectangle across the whole hero.
      alpha: surface === "plate",
      antialias: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    };

    const gl =
      (canvas.getContext("webgl", options) as WebGLRenderingContext | null) ??
      (canvas.getContext(
        "experimental-webgl",
        options
      ) as WebGLRenderingContext | null);

    if (!gl) {
      warnOnce("WebGL is unavailable.");
      return;
    }

    // On a healthy context this is the live handle; on a context this
    // component lost during a previous teardown, getExtension returns null and
    // the handle kept from that earlier mount is the only thing that can ask
    // for it back.
    const loseExt =
      gl.getExtension("WEBGL_lose_context") ?? loseExtRef.current;
    loseExtRef.current = loseExt;

    if (gl.isContextLost()) {
      // The canvas is empty and cannot be drawn to, so it must not be on
      // screen: the poster underneath is a correct picture of the same object,
      // and showing an undrawn canvas over it paints a black rectangle.
      canvas.style.display = "none";

      // Re-run this effect once the context is genuinely back. Registering the
      // listener BEFORE asking for the restore is what makes the sequence safe;
      // the effect that found the context dead can do nothing else useful.
      const onBack = (): void => setContextEpoch((n) => n + 1);
      canvas.addEventListener("webglcontextrestored", onBack, { once: true });

      // Deferred by one task because React tears down and remounts inside a
      // single task: the loss event from the previous teardown is queued but
      // not yet dispatched, and asking to restore before it lands is refused.
      const retry = window.setTimeout(() => loseExt?.restoreContext(), 0);

      return () => {
        window.clearTimeout(retry);
        canvas.removeEventListener("webglcontextrestored", onBack);
      };
    }

    const palette = readPalette(canvas, surface);
    if (!palette) {
      warnOnce("The design tokens could not be read from the cascade.");
      return;
    }

    let resources = createResources(gl);
    if (!resources) return;

    /* THE POSTER, and why it now has to be hidden explicitly.

       The canvas used to hide it by being opaque. On the plate it no longer is,
       so without this the server-rendered poster would show THROUGH the live
       render - a second, static, 120-edge wireframe frozen at the terminal pose
       sitting behind the moving 480-edge one.

       Tied to the two helpers that already gate the canvas, so the two cannot
       drift apart: every failure path routes through hideCanvas, and each one
       hands the poster back on the way. visibility rather than display, because
       it is the cheaper of the two for the compositor to toggle and this runs
       next to a rAF loop.

       The poster is never conditionally RENDERED - it is always in the server
       HTML, which is what makes no-JS, no-WebGL, an unreadable cascade, a failed
       shader and a lost context all fall back to a real drawing. A
       reduced-motion reader does not get the poster: that path draws one canvas
       frame at the resting pose and returns before scheduling anything, which is
       the same render function at its terminal state rather than a second
       drawing that could disagree with it. */
    const poster = stage.querySelector<SVGElement>(".cvo-poster");

    const showCanvas = (): void => {
      canvas.style.display = "";
      if (poster) poster.style.visibility = "hidden";
    };
    const hideCanvas = (): void => {
      canvas.style.display = "none";
      if (poster) poster.style.visibility = "";
    };

    const projection = new Float32Array(16);
    const bodyMatrix = new Float32Array(16);
    // The core carries its own matrix so it can lag the shell. Allocated once
    // here, like the others - a per-frame allocation in a rAF loop is garbage
    // the collector has to chase sixty times a second.
    const coreMatrix = new Float32Array(16);
    const flatMatrix = new Float32Array(16);

    const metrics: ViewMetrics = {
      cssWidth: 1,
      cssHeight: 1,
      pxPerWorld: 1,
      dashPitch: 0.05,
      glowRadius: 0.5,
      extentX: 1,
      extentY: 1,
    };

    /**
     * Re-measure the panel and re-derive everything that depends on its size.
     *
     * devicePixelRatio is capped at 2. Uncapped, a 3x phone renders nine times
     * the pixels of a 1x screen for a difference nobody can see, and on a large
     * panel that is the whole frame budget spent on nothing.
     */
    const measure = (): boolean => {
      const rect = stage.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
      const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

      const aspect = rect.width / rect.height;
      perspective(projection, FOV_Y, aspect, NEAR_PLANE, FAR_PLANE);

      // Half the viewport in world units at the object's depth is
      // CAMERA_DIST / fy, so pixels per world unit is height / (2 * that).
      const fy = verticalScale(FOV_Y, aspect);
      const pxPerWorld = (rect.height * fy) / (2 * CAMERA_DIST);
      const shorter = Math.min(rect.width, rect.height);

      metrics.cssWidth = rect.width;
      metrics.cssHeight = rect.height;
      metrics.pxPerWorld = pxPerWorld;
      metrics.dashPitch = DASH_PITCH_PX / Math.max(1e-6, pxPerWorld);
      // The glow reaches a little past the core so the core reads as lit rather
      // than as outlined. It is the one soft edge in a system of 1px rules,
      // and it is light from an emissive source, not a drop shadow under a card.
      metrics.glowRadius =
        (CORE_RADIUS * 1.6 * pxPerWorld) / Math.max(1, shorter / 2);
      metrics.extentX = rect.width / Math.max(1, shorter);
      metrics.extentY = rect.height / Math.max(1, shorter);

      gl.viewport(0, 0, pixelWidth, pixelHeight);
      return true;
    };

    /**
     * One frame. Uniform writes only - never a React render.
     *
     * The pointer offset is applied to the POSE, not to the object's position.
     * The reference translated the mesh across the screen, which inside a
     * bounded viewport walks it into the frame edge; rotating it keeps the
     * object centred and reads as it turning to face the reader. It is also
     * strictly additive on top of `poseAt`, so the pure, testable pose is
     * still the thing the poster and the reduced-motion frame are drawn from.
     */
    const draw = (
      ms: number,
      yawOffset = 0,
      pitchOffset = 0,
      spin = 0,
      idle = 0
    ): void => {
      if (!resources) return;
      const base = poseAt(ms, behaviour);
      const pose: Pose = {
        yaw: base.yaw + yawOffset,
        pitch: base.pitch + pitchOffset,
        scale: base.scale,
        glowMul: base.glowMul,
      };
      /* THE CLEAR, and the one place the two surfaces genuinely differ.

         In a volume the canvas paints its own ground, so it clears OPAQUE and
         every contrast figure is exact against a colour this code chose.

         On the plate it clears to nothing at all. The context has always asked
         for a transparent buffer and never got one: this call used to pass
         alpha 1 unconditionally, which filled the buffer with --page and made
         the canvas an opaque rectangle. On /task/[id] that was invisible - the
         rectangle was the same colour as the plate behind it - but on the
         landing it covered the full-bleed field across the whole hero, and the
         field's motion died inside it. */
      const ground = palette["--d-ground"];

      if (surface === "plate") {
        gl.clearColor(0, 0, 0, 0);
      } else {
        gl.clearColor(ground[0], ground[1], ground[2], 1);
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
      // No depth buffer: the whole wireframe is visible, and the near/far ink
      // step is what carries which half of it is facing the reader.
      gl.disable(gl.DEPTH_TEST);
      // 1.0 is the only line width WebGL is required to support, and it is also
      // the only one this design system wants: every boundary is a 1px rule.
      gl.lineWidth(1);

      // ---- the core's emission, first, so the wireframe sits on top of it ----
      const coreToken = behaviour.core;

      /* THE RESTING PULSE.

         `pulse` is the same oscillator `poseAt` already uses for the shell's
         breathing, recovered here rather than re-derived so the two cannot
         drift apart. `idle` is 0 while the cursor is moving and 1 once it has
         settled, so this term simply is not there until the rig comes to rest.

         Phase matters: sin() is zero at the terminal instant, so the pulse
         contributes exactly nothing to the pose the SSR poster and the
         reduced-motion frame are drawn from. It can only ever be an addition
         made by a running clock. */
      const pulse =
        behaviour.pulsePeriodMs > 1
          ? Math.sin(
              (2 * Math.PI * Math.max(0, ms - SPINUP_MS)) /
                behaviour.pulsePeriodMs
            )
          : 0;
      const idlePulse = idle * pulse;

      // Scaled on the plate only - the dark volume has headroom to spare and is
      // left alone - and scaled further again when the field is behind the
      // canvas adding light under the glow. See GLOW_FIELD_SCALE.
      const glowScale =
        surface !== "plate"
          ? 1
          : fieldBacked
            ? GLOW_FIELD_SCALE
            : GLOW_PLATE_SCALE;
      const intensity =
        behaviour.glow *
        glowScale *
        pose.glowMul *
        (1 + IDLE_PULSE_DEPTH * idlePulse);
      if (coreToken && intensity > 0.001) {
        const ink = palette[coreToken];
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(resources.glowProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, resources.quadBuffer);
        gl.enableVertexAttribArray(resources.glow.aCorner);
        gl.vertexAttribPointer(resources.glow.aCorner, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(resources.glow.uExtent, metrics.extentX, metrics.extentY);
        gl.uniform3f(resources.glow.uColour, ink[0], ink[1], ink[2]);
        // Size on the same beat as the brightness, so it breathes instead of
        // blinking. Clamped positive: a negative radius is a divide-by-zero in
        // the falloff and paints the whole quad.
        gl.uniform1f(
          resources.glow.uRadius,
          Math.max(0.01, metrics.glowRadius * (1 + IDLE_PULSE_RADIUS * idlePulse))
        );
        gl.uniform1f(resources.glow.uIntensity, intensity);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(resources.glow.aCorner);
        gl.disable(gl.BLEND);
      }

      // ---- every wireframe in the rig, through one program ----
      // The spin is added to the SHELL only. The core keeps the base pose and
      // its counter-lean, so a fast sweep drags the cage around something that
      // stays put - which is the reading the whole two-matrix split exists for.
      const rot = rotation3(pose.pitch, pose.yaw + spin);
      modelView(bodyMatrix, rot, CAMERA_DIST);

      // The core takes the base pose plus a small NEGATIVE fraction of the
      // pointer lean, so it turns against the shell rather than with it.
      const coreRot = rotation3(
        base.pitch + pitchOffset * CORE_PARALLAX_RATIO,
        base.yaw + yawOffset * CORE_PARALLAX_RATIO
      );
      modelView(coreMatrix, coreRot, CAMERA_DIST);
      modelView(flatMatrix, null, CAMERA_DIST);

      const L = resources.line;
      gl.useProgram(resources.lineProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.vertexBuffer);
      const stride = VERTEX_FLOATS * 4;
      gl.enableVertexAttribArray(L.aPosition);
      gl.vertexAttribPointer(L.aPosition, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(L.aArc);
      gl.vertexAttribPointer(L.aArc, 1, gl.FLOAT, false, stride, 12);

      gl.uniformMatrix4fv(L.uProjection, false, projection);
      gl.uniform1f(L.uCameraDist, CAMERA_DIST);
      gl.uniform1f(L.uDashPitch, metrics.dashPitch);
      gl.uniform1f(L.uDashDuty, DASH_DUTY);

      const setInk = (near: Vec3, far: Vec3): void => {
        gl.uniform3f(L.uNear, near[0], near[1], near[2]);
        gl.uniform3f(L.uFar, far[0], far[1], far[2]);
      };

      // THE SHELL. The resolved generations, then the partial one on top.
      gl.uniformMatrix4fv(L.uModelView, false, bodyMatrix);
      gl.uniform1f(L.uScale, pose.scale);
      gl.uniform1f(L.uBodyRadius, SHELL_RADIUS);
      setInk(palette[behaviour.shellNear], palette[behaviour.shellFar]);
      if (plan.shellSolidVertices > 0) {
        gl.uniform1f(L.uDash, plan.shellDashed ? 1 : 0);
        gl.drawArrays(gl.LINES, SHELL_FIRST, plan.shellSolidVertices);
      }
      if (plan.shellPartialVertices > 0) {
        // Always dashed: this generation is genuinely incomplete, and dashed
        // means inferred everywhere else in the product too.
        gl.uniform1f(L.uDash, 1);
        gl.drawArrays(
          gl.LINES,
          SHELL_FIRST + plan.shellSolidVertices,
          plan.shellPartialVertices
        );
      }

      // THE CORE. Solid: it is the ruling itself, and the ruling is a fact.
      if (plan.coreVisible && coreToken) {
        // Counter-rotating matrix: this is what separates the core from the
        // shell, and the opposition is what reads as one being inside the other.
        gl.uniformMatrix4fv(L.uModelView, false, coreMatrix);
        const ink = palette[coreToken];
        gl.uniform1f(L.uBodyRadius, CORE_RADIUS);
        setInk(ink, ink);
        gl.uniform1f(L.uDash, 0);
        gl.drawArrays(gl.LINES, CORE_FIRST, CORE_BATCH.vertexCount);
      }

      // THE VERDICT RING. Translation only, so it stays a true circle facing
      // the reader: the count of passed clauses is not a thing that rotates.
      if (plan.ringVisible) {
        const track = palette["--rig-solved"];
        gl.uniformMatrix4fv(L.uModelView, false, flatMatrix);
        gl.uniform1f(L.uScale, 1);
        gl.uniform1f(L.uBodyRadius, 1);
        setInk(track, track);
        gl.uniform1f(L.uDash, 1);
        gl.drawArrays(gl.LINES, RING_FIRST, RING_BATCH.vertexCount);

        if (plan.ringArcVertices > 0) {
          const arc = palette[behaviour.ringArc];
          setInk(arc, arc);
          gl.uniform1f(L.uDash, 0);
          gl.drawArrays(gl.LINES, RING_FIRST, plan.ringArcVertices);
        }
      }

      gl.disableVertexAttribArray(L.aPosition);
      gl.disableVertexAttribArray(L.aArc);
    };

    if (!measure()) {
      // A zero-sized panel. Give the context straight back rather than holding
      // one of the browser's ~16 for a canvas that can never draw.
      destroyResources(gl, resources);
      resources = null;
      // The canceller must be attached BEFORE the loss is triggered, or the
      // loss is final and this canvas can never render again.
      canvas.addEventListener("webglcontextlost", cancelLoss);
      loseExt?.loseContext();
      return;
    }
    draw(elapsedRef.current);
    showCanvas();

    const resize = new ResizeObserver(() => {
      if (!resources) return;
      if (!measure()) return;
      draw(elapsedRef.current);
    });
    resize.observe(stage);

    /* ------------------------------------------------------------------
       CONTEXT LOSS

       A laptop waking from sleep, a GPU driver reset, or a browser reclaiming
       contexts from a background tab all take the context away. Without
       preventDefault the browser will not restore it, and the result is a
       permanently blank rectangle where the verdict used to be.
       ------------------------------------------------------------------ */
    /** False until the reduced-motion guard has been passed. See `sync`. */
    let loopEnabled = false;

    const onContextLost = (event: Event): void => {
      event.preventDefault();
      stop();
      if (resources) {
        // The resources are already gone with the context; drop the handles so
        // nothing tries to draw with them.
        resources = null;
      }
      hideCanvas();
    };

    const onContextRestored = (): void => {
      resources = createResources(gl);
      if (!resources) {
        hideCanvas();
        return;
      }
      if (!measure()) {
        destroyResources(gl, resources);
        resources = null;
        hideCanvas();
        return;
      }
      draw(elapsedRef.current);
      showCanvas();
      sync();
    };

    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    /* ------------------------------------------------------------------
       THE REDUCED-MOTION AND NO-MOTION GUARD

       Checked here, BEFORE anything is scheduled, so no requestAnimationFrame
       work is ever queued for a reader who asked for none - not queued and
       cancelled, never queued.

       OPEN and SUBMITTED take the same exit. Nothing has been judged, so there
       is no measurement to animate, and one frame at the resting pose is the
       whole truthful drawing.
       ------------------------------------------------------------------ */
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || !behaviour.animates) {
      return () => {
        canvas.removeEventListener("webglcontextlost", onContextLost);
        canvas.removeEventListener("webglcontextrestored", onContextRestored);
        resize.disconnect();
        if (resources) destroyResources(gl, resources);
        // The canceller must be attached BEFORE the loss is triggered, or the
      // loss is final and this canvas can never render again.
      canvas.addEventListener("webglcontextlost", cancelLoss);
      loseExt?.loseContext();
      };
    }

    // Past the guard, so a frame loop is legitimate from here on. `sync` checks
    // this because a context RESTORE arrives through the same path, and a
    // reader who asked for no motion must not be handed an animation by a GPU
    // driver reset an hour later.
    loopEnabled = true;

    let raf = 0;
    let last = 0;
    let running = false;
    let inView = true;

    /* ------------------------------------------------------------------
       POINTER PARALLAX

       Measured against the VIEWPORT, and listened for on the window.

       This was bound to the object's own element and normalised against it,
       which was right while the rig lived inside a bounded dark panel: there,
       window coordinates make the object lean hardest when the pointer is
       nowhere near it. The object is on the open plate now, so that reasoning
       inverts - a listener on the element only responds once the cursor is
       already on top of the sphere, which is the one moment the effect is
       least useful.

       The shell takes the full lean and the core takes 0.3 of it, so the two
       separate as the pointer travels. The offsets are applied to the POSE, not
       to position: the reference translated its mesh across the screen, which
       walks the object off centre; rotating keeps it in place and reads as the
       thing turning to face you. Both are strictly additive on top of `poseAt`,
       so the pure, testable pose is still what the poster and the
       reduced-motion frame are drawn from.
       ------------------------------------------------------------------ */
    let targetYaw = 0;
    let targetPitch = 0;
    let trackedYaw = 0;
    let trackedPitch = 0;

    /* Pointer SPEED, as distinct from pointer position.
       Position decides which way the object leans; speed decides how fast the
       shell turns while you are moving. */
    let pointerSpeed = 0;
    let lastX = 0;
    let lastY = 0;
    let lastMoveAt = 0;

    /** 0 while the cursor is moving, 1 once it has been still for a moment. */
    let idleGain = 0;

    const onPointerMove = (event: PointerEvent): void => {
      // Coarse pointers do not hover, so a touch would snap the object rather
      // than ease it. Fine pointers only - and on a touch device this listener
      // therefore costs one early return per event and nothing else.
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w < 1 || h < 1) return;
      // -1 at the left/top edge of the window, +1 at the right/bottom.
      const nx = (event.clientX / w) * 2 - 1;
      const ny = (event.clientY / h) * 2 - 1;
      targetYaw = Math.max(-1, Math.min(1, nx)) * PARALLAX;
      targetPitch = Math.max(-1, Math.min(1, ny)) * PARALLAX;

      // ---- speed ----
      const at = event.timeStamp;
      if (lastMoveAt > 0) {
        // Guard the divisor: two events can share a timestamp, and coalesced
        // moves can arrive with a zero delta. Infinity here would become a NaN
        // matrix and take the whole object off screen.
        const gap = at - lastMoveAt;
        if (gap > 0.5) {
          const dx = event.clientX - lastX;
          const dy = event.clientY - lastY;
          const speed = Math.hypot(dx, dy) / gap;
          // Take the peak rather than the latest sample. Pointer streams are
          // spiky, and a single slow frame in the middle of a fast sweep would
          // otherwise drop the boost out from under the motion.
          pointerSpeed = Math.max(pointerSpeed, speed);
        }
      }
      lastMoveAt = at;
      lastX = event.clientX;
      lastY = event.clientY;
    };

    // The pointer left the document entirely - out of the window, or into the
    // browser chrome. Returning to centre is the honest resting state; holding
    // the last lean would leave the object pointing at something that is no
    // longer there.
    const onPointerOut = (event: PointerEvent): void => {
      if (event.relatedTarget === null) {
        targetYaw = 0;
        targetPitch = 0;
      }
    };

    if (behaviour.tracksPointer) {
      // On the window, not the element: the whole point is that the object
      // responds while the cursor is somewhere else on the page.
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("pointerout", onPointerOut);
    }

    const tick = (now: number): void => {
      // Clamp the step. A backgrounded tab or a long main-thread stall would
      // otherwise hand us several seconds and jump the rig through a whole
      // phase in one frame.
      const dt = Math.min(100, Math.max(0, now - last));
      last = now;
      elapsedRef.current += dt;

      // Frame-rate independent smoothing toward the pointer target.
      const k = 1 - Math.exp(-dt / TRACK_TAU_MS);
      trackedYaw += (targetYaw - trackedYaw) * k;
      trackedPitch += (targetPitch - trackedPitch) * k;

      /* SPEED -> EXTRA ROTATION.

         The measured speed decays toward zero every frame, so a pointer that
         has stopped produces no boost within about half a second even though
         no event fires to say it stopped. What is left is integrated into the
         accumulated spin, which is why the shell speeds up and slows down
         smoothly instead of stepping between two rates. */
      if (behaviour.tracksPointer) {
        pointerSpeed *= Math.exp(-dt / SPIN_DECAY_TAU_MS);
        const boost =
          SPIN_BOOST_MAX * Math.min(1, pointerSpeed / SPIN_SPEED_REF);
        spinRef.current += boost * dt;

        // Idle is derived from the same decaying speed, so "stopped" means the
        // movement has actually died away rather than that no event arrived in
        // the last frame.
        const idleTarget = pointerSpeed < IDLE_SPEED_THRESHOLD ? 1 : 0;
        idleGain += (idleTarget - idleGain) * (1 - Math.exp(-dt / IDLE_TAU_MS));
      }

      draw(
        elapsedRef.current,
        trackedYaw,
        trackedPitch,
        spinRef.current,
        idleGain
      );

      // A state that reaches a genuinely frozen pose stops asking for frames.
      // REFUNDED is arrested: once the spin-up move has landed and the pointer
      // offset has decayed, nothing changes, and sixty frames a second of
      // identical pixels is battery spent on nothing.
      if (
        behaviour.freezes &&
        elapsedRef.current > SPINUP_MS &&
        Math.abs(trackedYaw - targetYaw) < 1e-4 &&
        Math.abs(trackedPitch - targetPitch) < 1e-4 &&
        // Never park mid spin-down: the pose would freeze at whatever rate the
        // boost happened to be at, which is the one visibly wrong way to stop.
        pointerSpeed < 1e-3
      ) {
        stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (running || !resources) return;
      running = true;
      // Resume from NOW, so a paused interval is not credited to the clock and
      // the rig picks up at the beat it stopped on rather than restarting.
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    function stop(): void {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    }

    function sync(): void {
      if (loopEnabled && inView && !document.hidden && resources) start();
      else stop();
    }

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

    // THE REWIND. The resting pose is already on screen; this drops the clock
    // back to zero one tick after mount and lets the spin-up play forward. The
    // object is never assembled out of nothing - it is a complete drawing,
    // rewound.
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
      // Detached from the same targets they were attached to. A window
      // listener left behind by an unmounted component keeps the whole effect
      // closure alive - canvas, GL context and all - for the life of the page.
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (resources) destroyResources(gl, resources);
      // A browser keeps roughly sixteen live WebGL contexts. Leaking one on
      // every route change eventually kills every canvas on the page, including
      // ones this component never touched.
      // The canceller must be attached BEFORE the loss is triggered, or the
      // loss is final and this canvas can never render again.
      canvas.addEventListener("webglcontextlost", cancelLoss);
      loseExt?.loseContext();
    };
  }, [behaviour, plan, contextEpoch, surface, fieldBacked]);

  /* ----------------------------------------------------------------------
     THE SERVER-RENDERED DRAWING
     ---------------------------------------------------------------------- */

  const poster = useMemo(() => buildPoster(confidence), [confidence]);

  const label = useMemo(
    () =>
      describe({ confidence, threshold, clauseCount, passedCount, state }),
    [confidence, threshold, clauseCount, passedCount, state]
  );

  /**
   * The four inks the poster paints with, taken from the SAME behaviour table
   * the canvas reads. One source of truth: if a state's ink changes, both
   * drawings change together, and neither can quietly disagree with the other.
   */
  // The poster resolves the same remap through var(), so the static frame and
  // the canvas cannot disagree about what colour the object is.
  const inkVars = {
    "--cvo-near": `var(${inkToken(behaviour.shellNear, surface)})`,
    "--cvo-far": `var(${inkToken(behaviour.shellFar, surface)})`,
    "--cvo-core": behaviour.core
      ? `var(${inkToken(behaviour.core, surface)})`
      : "transparent",
    "--cvo-arc": `var(${inkToken(behaviour.ringArc, surface)})`,
    // The ring TRACK, which used to be the one ink that escaped this object.
    // It was written straight into the stylesheet as var(--rig-solved), so on
    // the plate the poster stroked the raw volume ink while the canvas stroked
    // the remapped one - the poster and the canvas disagreeing about a colour,
    // which is exactly what the comment above promises cannot happen. Both
    // values clear 3:1 (#6c7772 is 3.36 on --page, --hairline 3.14), so this
    // was never a contrast bug; it was a hydration flash and an untested ink.
    "--cvo-track": `var(${inkToken("--rig-solved", surface)})`,
  } as CSSProperties;

  const coreRadius = CORE_RADIUS * POSTER_PX_PER_WORLD;
  const ringRadius = RING_RADIUS * POSTER_PX_PER_WORLD;
  const ringCircumference = 2 * Math.PI * ringRadius;

  const clauses = Math.max(0, Math.floor(clauseCount));
  const passed = Math.min(clauses, Math.max(0, Math.floor(passedCount)));
  const arcLength = clauses > 0 ? (passed / clauses) * ringCircumference : 0;

  // The whole shell is dashed when the confidence did not clear the pass limit,
  // or when there is no confidence at all. Same rule and same meaning as the
  // dashed panel on a held task: this was inferred, not measured.
  const shellDash = plan.shellDashed ? " cvo-dashed" : "";

  return (
    <figure
      className={[
        // The .volume scope belongs to the volume voicing only. Applying it on
        // the plate would remap every ground and ink token to the dark set for
        // everything inside, which is the exact leak that scope prevents.
        surface === "volume" ? "volume" : "cv-oracle--plate",
        "cv-oracle",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={inkVars}
    >
      <style>{ORACLE_CSS}</style>

      <div className="cvo-stage" ref={stageRef} role="img" aria-label={label}>
        <svg
          className="cvo-poster"
          viewBox={`0 0 ${POSTER_SIZE} ${POSTER_SIZE}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {/* THE VERDICT RING. The full gauge, dashed, with the passed
              proportion laid over it solid. Rotated so the arc starts at
              twelve o'clock, which is how a gauge is wound. */}
          {clauses > 0 && (
            <g
              transform={`rotate(-90 ${POSTER_CENTRE} ${POSTER_CENTRE})`}
            >
              <circle
                className="cvo-ring-track"
                cx={POSTER_CENTRE}
                cy={POSTER_CENTRE}
                r={fmt(ringRadius)}
                strokeDasharray="3 2"
              />
              {arcLength > 0 && (
                <circle
                  className="cvo-ring-arc"
                  cx={POSTER_CENTRE}
                  cy={POSTER_CENTRE}
                  r={fmt(ringRadius)}
                  strokeDasharray={`${fmt(arcLength)} ${fmt(ringCircumference)}`}
                />
              )}
            </g>
          )}

          {/* THE SHELL. Fully resolved generations first, then the partial one
              on top - which is dashed whatever the threshold said, because it
              genuinely is not all there. */}
          <g>
            {poster.solid.map((line, i) => (
              <line
                key={`s${i}`}
                className={(line.near ? "cvo-near" : "cvo-far") + shellDash}
                x1={fmt(line.x1)}
                y1={fmt(line.y1)}
                x2={fmt(line.x2)}
                y2={fmt(line.y2)}
              />
            ))}
            {poster.partial.map((line, i) => (
              <line
                key={`p${i}`}
                className={`${line.near ? "cvo-near" : "cvo-far"} cvo-dashed`}
                x1={fmt(line.x1)}
                y1={fmt(line.y1)}
                x2={fmt(line.x2)}
                y2={fmt(line.y2)}
              />
            ))}
          </g>

          {/* THE CORE. Absent entirely when nothing has been judged - an
              unlit core is drawn by not drawing one, never by fading it. */}
          {behaviour.core !== null && (
            <g>
              <circle
                className="cvo-core"
                cx={POSTER_CENTRE}
                cy={POSTER_CENTRE}
                r={fmt(coreRadius)}
              />
              <circle
                className="cvo-core-dot"
                cx={POSTER_CENTRE}
                cy={POSTER_CENTRE}
                r="2.5"
              />
            </g>
          )}
        </svg>

        {/* The canvas mounts OVER the poster and is revealed only once it has
            actually drawn a frame. Starting hidden is what makes every failure
            path - no WebGL, an unreadable cascade, a failed shader, a lost
            context - fall back to a deliberate drawing instead of to a blank
            rectangle. */}
        <canvas
          className="cvo-canvas"
          ref={canvasRef}
          aria-hidden="true"
          style={{ display: "none" }}
        />
      </div>
    </figure>
  );
}

export default Oracle;
