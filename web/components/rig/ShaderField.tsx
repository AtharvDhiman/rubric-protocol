"use client";

import { useEffect, useRef } from "react";

import { servoMs } from "@/lib/rig";

/**
 * THE LANDING FIELD.
 *
 * A bounded dark viewport in which a single sensing probe traverses a faint,
 * directional energy field. It replaces the mocap skeleton as the landing hero,
 * and it is deliberately quieter: the skeleton printed figures, this one prints
 * nothing at all.
 *
 * Six decisions drive the whole file, and they are about honesty and about not
 * breaking the page, rather than about graphics.
 *
 * 1. THE POSTER IS THE DOCUMENT. A canvas cannot server-render, so the markup
 *    that leaves the server contains a complete, token-driven CSS painting of
 *    the field AT REST - the same glow in the same place, the same left-to-right
 *    colour mix, the same scan lines. The canvas mounts OVER it and is revealed
 *    only after a frame has actually been drawn. With JavaScript blocked, before
 *    hydration, on a machine with no WebGL, or after a context loss we cannot
 *    recover from, the poster is what the visitor keeps - and it looks like a
 *    deliberate still, not like a hole in the page.
 *
 * 2. THE FIRST DRAWN FRAME IS THE POSTER. The probe starts at HOME with the
 *    clock at zero, which is exactly what the poster paints, so the swap from
 *    CSS to WebGL is not visible as a pop. The rig discipline elsewhere in this
 *    repo is "server-render the terminal state, then rewind"; a field has no
 *    terminal state, so its analogue is "server-render the resting state, then
 *    depart from it".
 *
 * 3. NO COLOUR IS WRITTEN DOWN HERE. Every ink is read out of the live cascade
 *    by token name at mount (--d-ground, --marker, --v-warning) and handed to
 *    the shader as a uniform; the poster references the same tokens through
 *    var(). If a token cannot be parsed, the shader is NOT started and the
 *    poster stands - the component would rather show nothing than invent a
 *    colour. This is also why the reference file's Solana purple and green are
 *    absent: they measure 1.02:1 here and green in this system means one thing
 *    only, that the chain moved money.
 *
 * 4. THE BRIGHTNESS IS BOUNDED BY CONSTRUCTION, NOT BY EYE. See FIELD_GAIN
 *    below for the arithmetic. Real mono text sits over this panel, so the
 *    ceiling is a clamp in the shader rather than a judgement call.
 *
 * 5. THE PROBE IS DRIVEN, NOT TWEENED. It moves between stations on the shared
 *    trapezoidal servo profile from lib/rig.ts, with the ramp fixed in
 *    milliseconds so a longer move gets a longer cruise rather than a lazier
 *    curve. A pointer, where one exists, re-plans the current move; a touch
 *    device never attaches a listener and never notices anything is missing.
 *
 * 6. IT PRINTS NO FIGURES. A shader measures nothing, so any readout beside it
 *    would be invented telemetry sitting in the same mono face as the amounts
 *    and hashes a user is asked to verify. The accessible name describes the
 *    picture and stops there.
 */

/* ==========================================================================
   MOTION CONSTANTS
   ========================================================================== */

/**
 * Probe stations, in PANEL SPACE WITH Y DOWN - the same sense as CSS and SVG,
 * so these numbers read the same way as the poster's gradient positions. The y
 * axis is flipped once, at the point the uniform is set, because GL texture
 * coordinates put y=0 at the bottom. Flipping in one place beats keeping two
 * conventions straight in five.
 */
const HOME = { x: 0.3, y: 0.56 };

const STATIONS: readonly { x: number; y: number }[] = [
  { x: 0.7, y: 0.34 },
  { x: 0.58, y: 0.7 },
  { x: 0.22, y: 0.4 },
  { x: 0.46, y: 0.62 },
  // Closes the tour back onto HOME, so the loop has no seam.
  { x: HOME.x, y: HOME.y },
];

/**
 * Leg duration as a function of distance.
 *
 * `servoMs` holds the acceleration ramp at a fixed 70ms whatever the move, so
 * the only thing distance is allowed to buy is a longer flat cruise. Making the
 * duration proportional to distance is what keeps the probe's SPEED roughly
 * constant between a short hop and a long sweep - a constant duration would
 * make the long sweep visibly faster, which is what a tween does and what a
 * motor does not.
 *
 * The fixed term is small on purpose. It was 240ms in a first pass, which is
 * enough of the budget on a short leg to leave the longest leg travelling twice
 * as fast as the shortest - the very effect this shape exists to remove. Across
 * the station tour the constants below hold the speed inside 1.3x, while the
 * cruise fraction still stretches from 53% on the shortest leg to 84% on the
 * longest, which is the part the eye reads as torque-limited.
 */
