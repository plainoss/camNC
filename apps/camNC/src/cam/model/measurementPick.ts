import type { MeasureEntity, MeasureTriangle, MeasureVec3 } from '@/cad/measureGeometry';
import { joinStraightEdges, type ModelEdge } from './edgePick';

/** A geometry selection in assembly coordinates; the workspace resolves its mesh index to the exact physical copy. */
export interface ModelMeasurePick {
  partId: string;
  index: number;
  entity: MeasureEntity;
  additive: boolean;
}

type MeshSource = { positions: Float32Array; indices: ArrayLike<number> };
type Triangle = { points: MeasureTriangle; normal: MeasureVec3; low: MeasureVec3; high: MeasureVec3 };
type FaceEntity = Extract<MeasureEntity, { kind: 'face' }>;
type Projection = { point: (p: MeasureVec3) => number; segment: (a: MeasureVec3, b: MeasureVec3) => number };
const triangles = new WeakMap<
  Float32Array,
  { indices: ArrayLike<number>; values: (Triangle | null)[]; tolerance: number; faces: Map<number, FaceEntity> }
>();
const faceEdges = new WeakMap<FaceEntity, { edges: readonly ModelEdge[]; valid: Map<ModelEdge, boolean> }>();

const sub = (a: MeasureVec3, b: MeasureVec3): MeasureVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: MeasureVec3, b: MeasureVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: MeasureVec3, b: MeasureVec3): MeasureVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const edges = (t: MeasureTriangle): [MeasureVec3, MeasureVec3][] => [
  [t[0], t[1]],
  [t[1], t[2]],
  [t[2], t[0]],
];

function triangleSource({ positions, indices }: MeshSource) {
  const previous = triangles.get(positions);
  if (previous?.indices === indices) return previous;
  let reach = 1;
  for (const value of positions) reach = Math.max(reach, Math.abs(value));
  // Mesh coordinates are Float32 after a rigid placement. The tolerance admits that rounding without merging
  // separately placed surfaces: a face still needs a shared geometric edge and the same normal.
  const tolerance = reach * 2e-7;
  const values = Array.from({ length: Math.floor(indices.length / 3) }, (_, i): Triangle | null => {
    const points = [0, 1, 2].map(k => {
      const j = indices[i * 3 + k]! * 3;
      return [positions[j]!, positions[j + 1]!, positions[j + 2]!] as MeasureVec3;
    }) as MeasureTriangle;
    if (!points.flat().every(Number.isFinite)) return null;
    const n = cross(sub(points[1], points[0]), sub(points[2], points[0])),
      length = Math.hypot(...n);
    if (!(length > tolerance ** 2)) return null;
    return {
      points,
      normal: n.map(value => value / length) as MeasureVec3,
      low: [0, 1, 2].map(axis => Math.min(...points.map(p => p[axis]!))) as MeasureVec3,
      high: [0, 1, 2].map(axis => Math.max(...points.map(p => p[axis]!))) as MeasureVec3,
    };
  });
  const result = { indices, values, tolerance, faces: new Map<number, FaceEntity>() };
  triangles.set(positions, result);
  return result;
}

/** Whether two collinear finite edges share a nonzero span, including a triangulation T-junction. */
function sharedEdge(a: Triangle, b: Triangle, tolerance: number) {
  if ([0, 1, 2].some(axis => a.low[axis]! > b.high[axis]! + tolerance || b.low[axis]! > a.high[axis]! + tolerance)) return false;
  return edges(a.points).some(([p, q]) => {
    const ab = sub(q, p),
      length = Math.hypot(...ab),
      unit = ab.map(value => value / length) as MeasureVec3;
    return edges(b.points).some(([r, s]) => {
      if (Math.hypot(...cross(sub(r, p), unit)) > tolerance || Math.hypot(...cross(sub(s, p), unit)) > tolerance) return false;
      const first = dot(sub(r, p), unit),
        second = dot(sub(s, p), unit);
      return Math.min(length, Math.max(first, second)) - Math.max(0, Math.min(first, second)) > tolerance;
    });
  });
}

/** The finite connected planar face under an actual mesh triangle, preserving its holes and disconnected islands. */
export function planarMeasurementFace(positions: Float32Array, indices: ArrayLike<number>, triangleIndex: number): FaceEntity | null {
  const source = triangleSource({ positions, indices }),
    seed = source.values[triangleIndex];
  if (!seed) return null;
  const cached = source.faces.get(triangleIndex);
  if (cached) return cached;
  const candidates = source.values.flatMap((triangle, index) =>
    triangle &&
    Math.abs(dot(seed.normal, triangle.normal)) > 1 - 1e-8 &&
    triangle.points.every(point => Math.abs(dot(seed.normal, sub(point, seed.points[0]))) <= source.tolerance)
      ? [{ triangle, index }]
      : []
  );
  const selected = new Map<number, Triangle>([[triangleIndex, seed]]),
    pending = [seed];
  for (let at = 0; at < pending.length; at++) {
    const next = pending[at]!;
    for (const { triangle, index } of candidates) {
      if (selected.has(index) || !sharedEdge(next, triangle, source.tolerance)) continue;
      selected.set(index, triangle);
      pending.push(triangle);
    }
  }
  // A face keeps one identity when clicked on another of its triangles.
  const ordered = [...selected.entries()].sort(([a], [b]) => a - b).map(([, triangle]) => triangle);
  const result: FaceEntity = { kind: 'face', triangles: ordered.map(t => t.points), normal: ordered[0]!.normal };
  for (const index of selected.keys()) source.faces.set(index, result);
  return result;
}

