import type { PartFeatures } from '@wbcnc/cam';
import { describe, expect, it } from 'vitest';
import type { BodyMesh } from '@/cam/camTypes';
import { cutPartMesh } from '@/cam/cutPartMesh';
import { sectionGeometry, type SectionPlane, type SectionVec3 } from './sectionGeometry';
import { sectionContours } from './sectionTopology';

type Triangle = [SectionVec3, SectionVec3, SectionVec3];
type Path = { x: number; y: number }[];
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rectangle = (x: number, y: number, width: number, depth: number): Path =>
  [
    [x, y],
    [x + width, y],
    [x + width, y + depth],
    [x, y + depth],
  ].map(([x, y]) => ({ x: x!, y: y! }));
const signedArea = (path: Path) =>
  path.reduce((area, a, i) => {
    const b = path[(i + 1) % path.length]!;
    return area + a.x * b.y - b.x * a.y;
  }, 0) / 2;
function stock(width = 100, depth = 60, thickness = 18, hole?: Path, pocket?: { path: Path; floor: number; island?: Path }): BodyMesh {
  const outer = rectangle(0, 0, width, depth),
    footprint = [outer, ...(hole ? [[...hole].reverse()] : [])];
  const top = pocket ? [...footprint, [...pocket.path].reverse(), ...(pocket.island ? [pocket.island] : [])] : footprint;
  const floor = pocket ? [pocket.path, ...(pocket.island ? [[...pocket.island].reverse()] : [])] : [];
  const level = (region: Path[], z: number) => ({ region, z, area: region.reduce((area, path) => area + signedArea(path), 0) });
  const features: PartFeatures = {
    thickness,
    footprint,
    outlines: [outer],
    throughHoles: hole ? [hole] : [],
    levels: [level(top, thickness), ...(pocket ? [level(floor, pocket.floor)] : [])],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
  const mesh = cutPartMesh(features);
  return { ...mesh, positions: Float32Array.from(mesh.positions), name: 'Stock', partId: 'stock-id', flat: identity };
}
const horizontal = (z: number, flip = false): SectionPlane => ({ origin: [0, 0, z], normal: [0, 0, flip ? -1 : 1] });
const triangles = (mesh: BodyMesh | null): Triangle[] =>
  mesh
    ? Array.from(
        { length: mesh.indices.length / 3 },
        (_, i) =>
          [0, 1, 2].map(k => {
            const index = mesh.indices[i * 3 + k]! * 3;
            return [mesh.positions[index]!, mesh.positions[index + 1]!, mesh.positions[index + 2]!];
          }) as Triangle
      )
    : [];
const minus = (a: SectionVec3, b: SectionVec3): SectionVec3 => a.map((value, i) => value - b[i]!) as SectionVec3;
const cross = (a: SectionVec3, b: SectionVec3): SectionVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: SectionVec3, b: SectionVec3) => a.reduce((sum, value, i) => sum + value * b[i]!, 0);
const area = (mesh: BodyMesh | null) =>
  triangles(mesh).reduce((sum, [a, b, c]) => sum + Math.hypot(...cross(minus(b, a), minus(c, a))) / 2, 0);
function volume(...meshes: (BodyMesh | null)[]) {
  const faces = meshes.flatMap(triangles),
    origin = faces[0]?.[0] ?? ([0, 0, 0] as SectionVec3);
  return faces.reduce((sum, [a, b, c]) => sum + dot(minus(a, origin), cross(minus(b, origin), minus(c, origin))) / 6, 0);
}
function clipped(mesh: BodyMesh, plane: SectionPlane) {
  const result = sectionGeometry(mesh, plane);
  expect(result.problem).toBeUndefined();
  for (const [a, b, c] of triangles(result.cap)) expect(dot(cross(minus(b, a), minus(c, a)), plane.normal)).toBeGreaterThan(0);
  for (const triangle of [...triangles(result.body), ...triangles(result.cap)]) {
    const [a, b, c] = triangle;
    expect(Math.hypot(...cross(minus(b, a), minus(c, a)))).toBeGreaterThan(0);
    for (const point of triangle) expect(dot(minus(point, plane.origin), plane.normal)).toBeLessThanOrEqual(1e-4);
  }
  expect(result.body).toMatchObject({ name: mesh.name, partId: mesh.partId, flat: mesh.flat });
  return result;
}
function occupied(mesh: BodyMesh | null, point: SectionVec3) {
  return triangles(mesh).some(([a, b, c]) => {
    const normal = cross(minus(b, a), minus(c, a));
    return [
      [a, b],
      [b, c],
      [c, a],
    ].every(([p, q]) => dot(cross(minus(q!, p!), minus(point, p!)), normal) >= -1e-6);
  });
}
function fromTriangles(mesh: BodyMesh, faces: Triangle[]): BodyMesh {
  const positions = Float32Array.from(faces.flat(2));
  return { ...mesh, positions, indices: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) };
}

