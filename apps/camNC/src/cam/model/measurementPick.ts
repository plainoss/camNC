import type { MeasureEntity, MeasureTriangle, MeasureVec3 } from '@/cad/measureGeometry';
import { joinStraightEdges, type ModelEdge } from './edgePick';
import { measurementTriangleIndex } from './measurementTriangleIndex';

/** A geometry selection in assembly coordinates; the workspace resolves its mesh index to the exact physical copy. */
export interface ModelMeasurePick {
  partId: string;
  index: number;
  entity: MeasureEntity;
  additive: boolean;
}

type MeshSource = { positions: Float32Array; indices: ArrayLike<number> };
type Triangle = {
  points: MeasureTriangle;
  normal: MeasureVec3;
  areaVector: MeasureVec3;
  areaMagnitude: number;
  areaError: MeasureVec3;
  errors: MeasureTriangle;
  normalUncertainty: number | null;
  low: MeasureVec3;
  high: MeasureVec3;
};
type FaceEntity = Extract<MeasureEntity, { kind: 'face' }>;
type Projection = { point: (p: MeasureVec3) => number; segment: (a: MeasureVec3, b: MeasureVec3) => number };
interface TriangleSource {
  indices: ArrayLike<number>;
  values: (Triangle | null)[];
  tolerance: number;
  faces: Map<number, FaceEntity>;
  nearby: ReturnType<typeof measurementTriangleIndex>;
  neighbors: Map<number, number[]>;
}
const triangles = new WeakMap<Float32Array, TriangleSource>();
const faceEdges = new WeakMap<FaceEntity, { edges: readonly ModelEdge[]; valid: Map<ModelEdge, boolean> }>();
const facePlanes = new WeakMap<FaceEntity, Triangle>();

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

/** Half a Float32 ULP encloses the original coordinate's round-to-nearest bin, including zero/subnormals. */
const roundingError = (point: MeasureVec3): MeasureVec3 =>
  point.map(value => Math.max(2 ** -150, 2 ** (Math.floor(Math.log2(Math.abs(value))) - 24))) as MeasureVec3;

function crossError(u: MeasureVec3, v: MeasureVec3, du: MeasureVec3, dv: MeasureVec3): MeasureVec3 {
  const product = (j: number, k: number) => Math.abs(u[j]!) * dv[k]! + Math.abs(v[k]!) * du[j]! + du[j]! * dv[k]!;
  const gamma3 = (3 * Number.EPSILON) / (2 - 3 * Number.EPSILON);
  const component = (j: number, k: number) => product(j, k) + product(k, j) + gamma3 * (Math.abs(u[j]! * v[k]!) + Math.abs(u[k]! * v[j]!));
  return [component(1, 2), component(2, 0), component(0, 1)];
}

function triangleSource({ positions, indices }: MeshSource) {
  const previous = triangles.get(positions);
  if (previous?.indices === indices) return previous;
  let reach = 1;
  for (const value of positions) reach = Math.max(reach, Math.abs(value));
  // Mesh coordinates are Float32 after a rigid placement. The tolerance admits that rounding without merging
  // separately placed surfaces: a face still needs a shared geometric edge and compatible supporting planes.
  const tolerance = reach * 2e-7;
  const values = Array.from({ length: Math.floor(indices.length / 3) }, (_, i): Triangle | null => {
    const points = [0, 1, 2].map(k => {
      const j = indices[i * 3 + k]! * 3;
      return [positions[j]!, positions[j + 1]!, positions[j + 2]!] as MeasureVec3;
    }) as MeasureTriangle;
    if (!points.flat().every(Number.isFinite)) return null;
    const ab = sub(points[1], points[0]),
      ac = sub(points[2], points[0]),
      n = cross(ab, ac),
      length = Math.hypot(...n);
    if (!(length > tolerance ** 2)) return null;
    // Each edge component's error is the sum of its endpoint bins. Propagate those intervals through the two
    // products in each cross component. The error radius divided by |cross| bounds the sine of the normal error:
    // skinny triangles need more angular allowance than broad ones after the same rigid Float32 placement.
    const errors = points.map(roundingError) as MeasureTriangle;
    const differenceError = (end: number) =>
      errors[0].map(
        (value, axis) => value + errors[end]![axis]! + Number.EPSILON * (Math.abs(points[0][axis]!) + Math.abs(points[end]![axis]!))
      ) as MeasureVec3;
    const abError = differenceError(1),
      acError = differenceError(2);
    const areaError = crossError(ab, ac, abError, acError),
      normalError = Math.hypot(...areaError);
    return {
      points,
      normal: n.map(value => value / length) as MeasureVec3,
      areaVector: n,
      areaMagnitude: length,
      areaError,
      errors,
      normalUncertainty: normalError < length ? Math.asin(normalError / length) : null,
      low: [0, 1, 2].map(axis => Math.min(...points.map(p => p[axis]!))) as MeasureVec3,
      high: [0, 1, 2].map(axis => Math.max(...points.map(p => p[axis]!))) as MeasureVec3,
    };
  });
  const result = {
    indices,
    values,
    tolerance,
    faces: new Map<number, FaceEntity>(),
    nearby: measurementTriangleIndex(values),
    neighbors: new Map<number, number[]>(),
  };
  triangles.set(positions, result);
  return result;
}

