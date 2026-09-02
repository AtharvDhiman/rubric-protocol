import { describe, expect, it } from "vitest";

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
} from "./oracleGeometry";

/**
 * The oracle's shell resolution IS the judge's confidence, so the geometry that
 * decides how much of it is drawn is not decoration - it is the channel the
 * reader uses to tell a confident ruling from a marginal one. A wrong entry
 * here fails silently: the shell would simply look denser or sparser than the
 * verdict warrants, and nothing would throw.
 */

describe("buildIcosphere", () => {
  it("starts as a regular icosahedron: 12 vertices, 30 edges", () => {
    const mesh = buildIcosphere(0);
    expect(mesh.vertices).toHaveLength(12);
    expect(mesh.edges).toHaveLength(30);
    expect(mesh.maxGeneration).toBe(0);
    expect(mesh.countByGeneration).toEqual([30]);
  });

  it("puts every vertex on the unit sphere at every level", () => {
    for (const subdivisions of [0, 1, 2, 3]) {
      const mesh = buildIcosphere(subdivisions);
      for (const v of mesh.vertices) {
        expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 12);
      }
    }
  });

  it("follows V - E + F = 2 at every level", () => {
    // Euler's formula. If the midpoint cache ever failed to dedupe, the vertex
    // count would balloon and this is the assertion that would catch it.
    for (const subdivisions of [0, 1, 2, 3]) {
      const mesh = buildIcosphere(subdivisions);
      const faces = 20 * 4 ** subdivisions;
      expect(mesh.vertices.length - mesh.edges.length + faces).toBe(2);
    }
  });

  it("deduplicates shared edges rather than drawing them twice", () => {
    // Every edge is shared by two faces. Without the pair-key dedupe the edge
    // list would be 3 * faces long and every seam would draw at double weight.
    const mesh = buildIcosphere(2);
    expect(mesh.edges).toHaveLength(480);
    const seen = new Set<string>();
    for (const edge of mesh.edges) {
      const key =
        edge.a < edge.b ? `${edge.a}-${edge.b}` : `${edge.b}-${edge.a}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("splits edges by lineage, not by which vertices are new", () => {
    // The generation counts follow from the subdivision rule: every existing
    // edge splits in two, and every face contributes three new interior edges.
    // 30 -> 60 + 60 -> 120 + 120 + 240.
    expect(buildIcosphere(1).countByGeneration).toEqual([60, 60]);
    expect(buildIcosphere(2).countByGeneration).toEqual([120, 120, 240]);
    expect(buildIcosphere(3).countByGeneration).toEqual([240, 240, 480, 960]);
  });

  it("orders edges coarsest generation first, so a draw range is a prefix", () => {
    const mesh = buildIcosphere(3);
    let previous = -1;
    for (const edge of mesh.edges) {
      expect(edge.generation).toBeGreaterThanOrEqual(previous);
      previous = edge.generation;
    }
  });

  it("records a real chord length on every edge", () => {
    const mesh = buildIcosphere(2);
    for (const edge of mesh.edges) {
      const a = mesh.vertices[edge.a];
      const b = mesh.vertices[edge.b];
      expect(edge.length).toBeCloseTo(
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
        12
      );
      expect(edge.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveShell", () => {
  const mesh = buildIcosphere(2);

  it("never renders a null confidence as a full shell", () => {
    // The single most important assertion in this file. A missing confidence
    // must read as "nothing was measured", never as a confident verdict.
    const r = resolveShell(mesh, null);
    expect(r.complete).toBe(120);
    expect(r.partial).toBe(0);
    expect(r.total).toBe(120);
    expect(r.total).toBeLessThan(mesh.edges.length);
  });

  it("treats a non-finite confidence the same as a missing one", () => {
    expect(resolveShell(mesh, Number.NaN).total).toBe(120);
  });

  it("always draws generation zero in full", () => {
    // A partially drawn base cage reads as a broken object rather than a
    // coarse one, so confidence 0 is still a complete icosahedral cage.
    const r = resolveShell(mesh, 0);
    expect(r.complete).toBe(120);
    expect(r.partial).toBe(0);
  });

  it("draws the whole mesh at full confidence", () => {
    const r = resolveShell(mesh, 100);
    expect(r.total).toBe(mesh.edges.length);
    expect(r.partial).toBe(0);
  });

  it("resolves monotonically with confidence", () => {
    let previous = -1;
    for (let c = 0; c <= 100; c++) {
      const total = resolveShell(mesh, c).total;
      expect(total).toBeGreaterThanOrEqual(previous);
      previous = total;
    }
  });

  it("puts the partial generation above the complete ones", () => {
    // Confidence 94 on a two-level mesh is depth 1.88: generations 0 and 1
    // complete, and 88% of generation 2.
    const r = resolveShell(mesh, 94);
    expect(r.complete).toBe(240);
    expect(r.partial).toBe(Math.round(240 * 0.88));
    expect(r.total).toBe(r.complete + r.partial);
  });

  it("clamps out-of-range confidences instead of over-drawing", () => {
    expect(resolveShell(mesh, 140).total).toBe(mesh.edges.length);
    expect(resolveShell(mesh, -20).total).toBe(120);
  });
});

describe("line batches", () => {
  it("emits two vertices per edge, with the arc length on the second", () => {
    const mesh = buildIcosphere(1);
    const batch = meshLines(mesh, 1);
    expect(batch.vertexCount).toBe(mesh.edges.length * 2);
    expect(batch.data).toHaveLength(batch.vertexCount * VERTEX_FLOATS);
    // First segment: arc 0 at the start, the chord length at the end. The
    // shader divides that by a pitch uniform, which is what keeps a dash a
    // constant number of screen pixels at every panel size.
    expect(batch.data[3]).toBe(0);
    expect(batch.data[7]).toBeCloseTo(mesh.edges[0].length, 6);
  });

  it("scales the mesh to the requested radius", () => {
    const batch = meshLines(buildIcosphere(0), 0.42);
    const r = Math.hypot(batch.data[0], batch.data[1], batch.data[2]);
    expect(r).toBeCloseTo(0.42, 6);
  });

  it("winds the verdict ring clockwise from twelve o'clock", () => {
    // A gauge that starts anywhere else reads wrong, and the arc that shows how
    // many clauses passed is drawn as a prefix of these segments.
    const batch = ringLines(1.18, 96);
    expect(batch.vertexCount).toBe(192);
    // First vertex at the top: x = 0, y = +radius.
    expect(batch.data[0]).toBeCloseTo(0, 6);
    expect(batch.data[1]).toBeCloseTo(1.18, 6);
    // Second vertex has moved to +x, which is clockwise on screen.
    expect(batch.data[4]).toBeGreaterThan(0);
  });

  it("keeps every ring segment the same length", () => {
    const batch = ringLines(1.18, 96);
    const first = batch.data[7];
    for (let i = 0; i < 96; i++) {
      expect(batch.data[i * 2 * VERTEX_FLOATS + 7]).toBeCloseTo(first, 9);
    }
  });
});

describe("the matrix maths", () => {
  it("is a pure rotation: orthonormal, determinant 1", () => {
    const m = rotation3(-0.26, 0.62);
    const rows = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
    for (const row of rows) {
      expect(Math.hypot(row[0], row[1], row[2])).toBeCloseTo(1, 12);
    }
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);
    expect(det).toBeCloseTo(1, 12);
  });

  it("is the identity at zero", () => {
    // Element-wise, because a zero term reached through a negation is -0, and
    // -0 is a perfectly good zero for a rotation matrix.
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    rotation3(0, 0).forEach((value, i) => {
      expect(value).toBeCloseTo(identity[i], 12);
    });
  });

  it("pushes the object down -z so the camera can see it", () => {
    const mv = modelView(new Float32Array(16), null, 3.6);
    expect(mv[14]).toBeCloseTo(-3.6, 6);
    expect(mv[15]).toBe(1);
    // Translation only: the rotation block is the identity, which is what keeps
    // the verdict ring facing the reader as a true circle.
    expect(mv[0]).toBe(1);
    expect(mv[5]).toBe(1);
    expect(mv[10]).toBe(1);
  });

  it("uploads the rotation in column-major order", () => {
    const rot = rotation3(0.3, 0.7);
    const mv = modelView(new Float32Array(16), rot, 2);
    // Column 0 of the matrix is the first entry of each ROW of the row-major
    // source. Getting this transposed is the classic mat4 bug and it looks
    // almost right, so it is asserted rather than eyeballed.
    expect(mv[0]).toBeCloseTo(rot[0], 6);
    expect(mv[1]).toBeCloseTo(rot[3], 6);
    expect(mv[2]).toBeCloseTo(rot[6], 6);
    expect(mv[4]).toBeCloseTo(rot[1], 6);
  });

  it("fits the shorter side of the panel at every aspect ratio", () => {
    // A textbook perspective fixes the VERTICAL field of view, which runs the
    // object off the left and right edges of a phone-shaped viewport. The
    // scale on the shorter axis must be the same however the panel is shaped.
    const wide = new Float32Array(16);
    const tall = new Float32Array(16);
    perspective(wide, 0.86, 2, 0.1, 20);
    perspective(tall, 0.86, 0.5, 0.1, 20);
    // 6 digits, not 12: these matrices are Float32Arrays because that is what
    // WebGL uploads, and single precision carries about seven decimal digits.
    const f = 1 / Math.tan(0.86 / 2);
    expect(wide[5]).toBeCloseTo(f, 6); // wide: height is the constraint
    expect(tall[0]).toBeCloseTo(f, 6); // tall: width is the constraint
    expect(verticalScale(0.86, 2)).toBeCloseTo(wide[5], 6);
    expect(verticalScale(0.86, 0.5)).toBeCloseTo(tall[5], 6);
  });

  it("writes a standard perspective divide", () => {
    const p = new Float32Array(16);
    perspective(p, 0.86, 1, 0.1, 20);
    expect(p[11]).toBe(-1);
    expect(p[15]).toBe(0);
  });
});
