/**
 * Shared geometry for the capture volume.
 *
 * Everything the landing skeleton draws lives here as data: the 21-marker
 * chain, the 20 bones between them, the reduced mobile subset, the eight
 * perimeter cameras, and the floor grid with the fixed perspective that puts it
 * on the ground. The rig components own timing and colour; this module owns
 * shape, and it is deliberately free of React, the DOM and any time source.
 *
 * Two properties matter more than anything else here, and both are structural
 * rather than a matter of review discipline:
 *
 * 1. EVERY NUMBER IS DETERMINISTIC. There is no Math.random anywhere in this
 *    file, including in the drift jitter. The server renders the terminal frame
 *    into the HTML and the client rewinds it after mount, so the server and the
 *    client first frame have to agree exactly. A random phase would put a
 *    different number in the markup than in the first client frame, which React
 *    reports as a hydration mismatch and a reader sees as a flicker.
 *
 * 2. COORDINATES ARE NORMALISED, NOT PIXELS. Markers and cameras live in a 0..1
 *    box and the floor grid projects into the same box. The renderer maps that
 *    box onto whatever the panel happens to measure, so a resize is a change of
 *    one mapping and never a change of the topology.
 *
 * Y INCREASES DOWNWARD, as it does in SVG. The head is at a small y and the
 * toes at a large one. This is stated once, here, so no consumer has to guess.
 */

/* ==========================================================================
   MARKERS
   ========================================================================== */

/**
 * The marker set, as a union so that a typo in a bone endpoint is a compile
 * error rather than a line that silently fails to draw. The runtime test
 * asserts the same thing, because the same lists are also read by tooling that
 * does not go through the type checker.
 */
export type MarkerId =
  // Spine chain, pelvis up to head.
  | "PLV"
  | "SPN"
  | "THX"
  | "NCK"
  | "HED"
  // Left arm, shoulder out to hand.
  | "L_SH"
  | "L_EL"
  | "L_WR"
  | "L_HN"
  // Right arm.
  | "R_SH"
  | "R_EL"
  | "R_WR"
  | "R_HN"
  // Left leg, hip down to toe.
  | "L_HP"
  | "L_KN"
  | "L_AN"
  | "L_TO"
  // Right leg.
  | "R_HP"
  | "R_KN"
  | "R_AN"
  | "R_TO";

export interface Marker {
  id: MarkerId;
  /** Ground truth x in the 0..1 volume box. */
  x: number;
  /** Ground truth y in the 0..1 volume box, increasing DOWNWARD. */
  y: number;
  /** Plain English, for building an accessible description of the pose. */
  name: string;
}

/**
 * Ground truth: where each marker sits when the solve has LOCKED.
 *
 * Declared in chain order - spine, left arm, right arm, left leg, right leg -
 * because CALIBRATE lands the markers one at a time in exactly this order and
 * the stagger is computed from the array index. Reordering this array reorders
 * the animation, which is the intended coupling: the drawing sequence is the
 * data sequence, not a second list that can drift away from it.
 *
 * The figure is not perfectly bilaterally symmetric. A mirror-exact pose reads
 * as a pictogram; a real capture subject stands with a little asymmetry, and
 * the sub-percent offsets below are what stop the rig looking like clip art.
 *
 * The pose is inset from the box edge (x 0.300..0.700, y 0.100..0.920) so the
 * perimeter cameras have somewhere to sit without overlapping the subject.
 */
