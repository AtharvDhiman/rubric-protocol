"use client";

import {
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type Ref,
  type RefObject,
} from "react";

import styles from "./Telemetry.module.css";

/**
 * The mono readout shared by both rigs.
 *
 * Two strips exist and no more: the landing skeleton's solve readout, and the
 * inspection arm's axis readout on /task/[id]. They are the same object -
 * fixed-width key/value cells, 11px Martian, tabular figures - because they are
 * both a machine saying what it currently measures.
 *
 *
 * THE RULE THAT MATTERS MOST IN THIS FILE
 * =======================================
 * NOTHING HERE MAY STATE A FACT THAT IS NOT REAL.
 *
 * Every cell below is a quantity the simulation actually holds. An earlier
 * draft of this readout also carried `VOL 6.0 x 6.0 x 3.0 m`, `RIG 01`,
 * `FEED 12 mm/s` and `PROBE Z`. All four are deleted, deliberately, and must
 * not come back. They assert physical measurements about a room and a machine
 * that do not exist, and they would sit in the SAME mono strip as the
 * confidence score, the escrow amount and the clause hash - figures the user is
 * being asked to trust on a product whose entire pitch is "pay on proof, not on
 * trust". A readout that is right about four things and costume about four more
 * is not 50% trustworthy; it is untrustworthy, because the reader has no way to
 * tell which half they are looking at.
 *
 * The surviving cells earn their place:
 *   RESIDUAL  RMS marker offset from ground truth - the drawing's own state
 *   RAYS      how many camera rays are contributing, out of how many exist
 *   MARKERS   how many markers are solved, out of how many are declared
 *   SOLVE     the solve quality the phase machine is holding
 *   FRAME     derived from elapsed MILLISECONDS, never from a rAF tick count
 *   J1 / J2   deg() of the live pose, straight off solveIK2
 *   LOAD      the normalised derivative of servoMs - it really is 0.00 in a dwell
 *   CYCLE     which clause of how many
 *   STATE     the beat the choreography is on, as a word
 *
 * If a future cell cannot be described in one line like those, it does not go
 * in.
 *
 *
 * WHY THERE IS AN IMPERATIVE HANDLE
 * =================================
 * The rigs run a requestAnimationFrame loop and are forbidden from calling
 * setState per frame. That applies to the readout as much as to the SVG: a
 * frame counter driven through React would re-render this subtree sixty times a
 * second for the rest of the page's life.
 *
 * So the strip has two ways in, and they have different jobs:
 *
 *   - The `values` PROP is the server render. Whatever the server passes is
 *     what lands in the HTML, so the terminal figures exist before any script
 *     runs - which is also exactly what the reduced-motion path and a JS-blocked
 *     reader get, with no separate fallback markup.
 *
 *   - `ref.current.write(values)` is the animation. It sets textContent
 *     directly on the value nodes. No React render, no reconciliation, no
 *     allocation beyond the formatted strings.
 *
 * ONE HAZARD, STATED PLAINLY: once write() has been called, React does not know
 * the DOM text changed. A later re-render with the SAME `values` prop will
 * therefore leave the written text in place, because React diffs against its
 * own previous output rather than against the DOM. That is the correct
 * behaviour for a rig that owns its own frames, but it means the rig - not a
 * parent - is responsible for putting the strip back to its terminal figures
 * when the loop stops. Pass fresh `values` or call write() with the terminal
 * state; do not expect a bare re-render to reset it.
 *
 *
 * COLOUR
 * ======
 * This file names no colour at all. Layout and ink both live in
 * Telemetry.module.css, and every ink there is a semantic token that the
 * `.volume` scope in globals.css redefines to the dark set. Drop the strip
 * inside a volume and it resolves to --d-text / --d-muted; leave it on a plate
 * and it resolves to --text / --text-muted. The volume-only inks are never
 * named here, so none of them can leak onto a light ground.
 */

/* ==========================================================================
   PRECISION

   Decimals shown = decimals actually measured. This is a typographic rule in
   this system, not a formatting preference: printing 0.94 for a confidence the
   model reported as the integer 94 claims two digits of precision that were
   never measured, and doing that in the same face as the escrow amount teaches
   the reader that the figures here are decorative.

     RESIDUAL  2dp, in mm       CYCLE     zero-padded integers
     SOLVE     integer          J1 / J2   1dp, signed, in degrees
     RAYS      integers         LOAD      2dp
     MARKERS   integers         FRAME     zero-padded to 6
   ========================================================================== */