/** Whether two collinear finite edges share a nonzero span, including a triangulation T-junction. */
function sharedEdge(a: Triangle, b: Triangle, tolerance: number) {
  for (let axis = 0; axis < 3; axis++) {
    if (a.low[axis]! > b.high[axis]! + tolerance || b.low[axis]! > a.high[axis]! + tolerance) return false;
  }
  // The adjacency broad phase calls this often. Scalar squared line distances avoid allocating vectors for every
  // rejected pair while retaining the same collinearity tolerance and finite nonzero overlap requirement.
  for (let firstEdge = 0; firstEdge < 3; firstEdge++) {
    const p = a.points[firstEdge]!,
      q = a.points[(firstEdge + 1) % 3]!;
    const x = q[0] - p[0],
      y = q[1] - p[1],
      z = q[2] - p[2];
    const squared = x * x + y * y + z * z,
      length = Math.sqrt(squared);
    if (length <= tolerance) continue;
    const threshold = tolerance * tolerance * squared;
    for (let secondEdge = 0; secondEdge < 3; secondEdge++) {
      const r = b.points[secondEdge]!,
        s = b.points[(secondEdge + 1) % 3]!;
      const rx = r[0] - p[0],
        ry = r[1] - p[1],
        rz = r[2] - p[2];
      const rcx = ry * z - rz * y,
        rcy = rz * x - rx * z,
        rcz = rx * y - ry * x;
      if (rcx * rcx + rcy * rcy + rcz * rcz > threshold) continue;
      const sx = s[0] - p[0],
        sy = s[1] - p[1],
        sz = s[2] - p[2];
      const scx = sy * z - sz * y,
        scy = sz * x - sx * z,
        scz = sx * y - sy * x;
      if (scx * scx + scy * scy + scz * scz > threshold) continue;
      const first = (rx * x + ry * y + rz * z) / length,
        second = (sx * x + sy * y + sz * z) / length;
      if (Math.min(length, Math.max(first, second)) - Math.max(0, Math.min(first, second)) > tolerance) return true;
    }
  }
  return false;
}

function onPlane(triangle: Triangle, point: MeasureVec3, tolerance = 0, error = roundingError(point)) {
  const w = sub(point, triangle.points[0]);
  let bound = 0,
    arithmetic = 0;
  for (let axis = 0; axis < 3; axis++) {
    const ew = error[axis]! + triangle.errors[0][axis]! + Number.EPSILON * (Math.abs(point[axis]!) + Math.abs(triangle.points[0][axis]!));
    const n = triangle.areaVector[axis]!,
      en = triangle.areaError[axis]!;
    // Expanding (n+δn)·(w+δw)=0 bounds its unnormalized residual by Σ(En|w| + |n|Ew + EnEw).
    bound += en * Math.abs(w[axis]!) + Math.abs(n) * ew + en * ew;
    arithmetic += Math.abs(n * w[axis]!);
  }
  const rounding = Number.EPSILON * 16 * (arithmetic + bound);
  return Math.abs(dot(triangle.areaVector, w)) <= Math.max(bound + rounding, triangle.areaMagnitude * tolerance);
}