export const MARKERS: readonly Marker[] = [
  { id: "PLV", x: 0.498, y: 0.463, name: "pelvis" },
  { id: "SPN", x: 0.499, y: 0.354, name: "mid spine" },
  { id: "THX", x: 0.5, y: 0.243, name: "thorax" },
  { id: "NCK", x: 0.5, y: 0.178, name: "neck" },
  { id: "HED", x: 0.5, y: 0.1, name: "head" },

  { id: "L_SH", x: 0.42, y: 0.253, name: "left shoulder" },
  { id: "L_EL", x: 0.366, y: 0.375, name: "left elbow" },
  { id: "L_WR", x: 0.319, y: 0.495, name: "left wrist" },
  { id: "L_HN", x: 0.3, y: 0.543, name: "left hand" },

  { id: "R_SH", x: 0.58, y: 0.25, name: "right shoulder" },
  { id: "R_EL", x: 0.634, y: 0.368, name: "right elbow" },
  { id: "R_WR", x: 0.681, y: 0.483, name: "right wrist" },
  { id: "R_HN", x: 0.7, y: 0.529, name: "right hand" },

  { id: "L_HP", x: 0.446, y: 0.472, name: "left hip" },
  { id: "L_KN", x: 0.436, y: 0.672, name: "left knee" },
  { id: "L_AN", x: 0.427, y: 0.868, name: "left ankle" },
  { id: "L_TO", x: 0.415, y: 0.92, name: "left toe" },

  { id: "R_HP", x: 0.55, y: 0.469, name: "right hip" },
  { id: "R_KN", x: 0.559, y: 0.666, name: "right knee" },
  { id: "R_AN", x: 0.568, y: 0.862, name: "right ankle" },
  { id: "R_TO", x: 0.58, y: 0.914, name: "right toe" },
];

/** Index by id. Built once; the rAF loop must never scan an array per frame. */
export const MARKER_BY_ID: ReadonlyMap<MarkerId, Marker> = new Map(
  MARKERS.map((m) => [m.id, m])
);

/**
 * Where a marker sits in chain order. CALIBRATE staggers by 40ms per index, so
 * this is the multiplier for a marker start time.
 */
export const MARKER_ORDER: ReadonlyMap<MarkerId, number> = new Map(
  MARKERS.map((m, i) => [m.id, i])
);

/* ==========================================================================
   BONES
   ========================================================================== */

/** A segment between two markers. Order is draw order, not significance. */
export type Bone = readonly [MarkerId, MarkerId];

/**
 * The 20 segments. This is a TREE over the 21 markers - 21 nodes, 20 edges, no
 * cycles - which is what makes "every bone touching a dropped marker goes
 * dashed" a well-defined rule instead of an argument about which path wins.
 */
export const BONES: readonly Bone[] = [
  ["PLV", "SPN"],
  ["SPN", "THX"],
  ["THX", "NCK"],
  ["NCK", "HED"],

  ["THX", "L_SH"],
  ["L_SH", "L_EL"],
  ["L_EL", "L_WR"],
  ["L_WR", "L_HN"],

  ["THX", "R_SH"],
  ["R_SH", "R_EL"],
  ["R_EL", "R_WR"],
  ["R_WR", "R_HN"],

  ["PLV", "L_HP"],
  ["L_HP", "L_KN"],
  ["L_KN", "L_AN"],
  ["L_AN", "L_TO"],

  ["PLV", "R_HP"],
  ["R_HP", "R_KN"],
  ["R_KN", "R_AN"],
  ["R_AN", "R_TO"],
];

/** A stable key for a bone, for React lists and for dedupe. */
export const boneKey = (bone: Bone): string => `${bone[0]}-${bone[1]}`;

/* ==========================================================================
   THE MOBILE REDUCTION
   ========================================================================== */

/**
 * At 375px the panel is roughly 343px wide, a 2.5px marker disc is 5px across,
 * and the closely spaced markers - hand beside wrist, toe beside ankle, the two
 * hips beside the pelvis, the spine and neck beside the thorax - overlap into a
 * smear. So the mobile rig drops from 21 markers to 13 and from 20 bones to 12.
 *
 * This map is the ONLY place the reduction is written down: each absorbed
 * marker names the marker it merges into, and both the reduced marker list and
 * the reduced bone list below are DERIVED from it. Hand-maintaining a second
 * copy of the skeleton is how the two versions end up disagreeing about which
 * limb exists.
 *
 * Eight absorbed markers: 21 - 8 = 13. Rewriting the 20 bones through the map
 * collapses eight of them to self-loops (a bone from a marker to itself), which
 * drop out, leaving 12. Those two counts are not a coincidence - a tree with n
 * nodes always has n-1 edges, and merging a leaf or a degree-two node into its
 * neighbour removes exactly one of each.
 */
