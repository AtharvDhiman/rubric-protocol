import { describe, it, expect } from "vitest";

import {
  MARKERS,
  MARKER_BY_ID,
  BONES,
  MOBILE_MARKERS,
  MOBILE_MARKER_IDS,
  MOBILE_BONES,
  MOBILE_MERGE,
  resolveMobile,
  DRIFT,
  DRIFT_FREQ_MIN_HZ,
  DRIFT_FREQ_MAX_HZ,
  OCCLUDED_DURING_DRIFT,
  isOccluded,
  isSolvedBone,
  CAMERAS,
  VOLUME_CENTRE,
  GRID_LINES,
  GRID_LINES_PER_AXIS,
  FLOOR_CORNERS,
  projectFloor,
  driftOffset,
  DRIFT_AMPLITUDE_PX,
  MARKER_COUNT,
  BONE_COUNT,
  type MarkerId,
} from "./topology";

/**
 * The shared geometry both rigs draw from.
 *
 * A broken entry here does not throw - it renders. A bone naming a marker that
 * does not exist silently draws from the origin, and a coordinate outside the
 * unit box silently draws off-canvas: in both cases the rig looks subtly wrong
 * and nothing in the console says why. These assertions turn that class of
 * failure into a test result.
 *
 * The determinism tests matter for a different reason. This module feeds both
 * the server render and the client's first frame, so any value derived from
 * Math.random() would differ between them and produce a hydration mismatch on
 * a page whose whole point is that the server already emitted the finished
 * state.
 */

describe("markers", () => {
  it("declares 21 unique markers", () => {
    expect(MARKER_COUNT).toBe(21);
    expect(new Set(MARKERS.map((m) => m.id)).size).toBe(21);
  });

  it("keeps every marker inside the unit box", () => {
    for (const m of MARKERS) {
      expect(m.x, `${m.id}.x`).toBeGreaterThanOrEqual(0);
      expect(m.x, `${m.id}.x`).toBeLessThanOrEqual(1);
      expect(m.y, `${m.id}.y`).toBeGreaterThanOrEqual(0);
      expect(m.y, `${m.id}.y`).toBeLessThanOrEqual(1);
    }
  });

  it("gives every marker a human name for the accessible description", () => {
    for (const m of MARKERS) expect(m.name.length).toBeGreaterThan(2);
  });

  it("indexes every marker", () => {
    expect(MARKER_BY_ID.size).toBe(MARKER_COUNT);
    for (const m of MARKERS) expect(MARKER_BY_ID.get(m.id)).toBe(m);
  });

  it("is anatomically plausible: head above pelvis above ankles", () => {
    // y grows downward. If this ever inverts, the figure is upside down and
    // every leader line in the layout points at the wrong limb.
    const y = (id: MarkerId) => MARKER_BY_ID.get(id)!.y;
    expect(y("HED")).toBeLessThan(y("THX"));
    expect(y("THX")).toBeLessThan(y("PLV"));
    expect(y("PLV")).toBeLessThan(y("L_KN"));
    expect(y("L_KN")).toBeLessThan(y("L_AN"));
    // And left really is left of right, or the balloons annotate the wrong side.
    expect(MARKER_BY_ID.get("L_SH")!.x).toBeLessThan(MARKER_BY_ID.get("R_SH")!.x);
  });
});

