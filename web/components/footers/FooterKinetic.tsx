"use client";

import Link from "next/link";
import { useEffect, useRef, type CSSProperties } from "react";

import { SolanaMark } from "@/components/SolanaMark";
import { PROTOCOL_NAME, TAGLINE } from "@/lib/constants";
import { RAMP_MS } from "@/lib/rig";

/**
 * THE KINETIC WORDMARK - the name as a specimen under a probe.
 *
 * ONE MECHANIC, AND IT IS A MEASUREMENT
 * -------------------------------------
 * The name is clamped in a fixture and divided into equal STATIONS, one per
 * letter, graduated along a datum rule. A pointer entering the fixture is a
 * probe carriage: it runs on a rail, it has mass, and the letter it is standing
 * over opens along Archivo's real `wdth` axis while its neighbours fall away.
 * The telemetry beside the fixture prints the station under the probe and the
 * exact axis value applied to that letter.
 *
 * That last sentence is the reason this is allowed to exist on this product.
 * The readout is not garnish and it is not invented: `WDTH 118.4` is literally
 * the number written into `font-variation-settings` on that glyph this frame,
 * inspectable in devtools. There is no fabricated feed rate, no serial number,
 * no counter. The rig's only claim is a fact about itself.
 *
 * WHY EQUAL STATIONS, AND WHY IT IS NOT A COMPROMISE
 * -------------------------------------------------
 * Each letter sits in its own flex cell of exactly 1/N of the fixture, and the
 * glyph is centred inside it. So the widening happens INSIDE a fixed box: the
 * word's footprint, the datum graduations and the neighbouring letters never
 * move by a single pixel, however far the axis travels. A wordmark whose right
 * edge oscillates as the cursor crosses it reads as rubber; this one reads as a
 * part held in a fixture, which is the whole point. The equal cells are not
 * loose tracking - they are the graduations of the scale, and the integers
 * under them are join keys: remove the drawing and `STATION 4 R` stops meaning
 * anything.
 *
 * WHAT MAKES IT SAFE TO SHIP
 * --------------------------
 * 1. THE SERVER RENDERS THE FINISHED WORD. Rest is a complete, legible setting
 *    of the name in the markup - not a build-up toward one. Nothing here is
 *    revealed by motion.
 * 2. FINE POINTERS ONLY. A coarse pointer cannot hover, so a touch device gets
 *    the resting word and NO LISTENER IS EVER ATTACHED. Same for reduced
 *    motion: `sync()` runs before anything is bound, so no rAF is scheduled -
 *    not scheduled and cancelled, never scheduled.
 * 3. NO LAYOUT THRASH. The loop writes `font-variation-settings` and
 *    `transform`, and nothing else. Layout reads (`getBoundingClientRect`)
 *    happen in the pointer handler and are cached until a scroll or resize
 *    invalidates them, so a read and a write never interleave inside a frame.
 * 4. THE LOOP NEVER CALLS setState. React renders this component when its props
 *    change and at no other time. It also stops: the moment both axes are
 *    settled the frame is not requeued, and a stationary pointer costs nothing.
 * 5. NO HEX LITERAL FOR A DESIGN COLOUR. Every ink is a token by name.
 * 6. THE ACCESSIBLE NAME IS ONE NODE. The per-letter spans are `aria-hidden`
 *    and a single "Rubric" text node carries the name, so a screen reader reads
 *    a word rather than six letters. The telemetry has NO `aria-live` - a live
 *    region on a value that changes with every pointer move is a WCAG 2.2.2
 *    problem, not an enhancement - and nothing it says is knowable only there.
 *
 * THE EASING
 * ----------
 * `advance()` is the same physics as `lib/rig.ts`, expressed as a tracker
 * rather than as a fixed move. Acceleration is bounded by `RAMP_MS`, imported
 * from the rig so the two cannot drift, and the deceleration law
 * `v = sqrt(2*a*e)` is what a motion controller actually runs. Overshoot is
 * structurally zero: a springy settle is what an uncalibrated axis does.
 */