/**
 * What a cell prints when it has no measurement.
 *
 * The same double em-dash the inspection table uses in an unruled STATUS cell,
 * for the same reason: an empty cell reads as a rendering bug and a zero reads
 * as a measurement. This is neither.
 *
 * It appears whenever a rig hands over a non-finite number - a NaN out of a
 * degenerate solve, an Infinity out of a divide. Printing "NaN" in a strip of
 * trustworthy figures is bad; silently printing 0.00 instead is far worse.
 */
export const NOT_MEASURED = "——";

/** Round to `dp`, then collapse negative zero so no cell ever prints "-0.0". */
function fixed(value: number, dp: number): number {
  const rounded = Number(value.toFixed(dp));
  // -0 === 0 is true in JS, so this comparison catches negative zero and
  // replaces it with the positive one. Without it, an angle that rounds down
  // from -0.04 prints as "-0.0", which looks like a broken sign.
  return rounded === 0 ? 0 : rounded;
}

/** Left-pad an integer with zeroes to a fixed column width. */
function pad(value: number, width: number): string {
  const whole = Math.trunc(value);
  const sign = whole < 0 ? "-" : "";
  return sign + String(Math.abs(whole)).padStart(width, "0");
}

/** RMS marker offset from ground truth, 2dp, with the unit on the value. */
export function formatResidual(mm: number): string {
  if (!Number.isFinite(mm)) return NOT_MEASURED;
  return `${fixed(mm, 2).toFixed(2)} mm`;
}

/**
 * A "live out of declared" count: RAYS 8/8, MARKERS 21/21.
 *
 * Not padded. Both numbers are small, both are always present, and padding
 * them to `08/08` would imply a two-digit scale that does not exist.
 */
export function formatRatio(live: number, total: number): string {
  if (!Number.isFinite(live) || !Number.isFinite(total)) return NOT_MEASURED;
  return `${Math.trunc(live)}/${Math.trunc(total)}`;
}

/**
 * Solve quality, as an integer.
 *
 * Deliberately NOT clamped to 0..100. A solve quality outside that range is a
 * bug in the phase machine, and quietly pinning it to 100 in the readout would
 * hide exactly the kind of fault this strip exists to report.
 */
export function formatSolve(quality: number): string {
  if (!Number.isFinite(quality)) return NOT_MEASURED;
  return String(Math.round(quality));
}

/**
 * Frame number, zero-padded to six digits.
 *
 * The rig derives this from elapsed milliseconds, never from a count of rAF
 * callbacks - a tick count follows the display's refresh rate, so the same
 * moment of the same animation would print a different number on a 60Hz screen
 * than on a 120Hz one, and one of the two would be a lie.
 */
export function formatFrame(frame: number): string {
  if (!Number.isFinite(frame)) return NOT_MEASURED;
  return pad(Math.max(0, frame), 6);
}

/**
 * A joint angle: always signed, 1dp, degrees.
 *
 * The sign is ALWAYS printed, even for a positive angle. That is not decoration
 * - it keeps the field the same number of characters whichever way the joint is
 * pointing, so the figure does not shift by a character width as the arm sweeps
 * through zero.
 *
 * The angle is wrapped into the half-open interval [-180, 180). solveIK2
 * returns a1 as a difference of two atan2 results, which can legitimately land
 * outside a full turn; -287.3 and +72.7 describe the same orientation, and the
 * wrapped form is the one an operator expects to read off an axis. Wrapping is
 * a change of representation, not of fact.
 *
 * The interval is half-open rather than symmetric because a closed one would
 * have two names for the same orientation and the readout would flicker between
 * "-180.0" and "+180.0" as the joint crossed it. Straight back is always
 * "-180.0".
 */
export function formatAngle(degrees: number): string {
  if (!Number.isFinite(degrees)) return NOT_MEASURED;

  // ((x + 180) mod 360) - 180, written so it survives negative inputs: the JS
  // remainder operator keeps the sign of the dividend, so the extra + 360 and
  // second remainder are what make -540 come out as 180 rather than -180.
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  const value = fixed(wrapped, 1);
  const sign = value < 0 ? "-" : "+";
  return `${sign}${Math.abs(value).toFixed(1)}°`;
}

/**
 * Axis load: the normalised derivative of the servo profile, 2dp.
 *
 * It reads exactly 0.00 during a dwell, which is true of a real axis holding
 * position, and it is the reason a dwell does not look like a dropped frame.
 */
export function formatLoad(load: number): string {
  if (!Number.isFinite(load)) return NOT_MEASURED;
  return fixed(load, 2).toFixed(2);
}

/**
 * Which cycle of how many: `03/07`.
 *
 * Both halves are zero-padded to the same width so the slash never moves, and
 * the width is at least two digits because `3/7` in an instrument readout reads
 * as a fraction rather than as a position in a sequence.
 */