const MOVE_BASE_MS = 140;
const MOVE_SPAN_MS = 1600;
const MOVE_MIN_MS = 220;
const MOVE_MAX_MS = 1600;

/**
 * Orbit angular rate for the plate, radians per second.
 *
 * 0.16 gives a horizontal sweep of roughly 39 seconds. The reference runs at 1
 * rad/s - a six-second lap - which is right for a small hero panel and far too
 * busy stretched across a whole page: at full-bleed the eye tracks it as
 * something moving rather than as a surface, and it competes with the text it
 * is sitting under.
 */
const ORBIT_RATE = 0.16;

/** Rest between legs. The probe is sampling, not patrolling. */
const DWELL_MS = 1100;

/** The pause before the first departure, so the field opens on the poster. */
const FIRST_DWELL_MS = 700;

/**
 * Pointer re-planning limits. A mousemove storm can fire on every frame; if
 * each event restarted the leg, the trapezoid would never leave its 70ms
 * acceleration ramp and the probe would crawl. So a re-plan needs both a
 * minimum interval and a minimum change of target.
 */
const RETARGET_MIN_MS = 140;
const RETARGET_MIN_DIST = 0.02;

/** Scan line period, in CSS pixels. Multiplied by DPR before it reaches GL. */
const SCAN_PERIOD_CSS_PX = 3;

/** The devicePixelRatio ceiling. A 3x phone would otherwise render 9x pixels. */
const MAX_DPR = 2;

/* ==========================================================================
   COLOUR

   A local copy of the token parser rather than a shared import, because this
   component is meant to be self-contained and the parser is fifteen lines. It
   handles the two forms a custom property can come back as: the hex literal the
   stylesheet actually contains, and the rgb() form some engines normalise to.
   ========================================================================== */

type RGB01 = [number, number, number];