function compatibleNormals(a: Triangle, b: Triangle) {
  const similarity = Math.abs(dot(a.normal, b.normal));
  if (similarity >= 1) return true;
  const uncertainty = a.normalUncertainty === null || b.normalUncertainty === null ? Infinity : a.normalUncertainty + b.normalUncertainty;
  // When the normal cones reach a right angle they cannot distinguish a planar join from a sharp crease. Permit
  // no geometric angular slack then; identical stored normals still work. The final term covers the normalized dot.
  return similarity >= Math.cos(uncertainty < Math.PI / 2 ? uncertainty : 0) - Number.EPSILON * 8;
}

function samePlane(a: Triangle, b: Triangle) {
  return (
    compatibleNormals(a, b) &&
    b.points.every((point, index) => onPlane(a, point, 0, b.errors[index])) &&
    a.points.every((point, index) => onPlane(b, point, 0, a.errors[index]))
  );
}

function triangleNeighbors(source: TriangleSource, index: number) {
  const previous = source.neighbors.get(index);
  if (previous) return previous;
  const triangle = source.values[index]!;
  const result = source
    .nearby(triangle.points, source.tolerance)
    .filter(other => {
      if (other === index) return false;
      const candidate = source.values[other]!;
      if (!compatibleNormals(triangle, candidate)) return false;
      // A short T-junction segment may not resolve the direction of its longer neighbor equally well. The finite
      // overlap test is symmetric so a component cannot depend on which triangle's adjacency is queried first.
      return (
        (sharedEdge(triangle, candidate, source.tolerance) || sharedEdge(candidate, triangle, source.tolerance)) &&
        samePlane(triangle, candidate)
      );
    })
    .sort((a, b) => a - b);
  source.neighbors.set(index, result);
  return result;
}

/** The finite connected planar face under an actual mesh triangle, preserving its holes and disconnected islands. */
export function planarMeasurementFace(positions: Float32Array, indices: ArrayLike<number>, triangleIndex: number): FaceEntity | null {
  const source = triangleSource({ positions, indices }),
    seed = source.values[triangleIndex];
  if (!seed) return null;
  const cached = source.faces.get(triangleIndex);
  if (cached) return cached;
  const component = new Set([triangleIndex]),
    pending = [triangleIndex];
  for (let at = 0; at < pending.length; at++) {
    const index = pending[at]!;
    for (const other of triangleNeighbors(source, index)) {
      if (component.has(other)) continue;
      component.add(other);
      pending.push(other);
    }
  }
  // Precision compatibility is symmetric but not transitive. Partition the whole compatible adjacency component
  // in source-index order, keeping each final group relative to one fixed representative. This prevents curve drift,
  // overlapping cached faces and a first click on another triangle changing the selection's area or identity.
  const ordered = [...component].sort((a, b) => a - b),
    remaining = new Set(ordered);
  for (const representative of ordered) {
    if (!remaining.has(representative)) continue;
    const plane = source.values[representative]!;
    const candidates = new Set(ordered.filter(index => remaining.has(index) && samePlane(plane, source.values[index]!)));
    const selected = new Set([representative]),
      queue = [representative];
    for (let at = 0; at < queue.length; at++) {
      for (const neighbor of triangleNeighbors(source, queue[at]!)) {
        if (!candidates.has(neighbor) || selected.has(neighbor)) continue;
        selected.add(neighbor);
        queue.push(neighbor);
      }
    }
    const members = [...selected].sort((a, b) => a - b);
    const result: FaceEntity = { kind: 'face', triangles: members.map(index => source.values[index]!.points), normal: plane.normal };
    facePlanes.set(result, plane);
    for (const index of selected) {
      remaining.delete(index);
      source.faces.set(index, result);
    }
  }
  return source.faces.get(triangleIndex)!;
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
  const onFace = (p: MeasureVec3) => onPlane(facePlanes.get(face)!, p, accuracy) && face.triangles.some(t => inTriangle(p, t, accuracy));
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