describe("bones", () => {
  it("declares 20 bones", () => {
    expect(BONE_COUNT).toBe(20);
  });

  it("only ever references declared markers", () => {
    // The failure this prevents is silent: an unknown id resolves to undefined,
    // the segment draws from 0,0, and the rig grows a stray line to the corner.
    for (const [a, b] of BONES) {
      expect(MARKER_BY_ID.has(a), `bone start ${a}`).toBe(true);
      expect(MARKER_BY_ID.has(b), `bone end ${b}`).toBe(true);
    }
  });

  it("has no duplicate or self-referential bones", () => {
    const seen = new Set<string>();
    for (const [a, b] of BONES) {
      expect(a).not.toBe(b);
      const key = [a, b].sort().join("-");
      expect(seen.has(key), `duplicate bone ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("connects every marker to the skeleton - no orphans", () => {
    const connected = new Set<MarkerId>();
    for (const [a, b] of BONES) {
      connected.add(a);
      connected.add(b);
    }
    const orphans = MARKERS.filter((m) => !connected.has(m.id)).map((m) => m.id);
    expect(orphans).toEqual([]);
  });

  it("forms a single connected figure, not two floating halves", () => {
    const adjacency = new Map<MarkerId, MarkerId[]>();
    for (const [a, b] of BONES) {
      adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
      adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
    }
    const seen = new Set<MarkerId>(["PLV"]);
    const queue: MarkerId[] = ["PLV"];
    while (queue.length) {
      for (const next of adjacency.get(queue.shift()!) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(MARKER_COUNT);
  });
});

describe("the mobile reduction", () => {
  it("drops to 13 markers and 12 bones", () => {
    expect(MOBILE_MARKERS.length).toBe(13);
    expect(MOBILE_BONES.length).toBe(12);
  });

  it("only keeps bones whose BOTH ends survived the merge", () => {
    // The real hazard: merging hands into wrists but leaving the wrist-hand
    // bone behind, which then points at a marker that is no longer drawn.
    for (const [a, b] of MOBILE_BONES) {
      expect(MOBILE_MARKER_IDS.has(a), `mobile bone start ${a}`).toBe(true);
      expect(MOBILE_MARKER_IDS.has(b), `mobile bone end ${b}`).toBe(true);
    }
  });

  it("resolves every merged marker onto one that still exists", () => {
    for (const from of Object.keys(MOBILE_MERGE) as MarkerId[]) {
      const to = resolveMobile(from);
      expect(MOBILE_MARKER_IDS.has(to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("leaves unmerged markers alone", () => {
    expect(resolveMobile("PLV")).toBe("PLV");
    expect(resolveMobile("HED")).toBe("HED");
  });

  it("stays a single connected figure after reduction", () => {
    const adjacency = new Map<MarkerId, MarkerId[]>();
    for (const [a, b] of MOBILE_BONES) {
      adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
      adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
    }
    const seen = new Set<MarkerId>(["PLV"]);
    const queue: MarkerId[] = ["PLV"];
    while (queue.length) {
      for (const next of adjacency.get(queue.shift()!) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(MOBILE_MARKERS.length);
  });
});

describe("drift parameters", () => {
  it("covers every marker", () => {
    expect(DRIFT.length).toBe(MARKER_COUNT);
  });

  it("stays inside the stated frequency band", () => {
    for (const d of DRIFT) {
      expect(d.freqHz).toBeGreaterThanOrEqual(DRIFT_FREQ_MIN_HZ);
      expect(d.freqHz).toBeLessThanOrEqual(DRIFT_FREQ_MAX_HZ);
    }
  });

  it("is deterministic - the server and the client must agree exactly", () => {
    // Not a style point. These values are used by the SSR render and by the
    // client's first frame; if they were random the two would disagree and
    // React would report a hydration mismatch on the hero.
    for (const d of DRIFT) {
      expect(Number.isFinite(d.freqHz)).toBe(true);
      expect(Number.isFinite(d.phaseX)).toBe(true);
      expect(Number.isFinite(d.phaseY)).toBe(true);
    }
    const source = String(projectFloor) + String(resolveMobile);
    expect(source).not.toMatch(/Math\.random/);
  });

  it("gives markers different phases, so they do not pulse in unison", () => {
    const x = new Set(DRIFT.map((d) => d.phaseX.toFixed(6)));
    const y = new Set(DRIFT.map((d) => d.phaseY.toFixed(6)));
    expect(x.size).toBeGreaterThan(MARKER_COUNT * 0.8);
    expect(y.size).toBeGreaterThan(MARKER_COUNT * 0.8);
  });

  it("keeps the x and y phase sequences independent of each other", () => {
    // The subtle trap the module documents: phi^2 = phi + 1, so a phase built
    // from frac(k * phi^2) is EXACTLY the frequency sequence again, and every
    // marker would wobble along a straight diagonal instead of a Lissajous
    // path. Assert the two sequences really are different.
    const diagonal = DRIFT.filter(
      (d) => Math.abs(d.phaseX - d.phaseY) < 1e-9
    ).length;
    expect(diagonal).toBe(0);
  });
});

describe("occlusion", () => {
  it("drops exactly four markers during DRIFT", () => {
    expect(OCCLUDED_DURING_DRIFT.length).toBe(4);
    expect(new Set(OCCLUDED_DURING_DRIFT).size).toBe(4);
  });

  it("only occludes markers that exist", () => {
    for (const id of OCCLUDED_DURING_DRIFT) {
      expect(MARKER_BY_ID.has(id), id).toBe(true);
      expect(isOccluded(id)).toBe(true);
    }
  });

  it("marks a bone as solved when either end is missing", () => {
    // Solid means measured and dashed means inferred, product-wide. A bone with
    // a missing endpoint is inferred by definition.
    const occluded = OCCLUDED_DURING_DRIFT[0];
    const touching = BONES.find((b) => b[0] === occluded || b[1] === occluded);
    expect(touching).toBeDefined();
    expect(isSolvedBone(touching!)).toBe(true);
  });

  it("leaves fully-tracked bones measured", () => {
    const clean = BONES.find((b) => !isOccluded(b[0]) && !isOccluded(b[1]));
    expect(clean).toBeDefined();
    expect(isSolvedBone(clean!)).toBe(false);
  });
});

describe("cameras and floor", () => {
  it("places eight cameras with finite rays", () => {
    expect(CAMERAS.length).toBe(8);
    for (const c of CAMERAS) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.y)).toBe(true);
    }
  });

  it("projects every floor point to a finite coordinate", () => {
    // A NaN here propagates straight into an SVG path and removes the grid
    // with no error reported anywhere.
    for (let u = 0; u <= 1.0001; u += 0.1) {
      for (let v = 0; v <= 1.0001; v += 0.1) {
        const p = projectFloor(u, v);
        expect(Number.isFinite(p.x), `x at ${u},${v}`).toBe(true);
        expect(Number.isFinite(p.y), `y at ${u},${v}`).toBe(true);
      }
    }
  });

  it("emits twelve grid lines with finite endpoints", () => {
    expect(GRID_LINES.length).toBe(12);
    for (const l of GRID_LINES) {
      for (const v of [l.a.x, l.a.y, l.b.x, l.b.y]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("draws six lines along each floor axis", () => {
    expect(GRID_LINES.filter((l) => l.axis === "u").length).toBe(6);
    expect(GRID_LINES.filter((l) => l.axis === "v").length).toBe(6);
    expect(GRID_LINES.length).toBe(GRID_LINES_PER_AXIS * 2);
  });

  it("aims every camera ray at the volume centre", () => {
    // The frusta are the reason the rig reads as instrumented rather than as a
    // decorative border, and that only works if they all point at the subject.
    for (const c of CAMERAS) {
      expect(Math.hypot(c.dx, c.dy), `${c.id} direction is a unit vector`)
        .toBeCloseTo(1, 12);
      const distance = Math.hypot(VOLUME_CENTRE.x - c.x, VOLUME_CENTRE.y - c.y);
      expect(c.x + c.dx * distance).toBeCloseTo(VOLUME_CENTRE.x, 12);
      expect(c.y + c.dy * distance).toBeCloseTo(VOLUME_CENTRE.y, 12);
      // The rotate() angle has to describe the same direction as dx/dy, or the
      // frustum glyph points one way while its ray points another.
      const radians = (c.angleDeg * Math.PI) / 180;
      expect(Math.cos(radians)).toBeCloseTo(c.dx, 12);
      expect(Math.sin(radians)).toBeCloseTo(c.dy, 12);
    }
  });

  it("maps the unit square onto the declared floor corners", () => {
    // Pins the hand-solved homography. If someone edits FLOOR_MATRIX without
    // re-solving it, the grid silently stops being the quad it documents.
    const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const;
    uv.forEach(([u, v], i) => {
      const p = projectFloor(u, v);
      expect(p.x).toBeCloseTo(FLOOR_CORNERS[i].x, 10);
      expect(p.y).toBeCloseTo(FLOOR_CORNERS[i].y, 10);
    });
  });

  it("recedes, so the plane reads as a floor and not as a rectangle", () => {
    let previousWidth = Infinity;
    let previousY = Infinity;
    for (let i = GRID_LINES_PER_AXIS - 1; i >= 0; i--) {
      const v = i / (GRID_LINES_PER_AXIS - 1);
      const left = projectFloor(0, v);
      const width = projectFloor(1, v).x - left.x;
      expect(width).toBeGreaterThan(0);
      // Further back means narrower, and the rungs bunch up.
      expect(width).toBeLessThan(previousWidth);
      expect(left.y).toBeLessThan(previousY);
      previousWidth = width;
      previousY = left.y;
    }
  });
});

describe("drift offsets", () => {
  it("never exceeds the stated amplitude", () => {
    // The spec says +/-1.5px. A marker that wandered further would collide with
    // its neighbour, and at 2.5px discs that reads as a tracking failure rather
    // than as noise.
    for (const d of DRIFT) {
      for (let ms = 0; ms <= 4000; ms += 17) {
        const { dx, dy } = driftOffset(d, ms);
        expect(Math.abs(dx)).toBeLessThanOrEqual(DRIFT_AMPLITUDE_PX + 1e-12);
        expect(Math.abs(dy)).toBeLessThanOrEqual(DRIFT_AMPLITUDE_PX + 1e-12);
      }
    }
  });

  it("is a pure function of elapsed milliseconds", () => {
    // The same instant must produce the same picture on the server, on the
    // client's first frame after the rewind, and on a 60Hz or a 120Hz display.
    // Deriving anything here from a frame counter would break all three.
    const marker = DRIFT[0];
    for (const ms of [0, 137, 999, 2500]) {
      expect(driftOffset(marker, ms)).toEqual(driftOffset(marker, ms));
    }
  });

  it("does not put every marker at the same place at t=0", () => {
    const at0 = DRIFT.map((d) => {
      const { dx, dy } = driftOffset(d, 0);
      return `${dx.toFixed(6)},${dy.toFixed(6)}`;
    });
    expect(new Set(at0).size).toBe(DRIFT.length);
  });
});