describe('finite solid section geometry', () => {
  it('cuts 100×60×18 stock into complementary watertight half volumes', () => {
    const mesh = stock(),
      before = Array.from(mesh.positions),
      lower = clipped(mesh, horizontal(9)),
      upper = clipped(mesh, horizontal(9, true));
    expect(area(lower.cap)).toBeCloseTo(6000, 8);
    expect(area(upper.cap)).toBeCloseTo(6000, 8);
    expect(volume(lower.body, lower.cap)).toBeCloseTo(54000, 8);
    expect(volume(upper.body, upper.cap)).toBeCloseTo(54000, 8);
    expect(Array.from(mesh.positions)).toEqual(before);
    expect(lower.body.positions).toBeInstanceOf(Float32Array);
    expect(lower.cap!.indices).toBeInstanceOf(Uint32Array);
  });

  it('preserves a through hole and disconnected material on a vertical section', () => {
    const mesh = stock(100, 60, 18, rectangle(40, 25, 20, 10)),
      lower = clipped(mesh, horizontal(9));
    expect(area(lower.cap)).toBeCloseTo(5800, 8);
    expect(volume(lower.body, lower.cap)).toBeCloseTo(52200, 8);
    expect(occupied(lower.cap, [50, 30, 9])).toBe(false);
    expect(occupied(lower.cap, [10, 30, 9])).toBe(true);
    const vertical = clipped(mesh, { origin: [50, 0, 0], normal: [1, 0, 0] });
    expect(area(vertical.cap)).toBeCloseTo(900, 8);
    expect(occupied(vertical.cap, [50, 30, 9])).toBe(false);
    expect(occupied(vertical.cap, [50, 10, 9])).toBe(true);
    expect(occupied(vertical.cap, [50, 50, 9])).toBe(true);
  });

  it('preserves a blind pocket and material island, including a plane on the pocket floor', () => {
    const pocket = { path: rectangle(30, 20, 40, 20), floor: 12 };
    for (const island of [undefined, rectangle(40, 25, 20, 10)]) {
      const mesh = stock(100, 60, 18, undefined, { ...pocket, island });
      const lower = clipped(mesh, horizontal(15)),
        upper = clipped(mesh, horizontal(15, true));
      const expectedArea = island ? 5400 : 5200;
      expect(area(lower.cap)).toBeCloseTo(expectedArea, 8);
      expect(volume(lower.body, lower.cap)).toBeCloseTo(72000 + 3 * expectedArea, 8);
      expect(volume(upper.body, upper.cap)).toBeCloseTo(3 * expectedArea, 8);
      expect(occupied(lower.cap, [35, 30, 15])).toBe(false);
      expect(occupied(lower.cap, [50, 30, 15])).toBe(Boolean(island));
      const floor = clipped(mesh, horizontal(12));
      expect(area(floor.cap)).toBeCloseTo(6000, 8);
      expect(volume(floor.body, floor.cap)).toBeCloseTo(72000, 8);
      const aboveFloor = clipped(mesh, horizontal(12, true));
      expect(area(aboveFloor.cap)).toBeCloseTo(expectedArea, 8);
    }
  });

  it('keeps the tetrahedral corner of a diagonal 10 mm cube section', () => {
    const mesh = stock(10, 10, 10),
      plane: SectionPlane = { origin: [10 / 3, 10 / 3, 10 / 3], normal: [1, 1, 1] };
    const result = clipped(mesh, plane);
    expect(area(result.cap)).toBeCloseTo(50 * Math.sqrt(3), 5);
    expect(volume(result.body, result.cap)).toBeCloseTo(1000 / 6, 5);
    const complement = clipped(mesh, { ...plane, normal: [-1, -1, -1] });
    expect(volume(complement.body, complement.cap)).toBeCloseTo((1000 * 5) / 6, 4);
  });

  it('retains supporting-plane faces in the closed halfspace even when their volume is zero', () => {
    const mesh = stock();
    for (const plane of [horizontal(0), horizontal(18, true)]) {
      const result = clipped(mesh, plane);
      expect(result.body.indices.length).toBe(0);
      expect(area(result.cap)).toBeCloseTo(6000, 8);
      expect(volume(result.body, result.cap)).toBe(0);
      const flipped = clipped(mesh, { ...plane, normal: plane.normal.map(value => -value) as SectionVec3 });
      expect(area(flipped.cap)).toBeCloseTo(6000, 8);
      expect(volume(flipped.body, flipped.cap)).toBeCloseTo(108000, 8);
    }
    const holed = clipped(stock(100, 60, 18, rectangle(40, 25, 20, 10)), horizontal(0));
    expect(holed.body.indices.length).toBe(0);
    expect(area(holed.cap)).toBeCloseTo(5800, 8);
    expect(occupied(holed.cap, [50, 30, 0])).toBe(false);
    expect(occupied(holed.cap, [10, 30, 0])).toBe(true);
  });

  it('leaves outside, edge and vertex contact empty and keeps representable near-vertex cuts', () => {
    const mesh = stock();
    for (const plane of [
      horizontal(-1),
      { origin: [0, 0, 0], normal: [1, 1, 0] },
      { origin: [0, 0, 0], normal: [1, 1, 1] },
    ] as SectionPlane[]) {
      const result = clipped(mesh, plane);
      expect(result.body.indices.length).toBe(0);
      expect(result.cap).toBeNull();
    }
    const whole = clipped(mesh, horizontal(18));
    expect(area(whole.cap)).toBeCloseTo(6000, 8);
    expect(volume(whole.body, whole.cap)).toBeCloseTo(108000, 8);
    const thin = clipped(mesh, horizontal(0.00001));
    expect(area(thin.cap)).toBeCloseTo(6000, 8);
    expect(volume(thin.body, thin.cap)).toBeCloseTo(0.06, 8);
    const outside = clipped(mesh, horizontal(19));
    expect(outside.body).toBe(mesh);
    expect(outside.cap).toBeNull();
  });

  it('nodes a finite source T-junction instead of rejecting a valid solid', () => {
    const mesh = stock(),
      faces = triangles(mesh),
      [a, b, c] = faces[0]!;
    const middle = a.map((value, i) => (value + b[i]!) / 2) as SectionVec3;
    faces.splice(0, 1, [a, middle, c], [middle, b, c]);
    const result = clipped(fromTriangles(mesh, faces), horizontal(9));
    expect(area(result.cap)).toBeCloseTo(6000, 8);
    expect(volume(result.body, result.cap)).toBeCloseTo(54000, 8);
  });

  it('uses the same plane when its origin moves far along that plane', () => {
    const result = clipped(stock(), { origin: [1e10, -1e10, 9], normal: [0, 0, 1] });
    expect(area(result.cap)).toBeCloseTo(6000, 8);
    expect(volume(result.body, result.cap)).toBeCloseTo(54000, 8);
  });

  it('reports coordinate precision instead of emitting collapsed triangles in a translated thin section', () => {
    const source = stock(),
      moved = fromTriangles(
        source,
        triangles(source).map(triangle => triangle.map(([x, y, z]) => [x, y, z + 1000]) as Triangle)
      );
    const unrepresentable = sectionGeometry(moved, horizontal(1000.00001));
    expect(unrepresentable.problem).toMatch(/coordinate precision/);
    expect(unrepresentable.body).toBe(moved);
    expect(unrepresentable.cap).toBeNull();
    // This tetrahedron's side triangles can all keep nonzero XY area after Z collapses. A positive-volume check is
    // still required; testing only individual triangle areas would allow a flattened, double-sided solid through.
    const a: SectionVec3 = [0, 0, 1000],
      b: SectionVec3 = [100, 0, 1000],
      c: SectionVec3 = [0, 100, 1000],
      d: SectionVec3 = [30, 30, 1018];
    const tetrahedron = fromTriangles(source, [
      [a, c, b],
      [a, b, d],
      [b, c, d],
      [c, a, d],
    ]);
    const flat = sectionGeometry(tetrahedron, horizontal(1000.00001));
    expect(flat.problem).toMatch(/coordinate precision/);
    expect(flat.body).toBe(tetrahedron);
    expect(flat.cap).toBeNull();
    const touching = clipped(moved, horizontal(1000));
    expect(area(touching.cap)).toBeCloseTo(6000, 8);
    expect(volume(touching.cap)).toBe(0);
    const resolved = clipped(moved, horizontal(1000.125));
    expect(area(resolved.cap)).toBeCloseTo(6000, 8);
    expect(volume(resolved.body, resolved.cap)).toBeCloseTo(750, 8);
  });

  it('retains a rotated and reflected copy with outward winding and exact metadata', () => {
    const mesh = stock(100, 60, 18, rectangle(40, 25, 20, 10));
    // A reflection and quarter turn, followed by a translation; reverse triangle winding for the reflection.
    const map = ([x, y, z]: SectionVec3): SectionVec3 => [z + 120, y - 40, x + 35];
    const mapped = fromTriangles(
      { ...mesh, name: 'Copy 3', partId: 'same-family' },
      triangles(mesh).map(([a, b, c]) => [map(a), map(c), map(b)])
    );
    const result = clipped(mapped, { origin: map([0, 0, 9]), normal: [1, 0, 0] });
    expect(area(result.cap)).toBeCloseTo(5800, 8);
    expect(volume(result.body, result.cap)).toBeCloseTo(52200, 8);
    expect(occupied(result.cap, map([50, 30, 9]))).toBe(false);
    const touching = clipped(mapped, { origin: map([0, 0, 0]), normal: [1, 0, 0] });
    expect(touching.body.indices.length).toBe(0);
    expect(area(touching.cap)).toBeCloseTo(5800, 8);
    expect(volume(touching.cap)).toBe(0);
  });

  it('rejects open, duplicated, inward and invalid input without a guessed cap', () => {
    const mesh = stock(),
      faces = triangles(mesh);
    const broken = [
      fromTriangles(mesh, faces.slice(1)),
      fromTriangles(mesh, [...faces, faces[0]!]),
      fromTriangles(
        mesh,
        faces.map(([a, b, c]) => [a, c, b])
      ),
    ];
    for (const candidate of broken) {
      for (const plane of [horizontal(9), horizontal(0), horizontal(18, true)]) {
        const result = sectionGeometry(candidate, plane);
        expect(result.problem).toBeTruthy();
        expect(result.body).toBe(candidate);
        expect(result.cap).toBeNull();
      }
    }
    for (const plane of [
      { origin: [0, NaN, 0], normal: [0, 0, 1] },
      { origin: [0, 0, 0], normal: [0, 0, 0] },
    ] as SectionPlane[])
      expect(sectionGeometry(mesh, plane).problem).toBeTruthy();
    expect(sectionGeometry({ ...mesh, indices: Uint32Array.of(0, 1, 99999) }, horizontal(9)).problem).toBeTruthy();
    const empty = { ...mesh, positions: new Float32Array(), indices: new Uint32Array() };
    expect(sectionGeometry(empty, horizontal(9))).toEqual({ body: empty, cap: null });
  });

  it('keeps the exact crossing check when many disjoint contour bounds are pruned', () => {
    const loop = (x: number, y: number): SectionVec3[] => [
      [x, y, 0],
      [x + 4, y, 0],
      [x + 4, y + 4, 0],
      [x, y + 4, 0],
    ];
    const segments = (loops: SectionVec3[][]) =>
      loops.flatMap(points => points.map((a, i) => ({ a, b: points[(i + 1) % points.length]! })));
    const disjoint = Array.from({ length: 50 }, (_, i) => loop(i * 10, 0));
    expect(sectionContours(segments(disjoint), 1e-8).problem).toBeUndefined();
    expect(sectionContours(segments([...disjoint, loop(2, -1)]), 1e-8).problem).toMatch(/crosses/);
  });
});