export const MOBILE_MERGE: Readonly<Partial<Record<MarkerId, MarkerId>>> = {
  // Extremities fold back one joint.
  L_HN: "L_WR",
  R_HN: "R_WR",
  L_TO: "L_AN",
  R_TO: "R_AN",
  // The torso becomes pelvis / thorax / head, with no intermediate markers.
  SPN: "PLV",
  NCK: "THX",
  // The hips sit within a disc width of the pelvis at this size.
  L_HP: "PLV",
  R_HP: "PLV",
};

/**
 * Follow the merge map to the marker that actually survives.
 *
 * Written as a loop rather than a single lookup so that a future two-step merge
 * (say toe into ankle, then ankle into knee) resolves correctly instead of
 * quietly leaving a dangling reference. The bound is a cycle guard: a mistyped
 * map that pointed A at B and B back at A would otherwise hang the render.
 */
export function resolveMobile(id: MarkerId): MarkerId {
  let current = id;
  for (let hops = 0; hops <= MARKERS.length; hops++) {
    const next = MOBILE_MERGE[current];
    if (next === undefined) return current;
    current = next;
  }
  throw new Error(`MOBILE_MERGE contains a cycle reachable from ${id}`);
}

/** The 13 markers that survive the reduction, still in chain order. */
export const MOBILE_MARKERS: readonly Marker[] = MARKERS.filter(
  (m) => MOBILE_MERGE[m.id] === undefined
);

export const MOBILE_MARKER_IDS: ReadonlySet<MarkerId> = new Set(
  MOBILE_MARKERS.map((m) => m.id)
);

/**
 * The 12 bones that survive, derived by rewriting each full-rig bone through
 * the merge map, dropping the ones that collapse onto a single marker, and
 * dropping any duplicate that two different bones happen to rewrite into.
 */
export const MOBILE_BONES: readonly Bone[] = (() => {
  const out: Bone[] = [];
  const seen = new Set<string>();

  for (const [from, to] of BONES) {
    const a = resolveMobile(from);
    const b = resolveMobile(to);
    // Both ends merged into the same marker: the bone has no length left.
    if (a === b) continue;
    // Undirected dedupe - A-B and B-A are the same segment on screen.
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([a, b]);
  }

  return out;
})();

/* ==========================================================================
   DRIFT - the pre-calibration jitter
   ========================================================================== */

/**
 * During DRIFT each marker wobbles around ground truth on its own sine. The
 * frequencies are spread across 2.7-4.1 Hz because that is fast enough to read
 * as sensor noise rather than as breathing, and slow enough that a 2.5px disc
 * does not strobe.
 *
 * The whole point of this block is that the wobble is NOT random. A caller
 * evaluates it as a pure function of elapsed milliseconds, so the same
 * millisecond always produces the same picture - on the server, on the client
 * first frame after the rewind, and in a test.
 */
export const DRIFT_FREQ_MIN_HZ = 2.7;
export const DRIFT_FREQ_MAX_HZ = 4.1;

export interface DriftParams {
  id: MarkerId;
  /** Cycles per second, in [2.7, 4.1). */
  freqHz: number;
  /** Phase offset for the x wobble, radians in [0, 2pi). */
  phaseX: number;
  /** Phase offset for the y wobble, radians in [0, 2pi). */
  phaseY: number;
}

/** Fractional part. Only ever called with a positive argument here. */
const frac = (n: number): number => n - Math.floor(n);