/* ==========================================================================
   THE SPECIMEN
   ========================================================================== */

/** Six stations, one per letter. Taken from the constant, never retyped. */
const LETTERS = PROTOCOL_NAME.toUpperCase().split("");
const N = LETTERS.length;

/**
 * The travel of the width axis, in axis units.
 *
 * 87.5 is the rest setting used by `.label` and `.telemetry` product-wide, so
 * the unprobed word sits at the same width as every mono label around it. 125
 * is Archivo's expanded end. If a browser fails to load the variable axis, both
 * ends resolve to normal width and the wordmark simply does not move - nothing
 * in the layout depends on it.
 */
const WDTH_REST = 87.5;
const WDTH_PEAK = 125;
const WGHT_REST = 500;
const WGHT_PEAK = 760;

/**
 * The probe's measurement footprint, in stations.
 *
 * A gaussian at sigma 0.85 puts the letter one station away at 0.50 of full
 * travel and two stations away at 0.06 - a visible shoulder, then nothing. A
 * wider footprint turns the word into a wave, which is a toy.
 */
const SIGMA = 0.85;

/* Velocity limits, and the acceleration that follows from RAMP_MS. The ramp is
   a property of the motor, not of the move: it lasts the same milliseconds
   whether the probe is crossing one station or all six. */
const POS_VMAX = 16; /* stations per second  */
const ENG_VMAX = 6; /* engagement per second */
const POS_AMAX = POS_VMAX / (RAMP_MS / 1000);
const ENG_AMAX = ENG_VMAX / (RAMP_MS / 1000);

/** Below this the letter is at rest and the inline override is removed. */
const EPSILON = 0.002;

/** One tracked axis: position and velocity. */
interface Axis {
  x: number;
  v: number;
}

/**
 * A bounded-acceleration follower with zero overshoot.
 *
 * The desired velocity is the largest one from which the axis can still stop
 * exactly on the target under its own acceleration limit - that is the
 * `sqrt(2*a*e)` term - capped by the velocity limit. The actual velocity then
 * slews toward it at no more than `amax * dt`, which is the trapezoid: ramp,
 * cruise, ramp. When the integration step would carry the axis past the target
 * it is pinned there and the velocity zeroed, so the axis cannot ring.
 */
function advance(
  axis: Axis,
  target: number,
  dt: number,
  vmax: number,
  amax: number
): void {
  const err = target - axis.x;
  if (err === 0 && axis.v === 0) return;

  const dir = Math.sign(err);
  const vDesired = dir * Math.min(vmax, Math.sqrt(2 * amax * Math.abs(err)));
  const dv = vDesired - axis.v;
  const step = amax * dt;
  axis.v += Math.abs(dv) <= step ? dv : Math.sign(dv) * step;

  const next = axis.x + axis.v * dt;
  if ((target - next) * dir <= 0) {
    axis.x = target;
    axis.v = 0;
  } else {
    axis.x = next;
  }
}

/** What the telemetry prints when no probe is engaged. Never a guessed value. */
const STATION_IDLE = "— —";

/* ==========================================================================
   COMPONENT
   ========================================================================== */

