import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseHex,
  headroom,
  HEADROOM_MARGIN,
  fieldAmplitudeMax,
  worstFieldBackdrop,
  peakEnvelope,
  maxGlowScale,
  type Rgb,
} from "./glow";

/**
 * GLOW HEADROOM, asserted against the real sources.
 *
 * The core of the rig is ADDITIVE light. A contrast failure is loud - the ink
 * disappears into the ground - but a saturation failure is quiet: the core
 * simply stops getting brighter at the top of its breath, and what you see is a
 * pulse that looks slightly wrong rather than a pulse that is broken. Nothing
 * errors. Nothing logs. It reads as a taste problem and gets tuned around.
 *
 * It had already happened twice before this file existed. GLOW_PLATE_SCALE was
 * derived by hand for --accent over --page, and (1) it was never re-derived for
 * the other two states, so HELD - whose plate ink is --warning, with half again
 * the blue and the largest envelope of the three - clipped from the day it was
 * written; (2) it silently stopped holding when the canvas was made transparent
 * and the page field began adding light from behind it.
 *
 * So this file parses the REAL constants out of the REAL sources rather than
 * restating them. A test that carries its own copy of a number cannot fail when
 * that number drifts, which is the only failure that matters here. Every regex
 * below throws rather than returning a default: a rename should break this
 * loudly, never silently reduce it to asserting nothing.
 */

const WEB = process.cwd();
const ORACLE = readFileSync(
  join(WEB, "components", "rig", "Oracle.tsx"),
  "utf8"
);
const FIELD = readFileSync(
  join(WEB, "components", "rig", "ShaderField.tsx"),
  "utf8"
);
const CSS = readFileSync(join(WEB, "app", "globals.css"), "utf8");

/* ==========================================================================
   PARSERS - each one loud on failure
   ========================================================================== */

function num(source: string, label: string, re: RegExp): number {
  const m = re.exec(source);
  if (!m) throw new Error(`could not find ${label}`);
  // pulsePeriodMs is written 5_300; a numeric separator must not become NaN.
  const v = Number(m[1].replace(/_/g, ""));
  if (!Number.isFinite(v)) throw new Error(`${label} is not a number: ${m[1]}`);
  return v;
}

function constant(name: string): number {
  return num(ORACLE, name, new RegExp(`const ${name}\\s*=\\s*([\\d._]+)\\s*;`));
}