// Three mutually irrational multipliers, so the three sequences below do not
// line up with each other. The obvious choice of phi, phi^2 and phi^3 does NOT
// work: phi^2 = phi + 1, so frac(k * phi^2) === frac(k * phi) exactly, and the
// phase would be a rescaled copy of the frequency; phi^3 = 2*phi + 1 collapses
// the same way. sqrt(2) and sqrt(3) have no such relationship to phi or to each
// other. Math.sqrt is correctly rounded under IEEE-754, so every engine produces
// bit-identical values - which is exactly what the server render and the client
// first frame are relying on.
const PHI = 1.618033988749895;
const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);

/**
 * Per-marker drift, one entry per marker, in the same order as MARKERS.
 *
 * A golden-ratio (low-discrepancy) sequence rather than evenly spaced values:
 * evenly spaced frequencies re-synchronise on a common period and the whole rig
 * visibly pulses in unison every couple of seconds, which reads as a deliberate
 * animation instead of as noise.
 */
export const DRIFT: readonly DriftParams[] = MARKERS.map((m, i) => {
  const k = i + 1;
  return {
    id: m.id,
    freqHz:
      DRIFT_FREQ_MIN_HZ +
      (DRIFT_FREQ_MAX_HZ - DRIFT_FREQ_MIN_HZ) * frac(k * PHI),
    phaseX: 2 * Math.PI * frac(k * SQRT2),
    phaseY: 2 * Math.PI * frac(k * SQRT3),
  };
});

/** Peak drift excursion from ground truth, in panel pixels. */
export const DRIFT_AMPLITUDE_PX = 1.5;

/**
 * Where a marker sits relative to ground truth at a given moment of DRIFT.
 *
 * Pure, and a function of elapsed milliseconds rather than of a frame counter:
 * a frame counter follows the display refresh, so the same instant would give a
 * different offset on a 60Hz and a 120Hz screen, and the server could not
 * reproduce either.
 *
 * The two axes share a frequency - one marker vibrates at one rate - but carry
 * INDEPENDENT phases, so the marker traces a small Lissajous ellipse rather
 * than sliding back and forth along a single diagonal. A shared phase is what
 * makes simulated noise look like a shudder instead of like noise, and because
 * the two phase sequences come from sqrt(2) and sqrt(3) the 21 markers get 21
 * differently shaped paths rather than 21 copies of one circle.
 *
 * Returned in pixels, so the caller adds it after mapping ground truth into
 * panel coordinates - drift is sensor noise measured at the camera, and it does
 * not scale with the panel the way the pose does.
 */
export function driftOffset(
  params: DriftParams,
  elapsedMs: number,
  amplitude = DRIFT_AMPLITUDE_PX
): { dx: number; dy: number } {
  const w = 2 * Math.PI * params.freqHz * (elapsedMs / 1000);
  return {
    dx: amplitude * Math.sin(w + params.phaseX),
    dy: amplitude * Math.sin(w + params.phaseY),
  };
}

export const DRIFT_BY_ID: ReadonlyMap<MarkerId, DriftParams> = new Map(
  DRIFT.map((d) => [d.id, d])
);

/**
 * The four markers a camera loses during DRIFT.
 *
 * Chosen to be spread across the figure rather than clustered, so the dashed
 * "solved, not measured" bones appear in the torso, both arms and one leg at
 * once. Seven of the twenty bones touch one of these, which is enough of the
 * skeleton to read as a degraded solve without making the pose unreadable.
 *
 * The renderer contract for these during DRIFT: no filled disc, a 1px ring in
 * --v-warning at the PREDICTED position (ground truth - the solver estimate is
 * all there is when the marker is not visible), and every touching bone in
 * --rig-solved with a 3-2 dash.
 */
export const OCCLUDED_DURING_DRIFT: readonly MarkerId[] = [
  "NCK", // torso: leaves the head hanging off a dashed neck
  "L_WR", // left arm: dashes both the forearm and the hand
  "R_HN", // right arm: the classic lost extremity
  "R_AN", // right leg
];