function parseColour(value: string): RGB01 | null {
  const v = value.trim();

  if (v.startsWith("#")) {
    const hex = v.slice(1);
    const expand =
      hex.length === 3
        ? [hex[0] + hex[0], hex[1] + hex[1], hex[2] + hex[2]]
        : hex.length === 6
          ? [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
          : null;
    if (!expand) return null;
    const [r, g, b] = expand.map((part) => Number.parseInt(part, 16));
    if (Number.isNaN(r + g + b)) return null;
    return [r / 255, g / 255, b / 255];
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

/** Where this field is painted, which decides its palette and its amplitude. */
export type FieldVariant = "volume" | "plate";

interface Palette {
  /** --d-ground: the volume floor the field is painted on top of. */
  base: RGB01;
  /** --marker: the identity ink inside a volume. */
  energy: RGB01;
  /** --v-warning: the second, cooler end of the mix. */
  secondary: RGB01;
}

/**
 * Read the three inks out of the live cascade. Returns null if ANY of them
 * cannot be read, which is the fail-safe: no palette means no shader, and the
 * poster - which resolves the same tokens through var() and therefore cannot be
 * wrong - is what the visitor sees.
 */
/**
 * Which three tokens each variant paints with.
 *
 * The tokens differ but the ROLES do not, which is what makes the two voicings
 * read as one instrument: a ground, an identity ink, and a cooler second ink.
 * Inside a volume the identity ink is --marker; on the plate it is --accent,
 * because --marker measures 1.26:1 on --page and is banned there. That rule is
 * already mechanical in the stylesheet; this keeps the shader on the same side
 * of it.
 */
const TOKENS = {
  volume: {
    base: "--d-ground",
    energy: "--marker",
    secondary: "--v-warning",
  },
  plate: {
    base: "--page",
    energy: "--accent",
    secondary: "--warning",
  },
} as const;

function readPalette(el: Element, variant: FieldVariant): Palette | null {
  try {
    const names = TOKENS[variant];
    const computed = getComputedStyle(el);
    const base = parseColour(computed.getPropertyValue(names.base));
    const energy = parseColour(computed.getPropertyValue(names.energy));
    const secondary = parseColour(computed.getPropertyValue(names.secondary));
    if (!base || !energy || !secondary) return null;
    return { base, energy, secondary };
  } catch {
    return null;
  }
}

/**
 * GAIN AND SCAN DEPTH, PER VARIANT - and why they are not the same number.
 *
 * The field only ever ADDS to the ground and the scan line only ever
 * SUBTRACTS. On the dark volume that makes the field the thing to bound: text
 * sits on a near-black ground, so brightening is what erodes contrast.
 *
 * Full-bleed on the light plate, the arithmetic inverts. Adding light to a
 * pale ground RAISES contrast for the dark inks on top of it, so the field is
 * free; the scan line is now the only hazard, because it is the only term that
 * darkens. And the plate has very little room: --hairline is a 3:1 graphic
 * sitting at 3.76:1 today, which puts the floor at luminance 0.6743 against a
 * page at 0.7085. Measured, the largest uniform subtraction the page survives
 * is 0.0186 - the volume's own 0.018 would land at 0.6754, clearing the floor
 * by 0.0011, which is not a margin, it is a coincidence.
 *
 * 0.006 lands at 0.6974 and leaves 68% of the available headroom unspent.
 *
 * The gain is smaller on the plate for a different reason, which is taste
 * rather than safety: the whole page is the panel, forty text nodes sit
 * directly on it, and a field you notice while reading a headline is a field
 * that is too strong.
 */
const VARIANT_TUNING = {
  volume: { gain: 0.3, scanDepth: 0.018, orbit: false },
  // 0.18, not 0.09. At 0.09 the field swings luminance by 0.052 - present,
  // but close enough to invisible that the motion does not read. 0.18 doubles
  // that to 0.107, which is a drift you can actually see.
  //
  // Raising it is safe in the direction that matters: the field only ADDS, and
  // brightening a pale ground RAISES contrast for the dark inks on top of it.
  // The ceiling is set by something else entirely - depth in this system is
  // carried by the plane change between --page and --surface, so the brightest
  // field pixel must stay clearly below --surface at 0.8579 or the panels stop
  // reading as raised. 0.18 peaks at 0.8157 and keeps 0.042 of that gap, and
  // the peak only occurs at the glow centre; most of the page sits far below it.
  //
  // ORBIT, not a station tour. The two variants move differently on purpose.
  //
  // In the bounded panel the probe hops between stations and dwells: it is an
  // instrument sampling a small field, and the pauses are the point. Full-bleed
  // that reading collapses - across a whole page a hop-and-dwell reads as a
  // stutter rather than as deliberation, because the eye has no frame to
  // measure the pauses against. So the plate takes the reference's motion: one
  // light source drifting continuously, never arriving. Same shader, same
  // uniform; only what drives u_probe changes.
  plate: { gain: 0.18, scanDepth: 0.006, orbit: true },
} as const;

/* ==========================================================================
   THE SHADERS
   ========================================================================== */

const VERTEX_SRC = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/**
 * FIELD_GAIN and why the overlaid text is safe.
 *
 * The field is `base + tint * amp`, where `amp` is clamped to FIELD_GAIN and
 * `tint` is a mix of --marker and --v-warning. So the brightest pixel this
 * shader can produce, for any input at all, is --d-ground plus 0.30 of the
 * lighter of the two inks (--v-warning, whose blue channel is 1.0):
 *
 *   rgb(0.215, 0.285, 0.375)  ->  WCAG relative luminance 0.064
 *
 * Against that absolute ceiling, the two inks that ever sit on this panel
 * measure:
 *
 *   --d-text  #f2f4f1  ->  8.3:1
 *   --d-muted #b6beba  ->  5.4:1
 *
 * Both clear the 4.5:1 body-text floor with the shader pinned at its maximum,
 * which is the point: the guarantee is a clamp, not a judgement about how it
 * looks.
 *
 * With the constants as shipped the term inside the clamp peaks at 0.69 rather
 * than 1.0, so there is headroom on top of that. Measured rather than argued -
 * the frame was rendered with the probe forced to the panel centre and read
 * back off the GPU with readPixels, and the brightest pixel in it was
 * rgb(28,43,51), luminance 0.032: 11.6:1 for --d-text and 7.5:1 for --d-muted.
 * The mean field is far below even that.
 *
 * This is also why the field is composed by ADDING to the ground and the scan
 * line only ever SUBTRACTS. Nothing in the pipeline can push a pixel lighter
 * than the bound above, so the bound holds for the composite and not merely for
 * each term.
 */
const FRAGMENT_SRC = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  u_resolution;  // drawing buffer size, in device pixels
uniform float u_time;        // seconds of accumulated RUNNING time
uniform vec2  u_probe;       // glow centre, 0..1, y up
uniform vec3  u_base;        // --d-ground
uniform vec3  u_energy;      // --marker
uniform vec3  u_secondary;   // --v-warning
uniform float u_scan;        // scan line period, in device pixels
uniform float u_gain;        // FIELD_GAIN, per variant
uniform float u_scanDepth;   // SCAN_DEPTH, per variant

varying vec2 v_texCoord;

void main() {
  vec2 uv = v_texCoord;

  // Aspect-corrected panel space, so the glow stays a circle in a 16:9 panel
  // instead of being stretched into a lozenge.
  float aspect = max(u_resolution.x, 1.0) / max(u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // FLOW. The reference's sin(x)*cos(y) lattice, plus one diagonal octave at a
  // different frequency and drift rate. Two incommensurate terms are what stop
  // the field visibly repeating on a short period; the divide by 1.5 puts the
  // sum back inside [-1, 1] so everything downstream stays bounded.
  float flow = sin(uv.x * 9.0 + u_time * 0.55) * cos(uv.y * 6.5 - u_time * 0.31);
  flow += 0.5 * sin((uv.x * 0.8 + uv.y) * 14.0 - u_time * 0.85);
  flow /= 1.5;
  float field = 0.5 + 0.5 * flow;

  // THE TRAVELLING GLOW. The reference divides by the raw distance, which goes
  // to infinity at the centre and blows out to white; the constant in the
  // denominator caps it at 0.16 / 0.34 = 0.470 while leaving the 1/r falloff
  // shape intact away from the centre.
  vec2 probe = (u_probe - 0.5) * vec2(aspect, 1.0);
  float glow = 0.16 / (length(p - probe) * 3.4 + 0.34);

  // EDGE FALLOFF. The field settles back toward the bare ground at the panel
  // edge, so the viewport reads as something cut into the plate rather than as
  // a rectangle of wallpaper. Squashed on x so a wide panel does not lose its
  // corners twice over.
  float vign = 1.0 - 0.42 * smoothstep(0.28, 0.92, length(p * vec2(0.72, 1.0)));

  // The clamp is the contrast guarantee. See the comment above this source.
  float amp = u_gain * clamp((0.42 * field + 0.58 * glow) * vign, 0.0, 1.0);

  // The two-colour mix along x, nudged by the flow so the boundary between the
  // inks is a moving front rather than a vertical seam.
  vec3 tint = mix(u_energy, u_secondary, clamp(uv.x * 0.85 + flow * 0.16, 0.0, 1.0));
  vec3 color = u_base + tint * amp;

  // SCAN LINE. Driven by gl_FragCoord rather than by uv, so the period is a
  // fixed number of device pixels and does not stretch or moire as the panel
  // resizes. It only ever darkens.
  float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 6.2831853 / max(u_scan, 2.0));
  color -= scan * u_scanDepth;

  gl_FragColor = vec4(max(color, 0.0), 1.0);
}`;

/* ==========================================================================
   GL PLUMBING

   Everything here checks. The reference file does not check compile or link
   status, which means a single typo in the shader source fails silently to a
   black rectangle with nothing in the console - the exact failure mode that is
   hardest to diagnose from a bug report.
   ========================================================================== */

/**
 * A bare canceller for the context-lost event, kept at module scope so it is a
 * stable reference the DOM will de-duplicate.
 *
 * A context loss is only REVERSIBLE if the webglcontextlost event was cancelled;
 * an uncancelled loss makes the browser refuse restoreContext() outright with
 * "context restoration not allowed". Teardown removes the component's own
 * handler and then deliberately loses the context, so without this outliving it
 * the canvas could never be brought back.
 */
const cancelLoss = (event: Event): void => event.preventDefault();

/** Log a shader failure once per page load, not once per frame or per retry. */
let loggedShaderFailure = false;

function logOnce(message: string, detail: string | null): void {
  if (loggedShaderFailure) return;
  loggedShaderFailure = true;
  console.error(`[ShaderField] ${message}`, detail ?? "");
}

interface GlResources {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  uTime: WebGLUniformLocation | null;
  uResolution: WebGLUniformLocation | null;
  uProbe: WebGLUniformLocation | null;
  uScan: WebGLUniformLocation | null;
}

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
    logOnce("shader failed to compile", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Build (or rebuild, after a context restore) the program, the full-screen quad
 * and the uniform locations. Returns null on any failure, and the caller then
 * falls back to the poster.
 *
 * The constant uniforms - the three inks - are set here rather than per frame:
 * they only change if the stylesheet changes, which cannot happen without a
 * reload.
 */
function build(
  gl: WebGLRenderingContext,
  palette: Palette,
  tuning: { gain: number; scanDepth: number }
): GlResources | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  if (!vs) return null;
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  if (!fs) {
    gl.deleteShader(vs);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  // The shader objects are reference-counted by the program once linked, so
  // they can be released immediately whether or not the link succeeded.
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    logOnce("program failed to link", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );

  const attrib = gl.getAttribLocation(program, "a_position");
  if (attrib < 0) {
    logOnce("a_position was optimised away or not found", null);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    return null;
  }
  gl.enableVertexAttribArray(attrib);
  gl.vertexAttribPointer(attrib, 2, gl.FLOAT, false, 0, 0);

  gl.uniform3fv(gl.getUniformLocation(program, "u_base"), palette.base);
  gl.uniform3fv(gl.getUniformLocation(program, "u_energy"), palette.energy);
  gl.uniform3fv(gl.getUniformLocation(program, "u_secondary"), palette.secondary);

  // Constant for the life of the program, so they are set here rather than in
  // the draw loop. Both are the contrast guarantee: see VARIANT_TUNING.
  gl.uniform1f(gl.getUniformLocation(program, "u_gain"), tuning.gain);
  gl.uniform1f(gl.getUniformLocation(program, "u_scanDepth"), tuning.scanDepth);

  return {
    program,
    buffer,
    uTime: gl.getUniformLocation(program, "u_time"),
    uResolution: gl.getUniformLocation(program, "u_resolution"),
    uProbe: gl.getUniformLocation(program, "u_probe"),
    uScan: gl.getUniformLocation(program, "u_scan"),
  };
}

/* ==========================================================================
   THE MOTION PLANNER

   A tiny single-axis-pair motion controller. It holds a current position, the
   leg it is executing, and a dwell timer, and it is advanced by elapsed
   milliseconds - which is what lets the whole rig be paused and resumed at the
   beat it stopped on rather than restarted.
   ========================================================================== */

interface Planner {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Duration of the current leg, ms. */
  dur: number;
  /** Elapsed within the current leg, ms. */
  legMs: number;
  /** Remaining dwell before the next leg begins, ms. */
  dwellMs: number;
  /** Index of the NEXT station on the tour. */
  station: number;
}

function createPlanner(): Planner {
  return {
    x: HOME.x,
    y: HOME.y,
    fromX: HOME.x,
    fromY: HOME.y,
    toX: HOME.x,
    toY: HOME.y,
    dur: MOVE_MIN_MS,
    legMs: MOVE_MIN_MS,
    dwellMs: FIRST_DWELL_MS,
    station: 0,
  };
}

function durationFor(distance: number): number {
  return Math.min(
    MOVE_MAX_MS,
    Math.max(MOVE_MIN_MS, MOVE_BASE_MS + distance * MOVE_SPAN_MS)
  );
}

/** Plan a move from wherever the probe is now to a new target, starting now. */
function beginLeg(pl: Planner, x: number, y: number): void {
  pl.fromX = pl.x;
  pl.fromY = pl.y;
  pl.toX = x;
  pl.toY = y;
  pl.dur = durationFor(Math.hypot(x - pl.x, y - pl.y));
  pl.legMs = 0;
  pl.dwellMs = 0;
}

/**
 * Advance the planner by a real elapsed interval.
 *
 * The loop exists so a long frame - a slow device, or the first frame after a
 * resume - is not silently swallowed by whichever phase happens to be running:
 * the leftover time carries into the next phase. It is bounded by a guard
 * counter rather than by `while (dt > 0)` so that no combination of zero-length
 * phases can spin the main thread.
 */
function advance(pl: Planner, dtMs: number): void {
  let dt = Math.max(0, dtMs);

  for (let guard = 0; guard < 8 && dt > 0; guard++) {
    if (pl.dwellMs > 0) {
      const used = Math.min(dt, pl.dwellMs);
      pl.dwellMs -= used;
      dt -= used;
      if (pl.dwellMs > 0) return;
      const next = STATIONS[pl.station];
      pl.station = (pl.station + 1) % STATIONS.length;
      beginLeg(pl, next.x, next.y);
      continue;
    }

    const used = Math.min(dt, pl.dur - pl.legMs);
    pl.legMs += used;
    dt -= used;

    const u = servoMs(pl.legMs, pl.dur);
    pl.x = pl.fromX + (pl.toX - pl.fromX) * u;
    pl.y = pl.fromY + (pl.toY - pl.fromY) * u;

    if (pl.legMs >= pl.dur) pl.dwellMs = DWELL_MS;
  }
}

/* ==========================================================================
   STYLE

   Scoped to .sf-field and kept in the component so the rig is one file. Every
   colour is a token by name, and every one of them is a volume-only token -
   legal here and only here because the root element carries `volume`, inside
   which .volume{} remaps the ground and ink tokens to the dark set.

   The stage geometry deliberately matches the mocap rig's: 16/9, 4/5 under
   700px, a 1px border and no radius. The two rigs are the same instrument.
   ========================================================================== */

const FIELD_CSS = `
.sf-field { display: block; margin: 0; width: 100%; }

.sf-field .sf-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--d-ground);
  border: 1px solid var(--border);
  overflow: hidden;
}

/* THE POSTER. This is the whole drawing in the server-rendered HTML: the base
   mix along x, the resting glow at HOME, the edge falloff and the scan lines,
   in that painting order. Layers are listed top-first in background-image, so
   this list reads bottom-up relative to the shader's composition.

   color-mix carries the alpha, which keeps every colour here a token reference
   rather than a literal. On an engine without color-mix the affected layers
   simply do not paint and the panel falls back to the bare --d-ground it is
   already cut into - dimmer than intended, never wrong.

   The percentages are not guesses. The shader's resting frame was rendered and
   read back off the GPU, and its brightest pixel at HOME measured rgb(28,43,51);
   these layers composite to rgb(27,47,53) at the same point, which is inside the
   band where the eye cannot see the handover.

   The scan line is a TRIANGLE wave - transparent, peak, transparent - rather
   than a hard 1px band. The shader's is a sine, and a hard band at this pitch
   aliases into visible wide stripes as soon as the panel lands on a fractional
   device pixel ratio. */
.sf-field .sf-poster {
  position: absolute;
  inset: 0;
  background-color: var(--d-ground);
  background-image:
    repeating-linear-gradient(
      to bottom,
      transparent 0,
      color-mix(in srgb, var(--d-ground) 30%, transparent) 1.5px,
      transparent 3px
    ),
    radial-gradient(
      circle at 50% 50%,
      transparent 30%,
      color-mix(in srgb, var(--d-ground) 55%, transparent) 100%
    ),
    radial-gradient(
      circle at 30% 56%,
      color-mix(in srgb, var(--marker) 8%, transparent) 0%,
      transparent 30%
    ),
    radial-gradient(
      circle at 30% 56%,
      color-mix(in srgb, var(--v-warning) 5%, transparent) 0%,
      transparent 55%
    ),
    linear-gradient(
      to right,
      color-mix(in srgb, var(--marker) 4%, transparent),
      color-mix(in srgb, var(--v-warning) 5%, transparent)
    );
}

/* The canvas is transparent until a frame has actually been drawn into it, so
   a failed context or a failed compile never replaces the poster with a blank
   rectangle. No transition on the reveal: frame zero IS the poster, so a hard
   swap is invisible, and a fade would be animating a surface that carries
   meaning for no reason. */
.sf-field .sf-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
}
.sf-field .sf-canvas[data-live="1"] { opacity: 1; }