/** A :root token's hex. Deliberately NOT read from inside .volume. */
function token(name: string): Rgb {
  const m = new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{6})`, "m").exec(CSS);
  if (!m) throw new Error(`could not find token ${name} in globals.css`);
  return parseHex(m[1]);
}

/** PLATE_INK, read from the component rather than restated here. */
function plateInk(volumeToken: string): string {
  const block = /const PLATE_INK[^{]*\{([\s\S]*?)\n\};/.exec(ORACLE);
  if (!block) throw new Error("could not find the PLATE_INK map");
  const m = new RegExp(`"${volumeToken}":\\s*"(--[a-z-]+)"`).exec(block[1]);
  if (!m) throw new Error(`PLATE_INK has no entry for ${volumeToken}`);
  return m[1];
}

interface State {
  name: string;
  glow: number;
  pulseGlow: number;
  pulsePeriodMs: number;
  core: string | null;
}

/** Every entry of the BEHAVIOUR table, with its glow envelope. */
function behaviours(): State[] {
  const table = /const BEHAVIOUR[^{]*\{([\s\S]*?)\n\};/.exec(ORACLE);
  if (!table) throw new Error("could not find the BEHAVIOUR table");
  const out: State[] = [];
  const entry = /^ {2}([A-Z_]+):\s*\{([\s\S]*?)^ {2}\},/gm;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(table[1])) !== null) {
    const [, name, body] = m;
    const core = /^\s*core:\s*(?:"(--[a-z-]+)"|null)/m.exec(body);
    if (!core) throw new Error(`${name} has no core`);
    out.push({
      name,
      glow: num(body, `${name}.glow`, /^\s*glow:\s*([\d._]+)/m),
      pulseGlow: num(body, `${name}.pulseGlow`, /^\s*pulseGlow:\s*([\d._]+)/m),
      pulsePeriodMs: num(
        body,
        `${name}.pulsePeriodMs`,
        /^\s*pulsePeriodMs:\s*([\d._]+)/m
      ),
      core: core[1] ?? null,
    });
  }
  if (out.length === 0) throw new Error("parsed no behaviours");
  return out;
}

/* ==========================================================================
   THE PARSE ITSELF IS AN ASSERTION
   ========================================================================== */

describe("the sources still say what this file needs them to say", () => {
  it("finds every behaviour, including the ones that draw no glow", () => {
    const names = behaviours().map((b) => b.name);
    expect(names).toEqual(
      expect.arrayContaining(["SETTLED", "REFUNDED", "HELD"])
    );
    // If a state is ever added, it must appear here rather than be skipped.
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  it("finds the scales and the pulse depth", () => {
    expect(constant("GLOW_PLATE_SCALE")).toBeGreaterThan(0);
    expect(constant("GLOW_FIELD_SCALE")).toBeGreaterThan(0);
    expect(constant("IDLE_PULSE_DEPTH")).toBeGreaterThan(0);
  });

  /**
   * Oracle mirrors ShaderField's tuning rather than importing it, so that one
   * rig does not depend on the other's module. That duplication is only safe
   * while something checks it - this is that something.
   */
  it("Oracle's mirrored field tuning still matches ShaderField", () => {
    const tuning = /plate:\s*\{\s*gain:\s*([\d.]+)/.exec(FIELD);
    if (!tuning) throw new Error("could not find VARIANT_TUNING.plate");
    expect(constant("FIELD_GAIN")).toBe(Number(tuning[1]));

    // The weights live in the fragment shader source, which is where they would
    // actually be edited.
    const amp = /\(([\d.]+)\s*\*\s*field\s*\+\s*([\d.]+)\s*\*\s*glow\)/.exec(
      FIELD
    );
    if (!amp) throw new Error("could not find the field amplitude expression");
    expect(constant("FIELD_WEIGHT")).toBe(Number(amp[1]));
    expect(constant("FIELD_GLOW_WEIGHT")).toBe(Number(amp[2]));

    const probe = /glow\s*=\s*([\d.]+)\s*\/\s*\(length\([^)]*\)[^+]*\+\s*([\d.]+)\)/.exec(
      FIELD
    );
    if (!probe) throw new Error("could not find the probe glow expression");
    expect(constant("FIELD_PROBE_NUMERATOR")).toBe(Number(probe[1]));
    expect(constant("FIELD_PROBE_FLOOR")).toBe(Number(probe[2]));
  });

  it("the scan line only ever subtracts, so it cannot raise the ceiling", () => {
    // If this ever becomes `+=`, the field can brighten past what
    // fieldAmplitudeMax accounts for and every ceiling below is understated.
    expect(FIELD).toMatch(/color\s*-=\s*scan\s*\*\s*u_scanDepth/);
  });
});

/* ==========================================================================
   THE RULE ITSELF
   ========================================================================== */

describe("the headroom margin", () => {
  it("is a margin, not a look", () => {
    // Big enough to keep the peak off 1.0; small enough that nobody is tuning
    // brightness with it.
    expect(HEADROOM_MARGIN).toBeGreaterThan(0.9);
    expect(HEADROOM_MARGIN).toBeLessThan(1);
  });
});

describe("headroom", () => {
  it("is set by the channel with the least room, not a fixed one", () => {
    const ink: Rgb = { r: 0.1, g: 0.4, b: 0.5 };
    // Blue has the most ink but green has the least room here.
    expect(headroom(ink, { r: 0, g: 0.9, b: 0.5 })).toBeCloseTo(0.25, 6);
    expect(headroom(ink, { r: 0, g: 0, b: 0.9 })).toBeCloseTo(0.2, 6);
  });

  it("ignores channels the ink cannot reach rather than dividing by zero", () => {
    expect(headroom({ r: 0, g: 0, b: 0.5 }, { r: 1, g: 1, b: 0 })).toBe(2);
    expect(headroom({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 })).toBe(Infinity);
  });

  it("never returns a negative intensity for an already-full ground", () => {
    expect(headroom({ r: 0.5, g: 0.5, b: 0.5 }, { r: 1, g: 1, b: 1 })).toBe(0);
  });
});

describe("peakEnvelope", () => {
  it("compounds the two oscillators, because they share a phase", () => {
    // glowMul and the resting pulse are the same sine, so they peak together.
    expect(peakEnvelope(0.34, 0.5, 5300)).toBeCloseTo(1.34 * 1.5, 10);
  });

  it("is flat for a state that opts out of the oscillator", () => {
    // pulsePeriodMs === 1 is the opt-out; REFUNDED uses it.
    expect(peakEnvelope(0.14, 0.5, 1)).toBe(1);
  });
});

describe("worstFieldBackdrop", () => {
  it("stays on the tint's mix line instead of taking a per-channel maximum", () => {
    const energy: Rgb = { r: 0, g: 1, b: 0 };
    const secondary: Rgb = { r: 0, g: 0, b: 1 };
    const base: Rgb = { r: 0, g: 0, b: 0 };
    const bg = worstFieldBackdrop(
      { r: 0, g: 0.5, b: 0.5 },
      base,
      energy,
      secondary,
      0.5
    );
    // A per-channel max would give g = b = 0.5 at once. One point on the line
    // cannot: the two channels trade off, so they must sum to the amplitude.
    expect(bg.g + bg.b).toBeCloseTo(0.5, 6);
  });
});

/* ==========================================================================
   THE REAL RIG, ON THE REAL BACKDROPS
   ========================================================================== */

/**
 * THE LOAD-BEARING ASSERTION, and the one everything below leans on.
 *
 * Checking that min(tuned, maxGlowScale(...)) does not clip is TAUTOLOGICAL -
 * maxGlowScale is defined not to clip, so a test that applies it and then
 * checks the result proves only that arithmetic works. It would pass in full
 * with the cap deleted from the component entirely.
 *
 * So the component's wiring is asserted directly. This is the join between the
 * model this file computes and the code that actually runs: while it holds, the
 * ceilings below describe the rig; if it is ever removed, this fails first and
 * says so, instead of the suite going quietly green over a rig that clips.
 */
describe("the rig actually applies the cap", () => {
  it("takes the smaller of its tuned scale and the derived ceiling", () => {
    expect(ORACLE).toMatch(/Math\.min\(\s*tunedScale,\s*maxGlowScale\(/);
  });

  it("feeds it the state's own ink and envelope, not a fixed pair", () => {
    const at = ORACLE.indexOf("maxGlowScale(");
    if (at < 0) throw new Error("could not find the maxGlowScale call");
    const call = ORACLE.slice(at, at + 400);
    expect(call).toMatch(/palette\[coreToken\]/);
    expect(call).toMatch(/glowBackdrop\(/);
    expect(call).toMatch(/behaviour\.glow/);
    expect(call).toMatch(/peakEnvelope\(/);
  });

  it("passes the backdrop the placement really has", () => {
    // A flat plate and a field-lit one are different ceilings; collapsing them
    // is exactly the mistake that made GLOW_PLATE_SCALE stop being true.
    const at = ORACLE.indexOf("function glowBackdrop(");
    if (at < 0) throw new Error("could not find glowBackdrop");
    const fn = ORACLE.slice(at, at + 900);
    expect(fn).toMatch(/fieldBacked/);
    expect(fn).toMatch(/worstFieldBackdrop\(/);
  });
});

const PLACEMENTS = [
  { name: "/task/[id] - flat plate", fieldBacked: false, scale: "GLOW_PLATE_SCALE" },
  { name: "landing - over the page field", fieldBacked: true, scale: "GLOW_FIELD_SCALE" },
] as const;

function backdropFor(ink: Rgb, fieldBacked: boolean): Rgb {
  const page = token("--page");
  if (!fieldBacked) return page;
  return worstFieldBackdrop(
    ink,
    page,
    token(plateInk("--marker")),
    token(plateInk("--v-warning")),
    fieldAmplitudeMax(
      constant("FIELD_GAIN"),
      constant("FIELD_WEIGHT"),
      constant("FIELD_GLOW_WEIGHT"),
      constant("FIELD_PROBE_NUMERATOR"),
      constant("FIELD_PROBE_FLOOR")
    )
  );
}

describe("no state's core saturates the plate it is drawn on", () => {
  const states = behaviours().filter((b) => b.core !== null && b.glow > 0);
  const depth = constant("IDLE_PULSE_DEPTH");

  for (const placement of PLACEMENTS) {
    for (const s of states) {
      it(`${s.name} on ${placement.name}`, () => {
        const ink = token(plateInk(s.core as string));
        const backdrop = backdropFor(ink, placement.fieldBacked);
        const envelope = peakEnvelope(s.pulseGlow, depth, s.pulsePeriodMs);

        const capped = Math.min(
          constant(placement.scale),
          maxGlowScale(ink, backdrop, s.glow, envelope)
        );
        const peak = s.glow * capped * envelope;

        // The composite, channel by channel. Nothing may reach 1.0 - and a
        // capped state must sit under it by the margin rather than exactly on
        // it, so the guarantee is not an equality in floating point.
        for (const c of ["r", "g", "b"] as const) {
          expect(backdrop[c] + ink[c] * peak).toBeLessThanOrEqual(1);
        }
        expect(peak).toBeLessThanOrEqual(headroom(ink, backdrop) + 1e-12);
      });
    }
  }
});

/**
 * The assertion that keeps the one above honest.
 *
 * Everything passes trivially if the cap is simply tiny, so this pins the
 * opposite end: the cap must still be BINDING somewhere, and the tuned constant
 * must still be doing its job somewhere else. If both of these stop holding,
 * the rule has quietly become decoration - either the rig is far dimmer than
 * anyone intended, or nothing is being capped and the guard is unreachable.
 */
describe("the cap is load-bearing, not decoration", () => {
  const states = behaviours().filter((b) => b.core !== null && b.glow > 0);
  const depth = constant("IDLE_PULSE_DEPTH");

  it("at least one state would clip on its tuned scale alone", () => {
    const clipping = PLACEMENTS.flatMap((p) =>
      states.filter((s) => {
        const ink = token(plateInk(s.core as string));
        const backdrop = backdropFor(ink, p.fieldBacked);
        const envelope = peakEnvelope(s.pulseGlow, depth, s.pulsePeriodMs);
        const peak = s.glow * constant(p.scale) * envelope;
        return peak > headroom(ink, backdrop);
      }).map((s) => `${s.name} on ${p.name}`)
    );
    // HELD is the one this was written for. If this list ever empties, the
    // tuned constants have been lowered to where the cap can never engage, and
    // the rig is dimmer than it needs to be.
    expect(clipping.length).toBeGreaterThan(0);
  });

  it("at least one state still runs at its tuned scale untouched", () => {
    const untouched = PLACEMENTS.flatMap((p) =>
      states.filter((s) => {
        const ink = token(plateInk(s.core as string));
        const backdrop = backdropFor(ink, p.fieldBacked);
        const envelope = peakEnvelope(s.pulseGlow, depth, s.pulsePeriodMs);
        return (
          maxGlowScale(ink, backdrop, s.glow, envelope) >= constant(p.scale)
        );
      })
    );
    expect(untouched.length).toBeGreaterThan(0);
  });
});

/**
 * The volume is dormant - no screen mounts one - but its ceiling is asserted
 * anyway, for the same reason contrast.test.ts still crosses the volume inks:
 * while these hold, bringing a dark viewport back is a decision rather than a
 * redesign. The near-black ground has room for anything, and that is the point.
 */
describe("the volume ground has headroom to spare", () => {
  const depth = constant("IDLE_PULSE_DEPTH");
  for (const s of behaviours().filter((b) => b.core !== null && b.glow > 0)) {
    it(`${s.name} clears unscaled on --d-ground`, () => {
      const ink = token(s.core as string);
      const backdrop = token("--d-ground");
      const envelope = peakEnvelope(s.pulseGlow, depth, s.pulsePeriodMs);
      // Scale 1: the volume path applies no reduction at all.
      const peak = s.glow * 1 * envelope;
      expect(peak).toBeLessThanOrEqual(headroom(ink, backdrop));
    });
  }
});