const OCCLUDED_SET: ReadonlySet<MarkerId> = new Set(OCCLUDED_DURING_DRIFT);

/** Is this marker dropped out during DRIFT? */
export const isOccluded = (id: MarkerId): boolean => OCCLUDED_SET.has(id);

/**
 * Is this bone inferred rather than measured during DRIFT?
 *
 * True when EITHER endpoint is occluded: a segment with one unmeasured end is a
 * solve, not a measurement, and the dash pattern says so. This is the same
 * dotted-is-hypothesis rule the rest of the product uses.
 */
export const isSolvedBone = (bone: Bone): boolean =>
  isOccluded(bone[0]) || isOccluded(bone[1]);

/* ==========================================================================
   CAMERAS
   ========================================================================== */

/** The point every camera is aimed at. Also the centre of the 0..1 box. */
export const VOLUME_CENTRE = { x: 0.5, y: 0.5 } as const;

export interface CameraFrustum {
  /** "CAM 1" .. "CAM 8". Mono, and it matches the RAYS n/8 telemetry count. */
  id: string;
  /** Position on the volume perimeter, unit box. */
  x: number;
  y: number;
  /** Unit vector from the camera toward the volume centre. */
  dx: number;
  dy: number;
  /** The same direction in degrees, for an SVG rotate() on the frustum glyph. */
  angleDeg: number;
}

/**
 * Eight positions on the perimeter: the four corners and the four edge
 * midpoints. Eight is not decorative - the telemetry reads RAYS 8/8, and a
 * marker is only solvable when at least two cameras can see it, which is the
 * unstated reason the DRIFT phase can lose four markers and still draw a pose.
 *
 * Inset a couple of percent from the true edge so a 1px frustum outline is not
 * clipped by the panel border.
 */
const CAMERA_POSITIONS: readonly (readonly [number, number])[] = [
  [0.02, 0.06], // top left
  [0.5, 0.02], // top centre
  [0.98, 0.06], // top right
  [0.98, 0.5], // right
  [0.98, 0.94], // bottom right
  [0.5, 0.98], // bottom centre
  [0.02, 0.94], // bottom left
  [0.02, 0.5], // left
];

export const CAMERAS: readonly CameraFrustum[] = CAMERA_POSITIONS.map(
  ([x, y], i) => {
    const vx = VOLUME_CENTRE.x - x;
    const vy = VOLUME_CENTRE.y - y;
    // No camera sits at the centre, so the length is never zero and this never
    // divides by zero. The test pins that rather than trusting the table above.
    const length = Math.hypot(vx, vy);
    return {
      id: `CAM ${i + 1}`,
      x,
      y,
      dx: vx / length,
      dy: vy / length,
      angleDeg: (Math.atan2(vy, vx) * 180) / Math.PI,
    };
  }
);

/* ==========================================================================
   THE FLOOR GRID
   ========================================================================== */

/** Lines per axis. Six each way, twelve in all, enclosing a 5x5 mesh of cells. */
export const GRID_LINES_PER_AXIS = 6;

/**
 * Where the four corners of the floor plane land in the 0..1 box.
 *
 * Listed in the order the homography below is built from: (u,v) = (0,0), (1,0),
 * (1,1), (0,1) - back left, back right, front right, front left. The front edge
 * deliberately overshoots the box on both sides and at the bottom, so the grid
 * runs off the panel rather than stopping in mid-air at a visible seam.
 * Clipping is the renderer job; the geometry stays honest.
 */
export const FLOOR_CORNERS = [
  { x: 0.28, y: 0.62 }, // (0,0) back left
  { x: 0.72, y: 0.62 }, // (1,0) back right
  { x: 1.1, y: 1.02 }, // (1,1) front right
  { x: -0.1, y: 1.02 }, // (0,1) front left
] as const;