@media (max-width: 700px) {
  .sf-field .sf-stage { aspect-ratio: 4 / 5; }
}

/* THE PLATE VOICING - the full-bleed page ground.

   Fixed rather than absolute, so the field is the surface the page moves over
   instead of a very tall element that scrolls with it. z-index 0 with
   everything above at auto puts it behind all content while staying inside the
   normal stacking order, so no component needs to know it exists.

   No border and no aspect ratio: this one is not a viewport cut into anything,
   it IS the plate. */
.sf-field--plate {
  position: fixed;
  inset: 0;
  /* NEGATIVE, and the sign matters. A fixed element at z-index 0 creates a
     stacking context and paints ABOVE every non-positioned block in the same
     one - which put the field over the entire page instead of under it. At -1
     it paints after the root background and before all in-flow content, which
     is the only slot that means "the ground". */
  z-index: -1;
  pointer-events: none;
}
.sf-field--plate .sf-stage {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  background: var(--page);
  border: 0;
}
/* The poster for the plate is the bare page tone. The shipped gain is 0.09 and
   the scan depth 0.006, so the resting difference between poster and shader is
   below the threshold where a handover is visible - and a static approximation
   of a field this faint would cost more in paint than it buys. */
.sf-field--plate .sf-poster {
  background-color: var(--page);
  background-image: none;
}
`;

/* ==========================================================================
   THE COMPONENT
   ========================================================================== */

export interface ShaderFieldProps {
  /** Extra classes on the figure. */
  className?: string;
  /**
   * "volume" is the bounded dark viewport - a 16:9 panel cut into the plate.
   * "plate" is the full-bleed page ground: fixed, behind everything, painted in
   * the light tokens at instrument amplitude.
   *
   * Defaults to "plate", which is the only variant mounted anywhere. The
   * default used to be "volume" - the unmounted branch, reachable by simply
   * forgetting the prop.
   */
  variant?: FieldVariant;
}

/**
 * The accessible name describes the RESTING picture - the one in the HTML, the
 * one a reduced-motion reader keeps, and the one that survives every fallback.
 * It names no quantity, because there is no quantity here to name.
 */
const LABEL =
  "Capture volume viewport: a dark instrument field with a single teal " +
  "sensing glow low on the left, a faint directional wash shifting from teal " +
  "to pale blue across it, and fine horizontal scan lines.";

export function ShaderField({ className, variant = "plate" }: ShaderFieldProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * The clock and the planner live in refs so a StrictMode remount - or any
   * future effect teardown - resumes the take rather than restarting it.
   */
  const elapsedRef = useRef<number>(0);
  const plannerRef = useRef<Planner>(createPlanner());

  /**
   * The WEBGL_lose_context handle, kept in a ref because it CANNOT be re-fetched
   * once the context is lost: getExtension returns null on a lost context, which
   * is verified behaviour and not a defensive guess. Teardown deliberately loses
   * the context, so without this the next mount on the same canvas has no way to
   * ask for it back. See the first-build block in the effect.
   */
  const loseExtRef = useRef<WEBGL_lose_context | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    // No palette, no shader. The poster is already correct on its own.
    const palette = readPalette(stage, variant);
    const tuning = VARIANT_TUNING[variant];
    if (!palette) return;

    const attrs: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    };

    // "experimental-webgl" is the pre-standard name still needed by a few old
    // Android and IE-era builds. It is the same context under another key.
    const context =
      canvas.getContext("webgl", attrs) ??
      canvas.getContext("experimental-webgl", attrs);
    const gl = context as WebGLRenderingContext | null;
    if (!gl) return;

    // On a healthy context this is the live handle; on a context this component
    // lost during a previous teardown, getExtension returns null and the handle
    // kept from that earlier mount is the only one that can restore it.
    const loseExt = gl.getExtension("WEBGL_lose_context") ?? loseExtRef.current;
    loseExtRef.current = loseExt;

    let res: GlResources | null = null;
    let dpr = 1;
    let live = false;
    let raf = 0;
    let running = false;
    let inView = true;
    let lost = false;
    let last = 0;

    /**
     * Match the drawing buffer to the panel, at capped DPR.
     *
     * Resizing the drawing buffer does not disturb the bound program, buffer or
     * attribute state, so nothing needs rebuilding here - only the viewport,
     * which `draw` sets every frame anyway.
     */
    const syncSize = (): boolean => {
      const rect = stage.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      return true;
    };

    const draw = (): void => {
      if (!res || lost || gl.isContextLost()) return;
      const pl = plannerRef.current;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(res.uTime, elapsedRef.current / 1000);
      gl.uniform2f(res.uResolution, canvas.width, canvas.height);
      // The one place the y convention flips: planner space is y-down, GL
      // texture space is y-up.
      // The orbit is a Lissajous rather than a circle: the reference uses
      // sin(t) and cos(t) at the SAME rate, which is a closed circle that
      // repeats exactly once per period and is visibly a loop. Detuning the
      // vertical axis to 0.61 of the horizontal makes the path close only
      // after a very long time, so at page scale it never reads as a cycle.
      if (tuning.orbit) {
        const t = elapsedRef.current / 1000;
        gl.uniform2f(
          res.uProbe,
          0.5 + 0.36 * Math.sin(t * ORBIT_RATE),
          0.5 + 0.28 * Math.cos(t * ORBIT_RATE * 0.61)
        );
      } else {
        gl.uniform2f(res.uProbe, pl.x, 1 - pl.y);
      }
      gl.uniform1f(res.uScan, SCAN_PERIOD_CSS_PX * dpr);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Reveal only after a frame exists. Before this the poster is what shows.
      if (!live) {
        live = true;
        canvas.dataset.live = "1";
      }
    };

    /** Build (or rebuild) and paint the resting frame. */
    const setup = (): void => {
      res = build(gl, palette, tuning);
      if (!res) return;
      if (syncSize()) draw();
    };

    // THE REDUCED-MOTION GUARD. Checked here, before anything is scheduled, so
    // no requestAnimationFrame work is ever queued for a reader who asked for
    // none - not queued and then cancelled, never queued. Exactly one frame has
    // been drawn, at the resting state, by the same `draw` the animation uses.
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const tick = (now: number): void => {
      // Clamp the step. A backgrounded tab or a long main-thread stall would
      // otherwise hand us a delta of several seconds and teleport the probe.
      const dt = Math.min(100, Math.max(0, now - last));
      last = now;
      elapsedRef.current += dt;
      advance(plannerRef.current, dt);
      draw();
      raf = requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (running || reduceMotion || lost || !res) return;
      running = true;
      // Resume from NOW, so the paused interval is not credited to the clock
      // and the field picks up on the beat it stopped on.
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

    /**
     * The resize path. Under reduced motion this still redraws - a redraw at an
     * unchanged state is not motion, and skipping it would leave a stretched
     * frame behind.
     */
    const resize = new ResizeObserver(() => {
      if (!syncSize()) return;
      draw();
    });
    resize.observe(stage);

    /**
     * CONTEXT LOSS. Common on a laptop waking from sleep, on a GPU driver
     * reset, and whenever the browser reclaims contexts because too many are
     * open. Without preventDefault the context is never restored and the panel
     * is a dead rectangle for the rest of the session.
     */
    const onLost = (event: Event): void => {
      event.preventDefault();
      lost = true;
      stop();
      res = null;
      live = false;
      // Hand the panel back to the poster rather than showing a blank canvas.
      delete canvas.dataset.live;
    };

    const onRestored = (): void => {
      lost = false;
      setup();
      // If the rebuild failed, `res` is null, nothing was revealed, and the
      // poster stands. Only resume the loop when there is something to draw.
      if (res) sync();
    };

    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    /**
     * FIRST BUILD, and the one case that is easy to get wrong.
     *
     * Teardown below deliberately kills the context with loseContext(), because
     * a browser only keeps about sixteen of them alive. If the SAME canvas
     * element is then mounted again - which is exactly what React StrictMode
     * does in development, and what any future remount would do - getContext
     * hands back that same DEAD context, every shader compile fails with an
     * empty info log, and the panel is a permanent blank.
     *
     * So: if the context we were handed is already lost, ask for it back rather
     * than building on it, using the extension handle kept in a ref from the
     * previous mount - `gl.getExtension` returns null on a lost context and
     * cannot supply one. The restore handler registered above does the build
     * when it arrives. Without a handle there is nothing to ask with, and the
     * poster stands.
     */
    let restoreTimer = 0;
    if (gl.isContextLost()) {
      // One more piece of ordering: React tears down and re-mounts inside a
      // single task, so the webglcontextlost event from that teardown has been
      // QUEUED but not yet dispatched, and until it has been dispatched and
      // cancelled the browser refuses the restore. Asking on the next task lets
      // the event land first. The lost event queued before this timer therefore
      // runs before it, which is the ordering the restore depends on.
      restoreTimer = window.setTimeout(() => loseExt?.restoreContext(), 0);
    } else {
      setup();
    }

    /**
     * POINTER. Attached only where a fine pointer actually exists - on a touch
     * device there is nothing to listen for, and the station tour is the whole
     * behaviour rather than a degraded version of one.
     *
     * The pointer does not drag the glow around directly. It re-plans the
     * current leg, so the probe still accelerates, cruises and arrives like an
     * axis under load. When the pointer stops, the leg finishes, the dwell
     * elapses, and the tour resumes on its own - no idle timer needed.
     */
    const fine =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: fine)").matches;

    let lastRetarget = 0;
    const onPointerMove = (event: MouseEvent): void => {
      if (!running) return;
      const now = performance.now();
      if (now - lastRetarget < RETARGET_MIN_MS) return;

      const rect = stage.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      // Clamped rather than ignored when the pointer is outside the panel: the
      // probe leans toward the edge the pointer left by, which reads as
      // tracking, where ignoring reads as the rig freezing.
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));

      const pl = plannerRef.current;
      if (Math.hypot(x - pl.toX, y - pl.toY) < RETARGET_MIN_DIST) return;

      lastRetarget = now;
      beginLeg(pl, x, y);
    };

    if (fine && !reduceMotion) {
      window.addEventListener("mousemove", onPointerMove, { passive: true });
    }

    let observer: IntersectionObserver | null = null;
    if (!reduceMotion && typeof IntersectionObserver !== "undefined") {
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
    if (!reduceMotion) {
      document.addEventListener("visibilitychange", onVisibilityChange);
      sync();
    }

    return () => {
      stop();
      window.clearTimeout(restoreTimer);
      resize.disconnect();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("mousemove", onPointerMove);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);

      // Hide the canvas again on the way out. Whatever it holds is about to
      // become the contents of a dead context, and the poster underneath is a
      // correct picture; leaving the reveal flag set would show the stale
      // buffer for as long as a remount takes to draw its first frame.
      live = false;
      delete canvas.dataset.live;

      // A browser keeps roughly sixteen live WebGL contexts. Leaking one per
      // route change eventually kills every canvas on the page, including this
      // one on the way back, so the context is explicitly released and not
      // merely dereferenced.
      if (res) {
        gl.deleteBuffer(res.buffer);
        gl.deleteProgram(res.program);
        res = null;
      }
      // The canceller must be in place BEFORE the loss is triggered, or the
      // loss is final and this canvas can never render again.
      canvas.addEventListener("webglcontextlost", cancelLoss);
      loseExt?.loseContext();
    };
  }, [variant]);

  return (
    <figure
      className={[
        variant === "volume" ? "volume" : "sf-field--plate",
        "sf-field",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={variant === "plate" ? true : undefined}
    >
      <style>{FIELD_CSS}</style>

      <div
        className="sf-stage"
        ref={stageRef}
        role={variant === "volume" ? "img" : undefined}
        aria-label={variant === "volume" ? LABEL : undefined}
      >
        {/* Both layers are decorative geometry; the stage above carries the
            accessible name for the pair. */}
        <div className="sf-poster" aria-hidden="true" />
        <canvas className="sf-canvas" ref={canvasRef} aria-hidden="true" />
      </div>
    </figure>
  );
}

export default ShaderField;