export function formatCycle(cycle: number, total: number): string {
  if (!Number.isFinite(cycle) || !Number.isFinite(total)) return NOT_MEASURED;
  const width = Math.max(2, String(Math.abs(Math.trunc(total))).length);
  return `${pad(cycle, width)}/${pad(total, width)}`;
}

/* ==========================================================================
   VALUES
   ========================================================================== */

/** The landing skeleton's readout, as raw quantities. */
export interface SkeletonTelemetryValues {
  /** RMS marker offset from ground truth, in millimetres. */
  residualMm: number;
  /** Camera rays currently contributing to the solve. */
  raysLive: number;
  /** Cameras that exist. Read from topology's CAMERA_COUNT, never a literal. */
  raysTotal: number;
  /** Markers currently solved. */
  markersLive: number;
  /** Markers declared. Read from topology's MARKER_COUNT, never a literal. */
  markersTotal: number;
  /** Solve quality, an integer. */
  solve: number;
  /** Frame number, derived from elapsed milliseconds. */
  frame: number;
}

/**
 * The beat the arm is on. A word, because status must never be carried by
 * colour alone - this is the word channel, the OUTTOL integer is the number
 * channel, and the row rule is the shape channel.
 *
 * IDLE            no verdict exists; nothing has been measured
 * TRAVERSE        carriage moving to a row
 * DESCEND         probe extending to the datum dot
 * DWELL           holding on the datum, zero motion
 * REGISTER        writing the ruling into the row
 * RETRACT         folding off the row
 * PARKED          stopped at the blocking clause, or at the sigma row
 * INDETERMINATE   held for review; the escrow was never touched
 * OUT-OF-ENVELOPE solveIK2 came back clamped and the arm cannot reach
 */
export const ARM_STATES = [
  "IDLE",
  "TRAVERSE",
  "DESCEND",
  "DWELL",
  "REGISTER",
  "RETRACT",
  "PARKED",
  "INDETERMINATE",
  "OUT-OF-ENVELOPE",
] as const;

/**
 * Declared as a runtime array first and the type derived from it, rather than
 * the other way round. The STATE cell's fixed width has to cover the longest
 * state word, and a type alone cannot be measured - a tenth state added as a
 * union member would silently overflow the cell, while one added to this array
 * is caught by the width test.
 */
export type ArmState = (typeof ARM_STATES)[number];

/** The inspection arm's readout, as raw quantities. */
export interface ArmTelemetryValues {
  /** Shoulder angle, degrees, straight off deg(pose.a1). */
  j1Deg: number;
  /** Elbow angle relative to the upper link, degrees, from deg(pose.a2). */
  j2Deg: number;
  /** Normalised servo load, 0..1. */
  load: number;
  /** Which clause is being inspected. 0 before the first one. */
  cycle: number;
  /** How many clauses this matter sealed. */
  cycleTotal: number;
  /** The current beat. */
  state: ArmState;
}

/* ==========================================================================
   CELLS

   `chars` is the cell's FIXED width budget, counted as
   key + one space + the widest value the cell can ever hold. The stylesheet
   turns it into pixels through one constant. Nothing here measures text; a
   readout that re-measured itself would be a readout whose columns move.
   ========================================================================== */

export interface Cell {
  /** Stable identity. Also the address write() uses to find the value node. */
  id: string;
  /** The key, as printed. Uppercase, and never abbreviated past legibility. */
  label: string;
  /** The value, already formatted to its measured precision. */
  value: string;
  /** Fixed width budget, in characters. */
  chars: number;
}

/**
 * Landing strip, in pipeline order with the derived total last.
 *
 * Budgets: RESIDUAL takes "12.34 mm" (8) so a drifting residual in the low
 * tens still fits; RAYS and MARKERS take two digits either side of the slash;
 * SOLVE takes "100"; FRAME takes seven digits, one more than it pads to, so a
 * long-lived page cannot clip its own counter.
 *
 * Exported so the width budgets can be checked by machine rather than by
 * eyeballing the strip in a browser: the test builds the widest value each cell
 * can hold and asserts it fits.
 */
export function skeletonCells(v: SkeletonTelemetryValues): Cell[] {
  return [
    { id: "residual", label: "RESIDUAL", value: formatResidual(v.residualMm), chars: 17 },
    { id: "rays", label: "RAYS", value: formatRatio(v.raysLive, v.raysTotal), chars: 10 },
    { id: "markers", label: "MARKERS", value: formatRatio(v.markersLive, v.markersTotal), chars: 13 },
    { id: "solve", label: "SOLVE", value: formatSolve(v.solve), chars: 9 },
    { id: "frame", label: "FRAME", value: formatFrame(v.frame), chars: 13 },
  ];
}

