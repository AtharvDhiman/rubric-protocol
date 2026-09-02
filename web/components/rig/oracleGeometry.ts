/**
 * GEOMETRY FOR THE VERDICT ORACLE.
 *
 * Pure maths, no DOM, no WebGL. It is separated from the component for the same
 * reason `lib/rig.ts` is: the shell's resolution is a function of the judge's
 * confidence, and a number that decides what a reader sees should be testable
 * without a canvas.
 *
 * Nothing here is a design decision about colour. Colours are read from the
 * live cascade in the component; this file only ever produces coordinates.
 */

export type Vec3 = readonly [number, number, number];

/**
 * One undirected edge of the wireframe, tagged with the SUBDIVISION GENERATION
 * it belongs to.
 *
 * The generation is the whole point of this file. A naive icosphere gives you a
 * flat bag of edges, and there is then no honest way to draw "some" of it - you
 * would have to pick edges at random, which looks like corruption rather than
 * like a partial measurement. Tracking lineage means a coarse draw is the base
 * icosahedron's own 30 edges (subdivided smoothly, so they read as great arcs),
 * and each finer generation fills the triangulation in evenly.
 */
export interface Edge {
  a: number;
  b: number;
  generation: number;
  /** Chord length in world units. Drives the dash phase; see the component. */
  length: number;
}

export interface Mesh {
  vertices: readonly Vec3[];
  /** Sorted coarsest generation first, so a draw range is a prefix. */
  edges: readonly Edge[];
  /** countByGeneration[g] === how many edges carry generation g. */
  countByGeneration: readonly number[];
  maxGeneration: number;
}

/* ==========================================================================
   THE ICOSAHEDRON
   ========================================================================== */

/**
 * Vertex-pair key. Two vertex indices in either order collapse to one number,
 * which is what makes the midpoint cache and the edge table dedupe correctly.
 *
 * Without the cache every shared edge would get two midpoints at the same
 * coordinate, the vertex count would roughly double each level, and every
 * shared edge would be drawn twice - visibly heavier lines along exactly the
 * seams you least want emphasised.
 */
const PAIR_STRIDE = 100_000;

const pairKey = (a: number, b: number): number =>
  a < b ? a * PAIR_STRIDE + b : b * PAIR_STRIDE + a;

const pairA = (key: number): number => Math.floor(key / PAIR_STRIDE);
const pairB = (key: number): number => key % PAIR_STRIDE;

/** Push a vector back onto the unit sphere. This is what makes it a sphere. */
function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * The twelve base vertices: three mutually perpendicular golden rectangles.
 *
 * (0, +/-1, +/-t) and its two cyclic permutations, with t the golden ratio.
 * Every one of the twelve is then the same distance from its five neighbours,
 * which is the property that makes the icosahedron regular - and the reason
 * this construction is used rather than a lat/long sphere, whose poles bunch
 * up and would read as a defect in an object that is meant to look milled.
 */
function baseVertices(): Vec3[] {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: Vec3[] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  return raw.map(normalise);
}

/** The twenty faces, wound consistently. */
const BASE_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

/**
 * Build an icosphere, subdivided `subdivisions` times, with every edge tagged
 * by the generation its LINEAGE started in.
 *
 * The lineage rule, in plain English: when a triangle is split, the six half
 * edges that lie along the parent triangle's sides inherit that side's
 * generation - they are the same structural edge, just shorter. The three new
 * edges across the middle are new at this step and get the step number.
 *
 * That is why a "generation 0" draw is not 30 short segments but the full
 * outline of the original icosahedron rendered as smooth subdivided arcs.
 */