/**
 * The fixed 3x3 perspective matrix, row major:
 *
 *   [ a b c ]        x = (a*u + b*v + c) / w
 *   [ d e f ]        y = (d*u + e*v + f) / w
 *   [ g h i ]        w =  g*u + h*v + i
 *
 * This is the homography that maps the unit square onto FLOOR_CORNERS, solved
 * once by hand with the standard closed form for a square-to-quadrilateral map
 * and written out as literals. There is no 3D library, no camera model and no
 * per-frame matrix maths: a homography maps straight lines to straight lines,
 * so each grid line needs exactly two projected endpoints and the renderer
 * draws twelve <line> elements.
 *
 * The back edge of the floor is parallel to the box, so h is the only term that
 * bends the picture: w = 1 - (19/30)*v shrinks toward the back of the volume,
 * which is what makes the far grid cells smaller. w runs from 1 at the back to
 * 11/30 at the front and is never zero or negative anywhere on the plane, so
 * the projection cannot blow up. The test pins that by asserting every
 * projected point is finite, and by re-deriving the four corners.
 *
 * The values are exact: b = -19/60, e = -0.246, h = -19/30.
 */
export const FLOOR_MATRIX = [
  0.44,
  -19 / 60,
  0.28,
  0,
  -0.246,
  0.62,
  0,
  -19 / 30,
  1,
] as const;

export interface Point2 {
  x: number;
  y: number;
}

/**
 * Project a point on the floor plane into the 0..1 box.
 *
 * `u` runs left to right across the floor and `v` runs from the back of the
 * volume (0) to the front (1). Both are normally in 0..1 but nothing here
 * requires it - passing a value outside that range simply projects a point
 * outside the floor quad, which is well defined and occasionally useful for
 * bleeding the grid past the panel edge.
 */
export function projectFloor(u: number, v: number): Point2 {
  const [a, b, c, d, e, f, g, h, i] = FLOOR_MATRIX;
  const w = g * u + h * v + i;
  return {
    x: (a * u + b * v + c) / w,
    y: (d * u + e * v + f) / w,
  };
}

/** One projected floor line: two endpoints, already in box coordinates. */
export interface GridLine {
  /** "u" runs back-to-front; "v" runs left-to-right. */
  axis: "u" | "v";
  a: Point2;
  b: Point2;
}

/**
 * The twelve projected floor lines, endpoints already in box coordinates.
 *
 * Precomputed at module load rather than per frame: the floor never moves, and
 * the whole reason this is data and not canvas drawing is so the server can
 * emit it into the HTML.
 */
export const GRID_LINES: readonly GridLine[] = (() => {
  const lines: GridLine[] = [];
  const last = GRID_LINES_PER_AXIS - 1;

  // Lines of constant u: they run from the back of the volume to the front and
  // fan apart, because a homography maps a family of parallel floor lines to a
  // family meeting at a vanishing point.
  for (let i = 0; i < GRID_LINES_PER_AXIS; i++) {
    const s = i / last;
    lines.push({ axis: "u", a: projectFloor(s, 0), b: projectFloor(s, 1) });
  }
  // Lines of constant v: the rungs. They stay parallel here because the back
  // edge of the floor quad is parallel to the box, and they bunch up toward the
  // back of the volume, which is what sells the plane as a floor.
  for (let i = 0; i < GRID_LINES_PER_AXIS; i++) {
    const s = i / last;
    lines.push({ axis: "v", a: projectFloor(0, s), b: projectFloor(1, s) });
  }

  return lines;
})();

/* ==========================================================================
   COUNTS - quoted in telemetry and in aria labels, so they are derived
   ========================================================================== */

/** The MARKERS n/n readout. Never a literal in the JSX. */
export const MARKER_COUNT = MARKERS.length;
export const BONE_COUNT = BONES.length;
export const MOBILE_MARKER_COUNT = MOBILE_MARKERS.length;
export const MOBILE_BONE_COUNT = MOBILE_BONES.length;
/** The RAYS n/n readout. One ray per camera. */
export const CAMERA_COUNT = CAMERAS.length;