export function FooterKinetic() {
  const wellRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const carriageRef = useRef<HTMLSpanElement | null>(null);
  const glyphRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const tickRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const stationRef = useRef<HTMLSpanElement | null>(null);
  const wdthRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const well = wellRef.current;
    const track = trackRef.current;
    if (!well || !track) return;

    /* Both gates are evaluated BEFORE anything is bound or queued. */
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(pointer: fine)");

    const pos: Axis = { x: (N - 1) / 2, v: 0 };
    const eng: Axis = { x: 0, v: 0 };
    let targetPos = pos.x;
    let targetEng = 0;

    let raf = 0;
    let last = 0;
    let attached = false;

    /* Cached geometry. Invalidated by scroll and resize, re-read at most once
       per pointer event, never inside the write phase of a frame. */
    let rect: DOMRect | null = null;
    let trackWidth = 0;

    /* Last painted values, so a frame that changes nothing writes nothing. */
    let lastStation = "";
    let lastWdth = "";
    let lastTick = -1;

    const paint = (): void => {
      const p = pos.x;
      const e = eng.x;
      let maxWidth = WDTH_REST;

      for (let i = 0; i < N; i += 1) {
        const glyph = glyphRefs.current[i];
        if (!glyph) continue;

        const d = (i - p) / SIGMA;
        const response = e * Math.exp(-0.5 * d * d);

        if (response < EPSILON) {
          /* Hand the letter back to the stylesheet rather than pinning it to a
             hard-coded rest string - one definition of rest, in the CSS. */
          if (glyph.style.fontVariationSettings) {
            glyph.style.removeProperty("font-variation-settings");
          }
          continue;
        }

        const wdth = WDTH_REST + (WDTH_PEAK - WDTH_REST) * response;
        const wght = Math.round(WGHT_REST + (WGHT_PEAK - WGHT_REST) * response);
        if (wdth > maxWidth) maxWidth = wdth;
        glyph.style.fontVariationSettings = `"wdth" ${wdth.toFixed(
          1
        )}, "wght" ${wght}`;
      }

      /* The carriage. translateX for the rail position, scaleY from the datum
         for how far the probe is extended - never opacity, because the rail is
         a meaning-bearing line: it says WHERE the measurement is being taken. */
      const carriage = carriageRef.current;
      if (carriage) {
        const x = ((p + 0.5) / N) * trackWidth;
        carriage.style.transform = `translateX(${x.toFixed(
          2
        )}px) scaleY(${e.toFixed(4)})`;
      }

      const engaged = e > 0.5;
      const near = Math.min(N - 1, Math.max(0, Math.round(p)));

      const station = engaged
        ? `${near + 1} ${LETTERS[near]}`
        : STATION_IDLE;
      if (station !== lastStation) {
        lastStation = station;
        if (stationRef.current) stationRef.current.textContent = station;
      }

      const wdthText = maxWidth.toFixed(1);
      if (wdthText !== lastWdth) {
        lastWdth = wdthText;
        if (wdthRef.current) wdthRef.current.textContent = wdthText;
      }

      const tick = engaged ? near : -1;
      if (tick !== lastTick) {
        if (lastTick >= 0) {
          tickRefs.current[lastTick]?.classList.remove("is-probed");
        }
        if (tick >= 0) tickRefs.current[tick]?.classList.add("is-probed");
        lastTick = tick;
      }
    };

    const frame = (now: number): void => {
      /* dt from the clock, clamped. A backgrounded tab hands back a gap of
         seconds, and integrating that would teleport both axes. */
      const dt = last === 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
      last = now;

      advance(pos, targetPos, dt, POS_VMAX, POS_AMAX);
      advance(eng, targetEng, dt, ENG_VMAX, ENG_AMAX);
      paint();

      const settled =
        pos.x === targetPos && pos.v === 0 && eng.x === targetEng && eng.v === 0;
      if (settled) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const wake = (): void => {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    const fraction = (clientX: number): number => {
      if (!rect) {
        rect = track.getBoundingClientRect();
        trackWidth = rect.width;
      }
      if (rect.width === 0) return 0.5;
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    };

    const onEnter = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return;
      /* Re-measure on entry, then SNAP the carriage to where the probe arrived.
         Sweeping in from wherever it was last parked would be a move the
         operator did not command. */
      rect = track.getBoundingClientRect();
      trackWidth = rect.width;
      pos.x = fraction(event.clientX) * N - 0.5;
      pos.v = 0;
      targetPos = pos.x;
      targetEng = 1;
      wake();
    };

    const onMove = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return;
      targetPos = fraction(event.clientX) * N - 0.5;
      targetEng = 1;
      wake();
    };

    const onLeave = (): void => {
      targetEng = 0;
      wake();
    };

    const invalidate = (): void => {
      rect = null;
    };

    const attach = (): void => {
      if (attached) return;
      attached = true;
      well.addEventListener("pointerenter", onEnter);
      well.addEventListener("pointermove", onMove);
      well.addEventListener("pointerleave", onLeave);
      well.addEventListener("pointercancel", onLeave);
      window.addEventListener("scroll", invalidate, { passive: true });
      window.addEventListener("resize", invalidate);
    };

    const detach = (): void => {
      if (!attached) return;
      attached = false;
      well.removeEventListener("pointerenter", onEnter);
      well.removeEventListener("pointermove", onMove);
      well.removeEventListener("pointerleave", onLeave);
      well.removeEventListener("pointercancel", onLeave);
      window.removeEventListener("scroll", invalidate);
      window.removeEventListener("resize", invalidate);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      /* Park the fixture: everything back to the state the server rendered. */
      eng.x = 0;
      eng.v = 0;
      targetEng = 0;
      pos.v = 0;
      rect = null;
      paint();
    };

    /* The gate. If it says no, `detach` returns immediately because nothing was
       ever attached - so the resting markup stands untouched and no frame is
       ever requested. */
    const sync = (): void => {
      if (fine.matches && !reduce.matches) attach();
      else detach();
    };

    sync();
    reduce.addEventListener("change", sync);
    fine.addEventListener("change", sync);

    return () => {
      reduce.removeEventListener("change", sync);
      fine.removeEventListener("change", sync);
      detach();
    };
  }, []);

  return (
    <footer className="kf">
      <style>{KINETIC_CSS}</style>

      <div className="kf-inner">
        <div className="kf-head">
          <p className="kf-eyebrow label">
            {PROTOCOL_NAME.toUpperCase()} PROTOCOL &middot; WORDMARK, WIDTH AXIS
          </p>

          {/* Telemetry. aria-hidden and deliberately NOT a live region: it
              changes with every pointer move, and nothing it says is available
              only here - the prose below states the mechanic in full. */}
          <div className="kf-readout" aria-hidden="true">
            <span className="telemetry">
              STATION{" "}
              <span className="kf-val" ref={stationRef}>
                {STATION_IDLE}
              </span>
            </span>
            <span className="telemetry">
              WDTH{" "}
              <span className="kf-val" ref={wdthRef}>
                {WDTH_REST.toFixed(1)}
              </span>
            </span>
            <span className="telemetry kf-range">
              AXIS {WDTH_REST.toFixed(1)}&ndash;{WDTH_PEAK.toFixed(1)}
            </span>
          </div>
        </div>

        {/* THE FIXTURE. --sunk is a well cut into the sheet, which is what a
            specimen sits in. Deliberately NOT --raised: that ink means
            "committed on-chain" everywhere else in this product, and a
            wordmark is not on the chain. */}
        <div className="kf-well" ref={wellRef}>
          <div className="kf-track" ref={trackRef}>
            <span
              className="kf-carriage"
              aria-hidden="true"
              ref={carriageRef}
              style={{ transform: "translateX(0px) scaleY(0)" }}
            />

            <p
              className="kf-word"
              style={{ "--kf-n": N } as CSSProperties}
            >
              <span aria-hidden="true" className="kf-letters">
                {LETTERS.map((letter, i) => (
                  <span className="kf-cell" key={`${letter}-${i}`}>
                    <span
                      className="kf-glyph"
                      ref={(el) => {
                        glyphRefs.current[i] = el;
                      }}
                    >
                      {letter}
                    </span>
                  </span>
                ))}
              </span>
              {/* The accessible name: one node, one word. */}
              <span className="kf-sr">{PROTOCOL_NAME}</span>
            </p>
          </div>

          {/* The datum rule and its graduations. The integers are join keys
              with the STATION readout above, not decorative numbering. */}
          <div
            className="kf-scale"
            aria-hidden="true"
            style={{ "--kf-n": N } as CSSProperties}
          >
            {LETTERS.map((letter, i) => (
              <span
                className="kf-tick"
                key={`tick-${letter}-${i}`}
                ref={(el) => {
                  tickRefs.current[i] = el;
                }}
              >
                <span className="kf-idx">{i + 1}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="kf-foot">
          <div className="kf-copy">
            <p className="kf-prose">
              {PROTOCOL_NAME} seals a task&rsquo;s acceptance criteria on-chain
              before any work begins. An AI judge reads only those sealed
              clauses, and Solana releases the escrow the moment every one of
              them passes.
            </p>
            <p className="kf-note">
              Move a pointer across the name and the letter beneath it opens
              along Archivo&rsquo;s width axis. The figure above is the exact
              setting applied to that letter, not a description of one.
            </p>
          </div>

          <nav className="kf-nav" aria-label={`${PROTOCOL_NAME} footer`}>
            <Link href="/docket">Docket</Link>
            <Link href="/create">New task</Link>
            <Link href="/my-work">My work</Link>
          </nav>
        </div>

        <div className="kf-base">
          <span className="kf-sol">
            <SolanaMark size={14} />
            <span className="label">BUILT ON SOLANA &middot; USDC ESCROW</span>
          </span>
          <p className="kf-tag">{TAGLINE}</p>
        </div>
      </div>
    </footer>
  );
}

export default FooterKinetic;

/* ==========================================================================
   STYLES

   Every rule is scoped under .kf, injected from inside the component, and
   reads its colours from the design tokens by name. No volume ink appears
   here: this footer is on the light plate and never inside a .volume.

   CONTRAST, measured, every text/background pair used below:

     on --surface #edefec (the footer band)
       --text        15.99:1   --text-2       11.41:1
       --text-muted   7.35:1   --text-faint    5.89:1
       --accent       6.41:1   --hairline (rule, graphic) 3.76:1

     on --sunk #dde1de (the fixture)
       --text (wordmark, large + the carriage rail, graphic)  14.00:1
       --text (probed index)                                  14.00:1
       --text-faint (idle indices, 10px)                       5.16:1
       --hairline (datum rule and ticks, graphic)              3.29:1
       --border (fixture edge, graphic)                       14.00:1

   Body text floor 4.5:1 and graphic floor 3:1 are cleared by every pair.
   ========================================================================== */

const KINETIC_CSS = `
.kf {
  background: var(--surface);
  border-top: 1px solid var(--border);
  color: var(--text);
}

.kf-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 28px 32px 24px;
}

@media (max-width: 700px) {
  .kf-inner { padding: 22px 16px 20px; }
}

/* ---- the head row: what the instrument is, and what it is reading -------- */

.kf-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 24px;
  flex-wrap: wrap;
  margin: 0 0 14px;
}

.kf-eyebrow { margin: 0; color: var(--text-muted); }

.kf-readout {
  display: flex;
  align-items: baseline;
  gap: 6px 20px;
  flex-wrap: wrap;
}

.kf-readout .telemetry { color: var(--text-muted); }

/* The one accent in this footer besides the links. --accent marks identity and
   live readouts, which is exactly what this is. 6.41:1 on --surface. */
.kf-val {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.kf-range { color: var(--text-faint); }

/* ---- the fixture -------------------------------------------------------- */

.kf-well {
  background: var(--sunk);
  border: 1px solid var(--border);
  padding: 28px 16px 10px;
}

@media (max-width: 700px) {
  .kf-well { padding: 22px 10px 8px; }
}

.kf-track { position: relative; }

/* The rail. 1px, --text, scaled from the datum - it extends up past the cap
   height so a segment of it is always clear of the letters it crosses. */
.kf-carriage {
  position: absolute;
  left: 0;
  top: -22px;
  bottom: 0;
  width: 1px;
  background: var(--text);
  transform-origin: 50% 100%;
  pointer-events: none;
  will-change: transform;
  z-index: 1;
}

/* The specimen row is its own query container, so a station is exactly
   100cqw / N wide and the type is sized from the fixture rather than from the
   viewport. clamp() caps both ends in px, because a raw viewport or container
   unit ignores the root font size and breaks user zoom. */
.kf-word {
  container-type: inline-size;
  position: relative;
  display: flex;
  width: 100%;
  margin: 0;
  padding: 0;
  line-height: 0.8;
}

.kf-letters {
  display: flex;
  width: 100%;
}

/* Equal stations. flex: 1 1 0 with min-width: 0 means the cell width is a
   function of the fixture and NOT of its glyph, which is what stops the axis
   travel from reflowing the word.

   The 97 is measured, not guessed. Archivo's widest cap here is U at
   0.963em when the axis is fully open (wdth 125, wght 760), and a station is
   100/97 = 1.031em wide, so a fully probed letter fills 93% of its cell and
   still cannot touch its neighbour: with the probe parked exactly between two
   stations both letters sit at 0.912em, which leaves 0.12em of air. */
.kf-cell {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  font-family: var(--font-sans);
  font-size: clamp(38px, calc(97cqw / var(--kf-n, 6)), 190px);
  letter-spacing: 0;
  color: var(--text);
}

/* Rest. The single definition of the resting setting - the loop removes its
   inline override rather than writing these numbers back, so the two cannot
   disagree. */
.kf-glyph {
  display: block;
  font-variation-settings: "wdth" ${WDTH_REST}, "wght" ${WGHT_REST};
}

/* ---- the datum and its graduations -------------------------------------- */

.kf-scale {
  display: flex;
  width: 100%;
  margin-top: 10px;
  border-top: 1px solid var(--hairline);
}

.kf-tick {
  flex: 1 1 0;
  min-width: 0;
  position: relative;
  display: flex;
  justify-content: center;
  padding-top: 9px;
}

.kf-tick::before {
  content: "";
  position: absolute;
  top: 0;
  left: 50%;
  width: 1px;
  height: 5px;
  background: var(--hairline);
  transform: translateX(-50%);
}

/* The probed station. Weight and length, not colour - the graduation is a
   graphic and colour is not spent on "a thing is fine". */
.kf-tick.is-probed::before {
  width: 2px;
  height: 8px;
  background: var(--text);
}

.kf-idx {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.1em;
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
}

.kf-tick.is-probed .kf-idx { color: var(--text); }

/* ---- prose, links, base ------------------------------------------------- */

.kf-foot {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px 40px;
  flex-wrap: wrap;
  margin-top: 22px;
}

.kf-copy { max-width: 58ch; }

.kf-prose {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-2);
}

.kf-note {
  margin: 10px 0 0;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
}

.kf-nav {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.kf-nav a {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variation-settings: "wdth" 87.5;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}

.kf-nav a:hover { color: var(--accent-strong); }

.kf-base {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 24px;
  flex-wrap: wrap;
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px solid var(--hairline);
}

.kf-sol {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.kf-sol .label { color: var(--text-muted); }

.kf-tag {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-muted);
}

/* The accessible name, present in the tree and absent from the plate. */
.kf-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* Touch targets, gated on pointer type rather than on width: an iPad in
   portrait reports 768px and is a pure touch device. The prose carries no
   links, so the WCAG 2.5.8 in-prose exemption is not being leaned on here. */
@media (max-width: 760px), (pointer: coarse) {
  .kf-nav { gap: 0; }
  .kf-nav a {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
}
`;