export function buildIcosphere(subdivisions: number): Mesh {
  const vertices = baseVertices();
  let faces: (readonly [number, number, number])[] = BASE_FACES.map((f) => f);

  // Every edge of the base solid starts life at generation 0.
  let generations = new Map<number, number>();
  for (const [a, b, c] of faces) {
    generations.set(pairKey(a, b), 0);
    generations.set(pairKey(b, c), 0);
    generations.set(pairKey(c, a), 0);
  }

  // Keys are unique per vertex PAIR across the whole build, so one cache
  // serves every level and no midpoint is ever created twice.
  const midpoints = new Map<number, number>();
  const midpoint = (a: number, b: number): number => {
    const key = pairKey(a, b);
    const cached = midpoints.get(key);
    if (cached !== undefined) return cached;
    const va = vertices[a];
    const vb = vertices[b];
    const index = vertices.length;
    vertices.push(
      normalise([
        (va[0] + vb[0]) / 2,
        (va[1] + vb[1]) / 2,
        (va[2] + vb[2]) / 2,
      ])
    );
    midpoints.set(key, index);
    return index;
  };

  for (let step = 1; step <= subdivisions; step++) {
    const nextFaces: (readonly [number, number, number])[] = [];
    const nextGenerations = new Map<number, number>();

    const inherit = (a: number, b: number, mid: number): void => {
      const parent = generations.get(pairKey(a, b));
      if (parent === undefined) {
        // Unreachable: every face side was written when the previous level was
        // built. Throwing rather than defaulting to 0 is deliberate - a silent
        // 0 would quietly promote fine detail into the always-drawn coarse set
        // and the confidence mapping would stop meaning anything.
        throw new Error(`Icosphere edge ${a}-${b} has no generation`);
      }
      nextGenerations.set(pairKey(a, mid), parent);
      nextGenerations.set(pairKey(mid, b), parent);
    };

    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);

      inherit(a, b, ab);
      inherit(b, c, bc);
      inherit(c, a, ca);

      nextGenerations.set(pairKey(ab, bc), step);
      nextGenerations.set(pairKey(bc, ca), step);
      nextGenerations.set(pairKey(ca, ab), step);

      nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }

    faces = nextFaces;
    generations = nextGenerations;
  }

  // Map insertion order is face-emission order, and Array.sort is stable, so
  // sorting by generation keeps each generation in a spatially coherent order.
  // That matters: a partially drawn generation then fills in as a spreading
  // patch rather than as scattered noise.
  const edges: Edge[] = [];
  for (const [key, generation] of generations) {
    const a = pairA(key);
    const b = pairB(key);
    const va = vertices[a];
    const vb = vertices[b];
    edges.push({
      a,
      b,
      generation,
      length: Math.hypot(va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]),
    });
  }
  edges.sort((x, y) => x.generation - y.generation);

  const countByGeneration = new Array<number>(subdivisions + 1).fill(0);
  for (const edge of edges) countByGeneration[edge.generation]++;

  return {
    vertices,
    edges,
    countByGeneration,
    maxGeneration: subdivisions,
  };
}

/* ==========================================================================
   CONFIDENCE -> RESOLUTION

   THE MAPPING, STATED ONCE AND EXACTLY:

     The judge's confidence is HOW FINELY THE SHELL IS TESSELLATED.

   Confidence 0 draws generation 0 alone - the bare icosahedral cage. Confidence
   100 draws every generation. In between, the fully resolved generations are
   drawn complete and the next one is drawn to the fractional part.

   Two things this deliberately is NOT:

   - It is not opacity or brightness. DESIGN.md forbids animating opacity on a
     meaning-bearing rig line, because an alpha ramp walks a line through values
     below its contrast floor while it is still carrying meaning. Resolution has
     no such failure mode: every line drawn is drawn at full strength.
   - It is not the verdict. Confidence is the judge's CERTAINTY, not its answer.
     A confident rejection is a fully resolved shell with an arrested core, and
     that is correct - the measurement was good, the answer was no.

   Generation 0 is always drawn in full. A partially drawn base cage reads as a
   broken object rather than as a coarse one, and the coarsest honest statement
   the rig can make is "there is a shell here and nothing finer is known".
   ========================================================================== */

export interface Resolution {
  /** Edges belonging to generations that are drawn COMPLETE. Solid. */
  complete: number;
  /** Edges of the topmost, partially resolved generation. Always dashed. */
  partial: number;
  /** complete + partial. */
  total: number;
}

/**
 * `confidence` is `null` when nothing has been judged, and a null confidence
 * must never render as a number or as a full shell. It resolves to generation
 * zero: the coarsest thing the rig can draw, which is the honest picture of a
 * measurement that has not happened.
 */
export function resolveShell(
  mesh: Mesh,
  confidence: number | null
): Resolution {
  const base = mesh.countByGeneration[0];
  if (confidence === null || !Number.isFinite(confidence)) {
    return { complete: base, partial: 0, total: base };
  }

  const clamped = Math.min(100, Math.max(0, confidence));
  const depth = (clamped / 100) * mesh.maxGeneration;
  const full = Math.min(mesh.maxGeneration, Math.floor(depth));
  const fraction = depth - full;

  let complete = 0;
  for (let g = 0; g <= full; g++) complete += mesh.countByGeneration[g];

  const nextGeneration = full + 1;
  const partial =
    nextGeneration <= mesh.maxGeneration
      ? Math.round(mesh.countByGeneration[nextGeneration] * fraction)
      : 0;

  return { complete, partial, total: complete + partial };
}

/* ==========================================================================
   BUFFER ASSEMBLY

   Everything is drawn with gl.LINES - one primitive mode for the whole rig.
   Each vertex is four floats: x, y, z, arc. `arc` is the distance in WORLD
   units from the start of that segment, and the shader divides it by a dash
   pitch uniform. Doing the division in the shader rather than baking it here
   means the dash pitch can be recomputed on resize and stay a constant number
   of SCREEN pixels at every panel size.
   ========================================================================== */

/** Floats per vertex in the interleaved buffer: xyz + arc. */
export const VERTEX_FLOATS = 4;

