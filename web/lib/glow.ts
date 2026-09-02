/**
 * GLOW HEADROOM.
 *
 * The rig's core is drawn as ADDITIVE light - blendFunc(ONE, ONE) - so how
 * bright it may get is not a property of the rig at all. It is a property of
 * what is behind it. Add enough of any ink to any ground and a channel reaches
 * 1.0, and from that point on the core is clipped: turning the pulse up makes
 * the trough deeper and cannot make the peak brighter, because the peak has
 * nowhere left to go. The breath gets cropped flat at the top.
 *
 * That was previously handled by a tuned constant - GLOW_PLATE_SCALE - derived
 * by hand for ONE state's ink over ONE backdrop. It did not survive contact
 * with either of the other two states, and it stopped being true the moment the
 * canvas went transparent and the page field started contributing light from
 * behind. A number that has to be re-derived every time something else on the
 * page moves is not a guarantee, it is a comment.
 *
 * So the ceiling is computed here instead, from the ink and the ground, and the
 * rig takes the smaller of its tuned preference and what actually fits. The
 * tuned number still chooses the LOOK; this only stops it exceeding physics.
 *
 * Scaling, never clamping. Clamping the intensity at the ceiling would crop the
 * top of the pulse - the exact artefact being avoided. Scaling the whole
 * envelope keeps the swing's ratio intact and simply makes it dimmer.
 */

/** A colour in 0..1 per channel. Not premultiplied; these are plain inks. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** #rrggbb to 0..1 channels. Throws rather than guessing, so a bad token is loud. */
export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${JSON.stringify(hex)}`);
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

const CHANNELS: Array<keyof Rgb> = ["r", "g", "b"];

/**
 * The largest additive intensity of `ink` that saturates no channel of
 * `backdrop`.
 *
 * The composite is backdrop + ink * intensity, per channel, so each channel
 * permits (1 - backdrop) / ink and the binding one is the smallest. Which
 * channel binds is NOT fixed and is the trap this function exists to remove:
 * --accent over --page is limited by GREEN, but once the field contributes its
 * --warning-end tint the ceiling is set by BLUE instead, because --warning's
 * blue is higher than --accent's.
 *
 * A channel with no ink in it can never saturate, so it is skipped rather than
 * dividing by zero. An ink of pure black therefore has unbounded headroom,
 * which is correct: adding nothing to a ground changes nothing.
 */
export function headroom(ink: Rgb, backdrop: Rgb): number {
  let limit = Infinity;
  for (const c of CHANNELS) {
    if (ink[c] <= 0) continue;
    limit = Math.min(limit, (1 - backdrop[c]) / ink[c]);
  }
  // A backdrop already at or over 1.0 in a channel the ink touches leaves
  // nothing at all; never hand back a negative intensity.
  return Math.max(0, limit);
}

/**
 * The field's largest additive contribution to the ground, as a fraction.
 *
 * Mirrors the plate fragment shader:
 *   amp = gain * clamp((0.42 * field + 0.58 * glow) * vign, 0, 1)
 * with field <= 1, vign <= 1, and glow capped by its own denominator at
 * probeNumerator / probeFloor. The scan line only ever SUBTRACTS, so it cannot
 * raise the ground and is not part of a saturation ceiling - it is the term the
 * CONTRAST floor cares about, which is the opposite end of the same range.
 */
export function fieldAmplitudeMax(
  gain: number,
  fieldWeight: number,
  glowWeight: number,
  probeNumerator: number,
  probeFloor: number
): number {
  const glowCap = probeNumerator / probeFloor;
  return gain * Math.min(1, fieldWeight + glowWeight * glowCap);
}

/**
 * The field-lit backdrop that leaves `ink` the least room.
 *
 * The field tints between two inks along one mix parameter, so the backdrop is
 * a single colour on that line - it cannot be its bluest and its greenest at
 * once. Taking a per-channel maximum overstates it, and overstating it by
 * enough changes the answer: it is the difference between a scale that clears
 * and one that does not.
 *
 * So the line is walked and the worst point on it returned, rather than a
 * per-channel bound computed off it.
 */
export function worstFieldBackdrop(
  ink: Rgb,
  base: Rgb,
  energy: Rgb,
  secondary: Rgb,
  amplitudeMax: number,
  steps = 1000
): Rgb {
  let worst: Rgb = base;
  let least = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bg: Rgb = {
      r: base.r + amplitudeMax * (energy.r + (secondary.r - energy.r) * t),
      g: base.g + amplitudeMax * (energy.g + (secondary.g - energy.g) * t),
      b: base.b + amplitudeMax * (energy.b + (secondary.b - energy.b) * t),
    };
    const h = headroom(ink, bg);
    if (h < least) {
      least = h;
      worst = bg;
    }
  }
  return worst;
}

/**
 * The peak of a state's intensity envelope, as a multiple of its base `glow`.
 *
 * Two oscillators compound here and it is easy to count only one. `glowMul` is
 * 1 + pulseGlow * sin(...) from the pose, and the resting pulse is
 * 1 + idleDepth * sin(...) at the draw site - the SAME sine, phased from the
 * same instant, so they peak together rather than averaging out.
 *
 * Both are gated on pulsePeriodMs > 1. A state that opts out of the oscillator
 * has a flat envelope of exactly 1, which is why REFUNDED - whose ink is
 * otherwise unremarkable - has so much more room than HELD.
 */
export function peakEnvelope(
  pulseGlow: number,
  idleDepth: number,
  pulsePeriodMs: number
): number {
  const animates = pulsePeriodMs > 1;
  return (1 + (animates ? pulseGlow : 0)) * (1 + (animates ? idleDepth : 0));
}

/**
 * How much of the available headroom a capped state may actually spend.
 *
 * Spending all of it puts the brightest instant of the breath exactly on 1.0 -
 * not clipped, but exactly at full in one channel, which is the value clipping
 * starts at rather than a value safely below it. Two reasons not to sit there:
 * the peak reads as a flat white point rather than as the top of a curve, and
 * an equality computed in floating point is a poor thing to make a guarantee
 * out of.
 *
 * 2% is enough to be a margin and far too little to be a look.
 */
export const HEADROOM_MARGIN = 0.98;

/**
 * The largest scale a state may use before its peak saturates the backdrop.
 *
 * Infinity when the state draws no glow at all, which is not a special case to
 * guard against: OPEN and SUBMITTED have glow 0 and are never drawn, and a
 * caller taking min() with its tuned preference lands on the preference.
 */
export function maxGlowScale(
  ink: Rgb,
  backdrop: Rgb,
  baseGlow: number,
  envelope: number
): number {
  const denom = baseGlow * envelope;
  if (denom <= 0) return Infinity;
  return (headroom(ink, backdrop) * HEADROOM_MARGIN) / denom;
}