/**
 * Arm strip, in the order the spec prints it.
 *
 * STATE gets 21 characters because "STATE OUT-OF-ENVELOPE" is the longest
 * string this strip can ever hold, and the one case where clipping would be
 * worst: it is the readout admitting the arm cannot reach, and it has to be
 * readable in full or it is not an admission.
 *
 * Exported for the same reason as skeletonCells.
 */
export function armCells(v: ArmTelemetryValues): Cell[] {
  return [
    { id: "j1", label: "J1", value: formatAngle(v.j1Deg), chars: 10 },
    { id: "j2", label: "J2", value: formatAngle(v.j2Deg), chars: 10 },
    { id: "load", label: "LOAD", value: formatLoad(v.load), chars: 9 },
    { id: "cycle", label: "CYCLE", value: formatCycle(v.cycle, v.cycleTotal), chars: 13 },
    { id: "state", label: "STATE", value: v.state, chars: 21 },
  ];
}

/* ==========================================================================
   THE STRIP
   ========================================================================== */

/** What a rig gets back through `ref`. */
export interface TelemetryHandle<V> {
  /**
   * Write new figures straight into the DOM. Safe to call every frame: it does
   * no React work and skips any cell whose text has not actually changed.
   */
  write(values: V): void;
}

export interface TelemetryProps<V> {
  values: V;
  /** Extra classes for placement. The strip does not position itself. */
  className?: string;
  ref?: Ref<TelemetryHandle<V>>;
}

/**
 * The one renderer. Both public strips are this function with a different cell
 * builder, which is what stops the two readouts drifting apart in spacing,
 * padding or ink as one of them gets edited.
 *
 * `toCells` is always a module-level function, so the imperative handle's
 * dependency is stable and write() never has to be rebuilt.
 */
function useStrip<V>(
  ref: Ref<TelemetryHandle<V>> | undefined,
  toCells: (values: V) => Cell[]
) {
  // id -> the <dd> holding that figure. A Map rather than an array so a cell
  // set that changes shape cannot silently write a residual into a frame count.
  const nodes = useRef<Map<string, HTMLElement>>(new Map());

  useImperativeHandle(
    ref,
    () => ({
      write(values: V) {
        for (const cell of toCells(values)) {
          const node = nodes.current.get(cell.id);
          // The equality check is not a micro-optimisation. Assigning
          // textContent invalidates layout for that node whether or not the
          // string changed, and four of these five cells hold the same text
          // for hundreds of consecutive frames.
          if (node && node.textContent !== cell.value) {
            node.textContent = cell.value;
          }
        }
      },
    }),
    [toCells]
  );

  return nodes;
}

function Strip({
  cells,
  nodes,
  className,
}: {
  cells: Cell[];
  nodes: RefObject<Map<string, HTMLElement>>;
  className?: string;
}) {
  return (
    // A definition list, because that is what this is: keys and their values.
    // A screen reader reads "RESIDUAL, 0.41 mm", which is the whole content -
    // so the strip needs no aria-label and gets none. There is deliberately no
    // aria-live either: these figures change every frame during an animation,
    // and announcing a frame counter sixty times a second would make the page
    // unusable. The terminal figures are in the HTML and can be read at rest,
    // which is when they mean something.
    <dl className={["telemetry", styles.strip, className].filter(Boolean).join(" ")}>
      {cells.map((cell) => (
        <div
          key={cell.id}
          className={styles.cell}
          // The fixed character budget, handed to CSS. Cast because
          // CSSProperties has no index signature for custom properties.
          style={{ "--tele-chars": cell.chars } as CSSProperties}
        >
          <dt>{cell.label}</dt>
          <dd
            ref={(node) => {
              if (node) nodes.current.set(cell.id, node);
              else nodes.current.delete(cell.id);
            }}
          >
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * `RESIDUAL 0.41 mm   RAYS 8/8   MARKERS 21/21   SOLVE 96   FRAME 001482`
 *
 * The landing skeleton's readout. Pass the terminal (LOCKED) figures as
 * `values` so the server emits a solved rig, then drive it from the rAF loop
 * through the ref.
 */
export function SkeletonTelemetry({
  values,
  className,
  ref,
}: TelemetryProps<SkeletonTelemetryValues>) {
  const nodes = useStrip(ref, skeletonCells);
  return <Strip cells={skeletonCells(values)} nodes={nodes} className={className} />;
}

/**
 * `J1 -34.0°   J2 +71.5°   LOAD 0.18   CYCLE 03/07   STATE TRAVERSE`
 *
 * The inspection arm's readout. Same contract: `values` is the server render,
 * the ref is the animation.
 */
export function ArmTelemetry({ values, className, ref }: TelemetryProps<ArmTelemetryValues>) {
  const nodes = useStrip(ref, armCells);
  return <Strip cells={armCells(values)} nodes={nodes} className={className} />;
}