export interface LineBatch {
  /** Interleaved xyz + arc, two vertices per segment. */
  data: Float32Array;
  /** Number of VERTICES (segments * 2). */
  vertexCount: number;
}

/** Mesh edges as line segments, scaled to `radius`. */
export function meshLines(mesh: Mesh, radius: number): LineBatch {
  const count = mesh.edges.length * 2;
  const data = new Float32Array(count * VERTEX_FLOATS);
  let o = 0;
  for (const edge of mesh.edges) {
    const va = mesh.vertices[edge.a];
    const vb = mesh.vertices[edge.b];
    data[o++] = va[0] * radius;
    data[o++] = va[1] * radius;
    data[o++] = va[2] * radius;
    data[o++] = 0;
    data[o++] = vb[0] * radius;
    data[o++] = vb[1] * radius;
    data[o++] = vb[2] * radius;
    data[o++] = edge.length * radius;
  }
  return { data, vertexCount: count };
}

/**
 * The verdict ring: a flat circle in the object's XY plane.
 *
 * It is drawn with the rotation left OUT of the model matrix, so it always
 * faces the reader as a true circle rather than tumbling into an ellipse. It is
 * a gauge, not a body: the fact it reports - how many sealed clauses passed -
 * does not rotate.
 *
 * Segments run clockwise from twelve o'clock, which is how every gauge anyone
 * has ever read is wound.
 */
export function ringLines(radius: number, segments: number): LineBatch {
  const count = segments * 2;
  const data = new Float32Array(count * VERTEX_FLOATS);
  let o = 0;
  for (let i = 0; i < segments; i++) {
    const t0 = (i / segments) * Math.PI * 2;
    const t1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.sin(t0) * radius;
    const y0 = Math.cos(t0) * radius;
    const x1 = Math.sin(t1) * radius;
    const y1 = Math.cos(t1) * radius;
    const length = Math.hypot(x1 - x0, y1 - y0);
    data[o++] = x0;
    data[o++] = y0;
    data[o++] = 0;
    data[o++] = 0;
    data[o++] = x1;
    data[o++] = y1;
    data[o++] = 0;
    data[o++] = length;
  }
  return { data, vertexCount: count };
}

/* ==========================================================================
   THE MATRIX MATHS

   Six lines of it, written out rather than pulled from a library. Column-major,
   because that is the order WebGL uploads a mat4 in.
   ========================================================================== */

/**
 * The 3x3 rotation Rx(pitch) * Ry(yaw), row-major, as nine numbers.
 *
 * One function, two consumers: the GPU path folds it into the model-view
 * matrix, and the poster path multiplies points by it directly on the CPU. That
 * is the same discipline the other rigs use - the still frame and the animation
 * are the same maths, so they cannot drift apart.
 */
export function rotation3(pitch: number, yaw: number): number[] {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return [
    cy, 0, sy,
    sp * sy, cp, -sp * cy,
    -cp * sy, sp, cp * cy,
  ];
}

/**
 * Model-view: rotate about the origin, then push the whole thing `dist` down
 * the -z axis so the camera at the origin can see it.
 *
 * Pass `null` for the rotation to get translation only, which is what the
 * verdict ring uses to stay screen-facing.
 */
export function modelView(
  out: Float32Array,
  rot: number[] | null,
  dist: number
): Float32Array {
  const m = rot ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // Column 0 is the first COLUMN of the matrix, which is the first entry of
  // each row - hence the stride of 3 through the row-major source.
  out[0] = m[0];
  out[1] = m[3];
  out[2] = m[6];
  out[3] = 0;
  out[4] = m[1];
  out[5] = m[4];
  out[6] = m[7];
  out[7] = 0;
  out[8] = m[2];
  out[9] = m[5];
  out[10] = m[8];
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = -dist;
  out[15] = 1;
  return out;
}

/**
 * Perspective, fitted to the SHORTER side of the panel.
 *
 * A textbook perspective matrix fixes the vertical field of view, which is
 * correct for a wide panel and wrong for a tall one - the object would run off
 * the left and right edges of a phone-shaped viewport. Fixing whichever
 * dimension is smaller means the whole object is inside the frame at every
 * aspect ratio, which is the only behaviour a bounded viewport can accept.
 */
export function perspective(
  out: Float32Array,
  fovY: number,
  aspect: number,
  near: number,
  far: number
): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const fx = aspect >= 1 ? f / aspect : f;
  const fy = aspect >= 1 ? f : f * aspect;
  out.fill(0);
  out[0] = fx;
  out[5] = fy;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** The vertical projection scale actually used, given the fit-shorter-side rule. */
export const verticalScale = (fovY: number, aspect: number): number => {
  const f = 1 / Math.tan(fovY / 2);
  return aspect >= 1 ? f : f * aspect;
};