function inTriangle(point: MeasureVec3, triangle: MeasureTriangle, tolerance: number) {
  const u = sub(triangle[1], triangle[0]),
    v = sub(triangle[2], triangle[0]),
    w = sub(point, triangle[0]);
  const uu = dot(u, u),
    uv = dot(u, v),
    vv = dot(v, v),
    wu = dot(w, u),
    wv = dot(w, v),
    denominator = uu * vv - uv * uv;
  const a = (wu * vv - wv * uv) / denominator,
    b = (wv * uu - wu * uv) / denominator;
  const length = Math.max(Math.hypot(...u), Math.hypot(...v), 1);
  return a >= -tolerance / length && b >= -tolerance / length && a + b <= 1 + tolerance / length;
}

/**
 * Vertex, straight edge, or planar face at a click. Only real feature-edge endpoints count as vertices, so a
 * triangulation split or a mate connector's face-middle never becomes a vertex measurement.
 */
export function measurementEntityAt(
  positions: Float32Array,
  indices: ArrayLike<number>,
  triangleIndex: number,
  screen: Projection,
  tolerance = 8
): MeasureEntity | null {
  const face = planarMeasurementFace(positions, indices, triangleIndex);
  if (!face) return null;
  const accuracy = triangleSource({ positions, indices }).tolerance;
  const onFace = (p: MeasureVec3) =>
    Math.abs(dot(face.normal, sub(p, face.triangles[0]![0]))) <= accuracy && face.triangles.some(t => inTriangle(p, t, accuracy));
  // Restrict candidates to the clicked face; an occluded/backside corner can otherwise project over the click.
  const allowed = (a: MeasureVec3, b: MeasureVec3) => {
    const middle = a.map((value, i) => (value + b[i]!) / 2) as MeasureVec3;
    if (!onFace(a) || !onFace(b) || !onFace(middle)) return false;
    const across = cross(face.normal, sub(b, a)),
      length = Math.hypot(...across);
    if (!(length > accuracy)) return false;
    const side = (sign: number) => middle.map((value, i) => value + (sign * across[i]! * accuracy * 4) / length) as MeasureVec3;
    // Unmatched edges in a T-junction triangulation can look like feature edges. A real face boundary has material
    // on exactly one side; a triangulation seam has material on both and must not supply edges or false vertices.
    return onFace(side(1)) !== onFace(side(-1));
  };
  let candidates = faceEdges.get(face);
  if (!candidates) {
    const boundary = new Map<string, { edge: ModelEdge; count: number }>();
    for (const triangle of face.triangles)
      for (const [a, b] of edges(triangle)) {
        const key = [a.join(','), b.join(',')].sort().join('/'),
          old = boundary.get(key);
        if (old) old.count++;
        else boundary.set(key, { edge: { a, b }, count: 1 });
      }
    // These segments belong to this finite face only. Joining edges from the whole mesh would cross a corner into
    // a different coplanar island and make the clicked face's shorter edge and shared corner unpickable.
    candidates = {
      edges: joinStraightEdges([...boundary.values()].filter(item => item.count === 1).map(item => item.edge)),
      valid: new Map(),
    };
    faceEdges.set(face, candidates);
  }
  const valid = (edge: ModelEdge) => {
    const known = candidates.valid.get(edge);
    if (known !== undefined) return known;
    const result = allowed(edge.a, edge.b);
    candidates.valid.set(edge, result);
    return result;
  };
  // A distant boundary cannot be selected. Validate only nearby candidates, rather than testing every pin-pocket
  // edge against every triangle before showing the face under an ordinary center click.
  const vertices: { point: MeasureVec3; edge: ModelEdge; distance: number }[] = [];
  for (const edge of candidates.edges) {
    const { a, b } = edge;
    for (const point of [a, b]) {
      const distance = screen.point(point);
      if (distance <= tolerance) vertices.push({ point, edge, distance });
    }
  }
  vertices.sort((a, b) => a.distance - b.distance);
  const vertex = vertices.find(vertex => valid(vertex.edge));
  if (vertex) return { kind: 'vertex', point: vertex.point };
  const nearby: { edge: ModelEdge; distance: number }[] = [];
  for (const edge of candidates.edges) {
    const { a, b } = edge;
    const distance = screen.segment(a, b);
    if (distance <= tolerance) nearby.push({ edge, distance });
  }
  nearby.sort((a, b) => a.distance - b.distance);
  const edge = nearby.find(candidate => valid(candidate.edge))?.edge;
  return edge ? { kind: 'edge', a: edge.a, b: edge.b } : face;
}
