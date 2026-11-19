import type { MeasureEntity, MeasureTriangle, MeasureVec3 } from '@/cad/measureGeometry';

/** Neighbouring facets of a tessellated round meet at a few degrees; a real crease (a chamfer, a corner) is steeper. */
const kSmoothTurn = (25 * Math.PI) / 180;

type Facet = { points: MeasureTriangle; normal: MeasureVec3 };
type RoundFace = Extract<MeasureEntity, { kind: 'face' }>;
type CurvedSource = { facets: (Facet | null)[]; byEdge: Map<string, number[]>; keys: string[][]; rounds: Map<number, RoundFace | null> };
const sources = new WeakMap<Float32Array, { indices: ArrayLike<number>; source: CurvedSource }>();

const sub = (a: MeasureVec3, b: MeasureVec3): MeasureVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: MeasureVec3, b: MeasureVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: MeasureVec3, b: MeasureVec3): MeasureVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: MeasureVec3): MeasureVec3 => {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
};
const triangleArea = ([a, b, c]: MeasureTriangle) => Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
const edgeKey = (a: string, b: string) => (a < b ? `${a}/${b}` : `${b}/${a}`);

function curvedSource(positions: Float32Array, indices: ArrayLike<number>): CurvedSource {
  const previous = sources.get(positions);
  if (previous?.indices === indices) return previous.source;
  let reach = 1;
  for (const value of positions) reach = Math.max(reach, Math.abs(value));
  // Facets of one surface share their vertices; the grid only absorbs Float32 placement rounding.
  const grid = reach * 1e-6;
  const key = (p: MeasureVec3) => p.map(value => Math.round(value / grid)).join(',');
  const facets: (Facet | null)[] = [],
    keys: string[][] = [],
    byEdge = new Map<string, number[]>();
  for (let i = 0; i * 3 + 2 < indices.length; i++) {
    const points = [0, 1, 2].map(k => {
      const j = indices[i * 3 + k]! * 3;
      return [positions[j]!, positions[j + 1]!, positions[j + 2]!] as MeasureVec3;
    }) as MeasureTriangle;
    const n = cross(sub(points[1], points[0]), sub(points[2], points[0])),
      length = Math.hypot(...n);
    facets.push(length > grid * grid ? { points, normal: [n[0] / length, n[1] / length, n[2] / length] } : null);
    const vertexKeys = points.map(key);
    keys.push(vertexKeys);
    for (let k = 0; k < 3; k++) {
      const edge = edgeKey(vertexKeys[k]!, vertexKeys[(k + 1) % 3]!);
      const list = byEdge.get(edge);
      if (list) list.push(i);
      else byEdge.set(edge, [i]);
    }
  }
  const source = { facets, byEdge, keys, rounds: new Map<number, RoundFace | null>() };
  sources.set(positions, { indices, source });
  return source;
}

function neighbours(source: CurvedSource, index: number) {
  const keys = source.keys[index]!,
    result: number[] = [];
  for (let k = 0; k < 3; k++)
    for (const other of source.byEdge.get(edgeKey(keys[k]!, keys[(k + 1) % 3]!)) ?? []) if (other !== index) result.push(other);
  return result;
}

/** Two unit directions across `axis`, square to it and to each other. */
function planeAxes(axis: MeasureVec3): [MeasureVec3, MeasureVec3] {
  const across = unit(Math.abs(axis[0]) < 0.9 ? cross(axis, [1, 0, 0]) : cross(axis, [0, 1, 0]));
  return [across, cross(axis, across)];
}

/** Least-squares circle through points already projected onto the plane across the axis. */
function fitCircle(points: [number, number][]) {
  let mx = 0,
    my = 0;
  for (const [x, y] of points) {
    mx += x / points.length;
    my += y / points.length;
  }
  let suu = 0,
    suv = 0,
    svv = 0,
    a = 0,
    b = 0;
  for (const [x, y] of points) {
    const u = x - mx,
      v = y - my;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    a += (u * u * u + u * v * v) / 2;
    b += (v * v * v + v * u * u) / 2;
  }
  const determinant = suu * svv - suv * suv;
  if (!(Math.abs(determinant) > 0)) return null;
  const center: [number, number] = [(a * svv - b * suv) / determinant + mx, (b * suu - a * suv) / determinant + my];
  const radii = points.map(([x, y]) => Math.hypot(x - center[0], y - center[1]));
  const radius = radii.reduce((sum, r) => sum + r, 0) / radii.length;
  return { center, radius, spread: Math.max(...radii.map(r => Math.abs(r - radius))) };
}

/**
 * The whole round side (a cylinder wall, a fillet) under a clicked facet of its tessellation, or null for a flat face.
 * Without it a click on the wall picks one facet and measures the straight seam beside it: the wall's height.
 */
export function cylinderMeasurementFace(positions: Float32Array, indices: ArrayLike<number>, triangleIndex: number): RoundFace | null {
  const source = curvedSource(positions, indices);
  // Every facet of one wall gives the same face, so picking it again elsewhere is recognised as the same selection.
  if (!source.rounds.has(triangleIndex)) source.rounds.set(triangleIndex, roundFace(source, triangleIndex));
  return source.rounds.get(triangleIndex)!;
}

function roundFace(source: CurvedSource, triangleIndex: number): RoundFace | null {
  const seed = source.facets[triangleIndex];
  if (!seed) return null;
  let axis: MeasureVec3 | null = null;
  const members = new Set([triangleIndex]),
    queue = [triangleIndex];
  for (let at = 0; at < queue.length; at++) {
    const facet = source.facets[queue[at]!]!;
    for (const other of neighbours(source, queue[at]!)) {
      const candidate = source.facets[other];
      if (!candidate || members.has(other)) continue;
      const turn = Math.acos(Math.min(1, Math.max(-1, dot(facet.normal, candidate.normal))));
      if (turn > kSmoothTurn) continue;
      if (axis) {
        if (Math.abs(dot(candidate.normal, axis)) > 1e-3) continue;
      } else if (turn > 1e-4) axis = unit(cross(facet.normal, candidate.normal));
      else if (dot(candidate.normal, seed.normal) < 1 - 1e-9) continue;
      members.add(other);
      queue.push(other);
    }
  }
  if (!axis) return null;
  const sorted = [...members].sort((a, b) => a - b),
    turned = sorted.map(index => source.facets[index]!);
  // At least three distinct facet directions: two planes meeting at a shallow crease are not a round.
  const directions: MeasureVec3[] = [];
  for (const facet of turned) if (!directions.some(d => dot(d, facet.normal) > 1 - 1e-6)) directions.push(facet.normal);
  if (directions.length < 3) return null;
  const [across, other] = planeAxes(axis);
  const circle = fitCircle(turned.flatMap(facet => facet.points.map(p => [dot(p, across), dot(p, other)] as [number, number])));
  if (!circle || !(circle.radius > 0) || circle.spread > circle.radius * 0.01) return null;
  const heights = turned.flatMap(facet => facet.points.map(p => dot(p, axis!)));
  const middle = (Math.min(...heights) + Math.max(...heights)) / 2;
  const center = [0, 1, 2].map(i => across[i]! * circle.center[0] + other[i]! * circle.center[1] + axis![i]! * middle) as MeasureVec3;
  // A facet is the chord of its arc; scaling by arc over chord gives the round surface's own area.
  let area = 0;
  for (const facet of turned) {
    const angles = facet.points.map(p => Math.atan2(dot(p, other) - circle.center[1], dot(p, across) - circle.center[0]));
    let span = 0;
    for (const a of angles) for (const b of angles) span = Math.max(span, Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))));
    area += triangleArea(facet.points) * (span > 1e-9 ? span / (2 * Math.sin(span / 2)) : 1);
  }
  const face: RoundFace = {
    kind: 'face',
    triangles: turned.map(facet => facet.points),
    normal: axis,
    area,
    cylinder: { axis, center, radius: circle.radius },
  };
  for (const index of sorted) source.rounds.set(index, face);
  return face;
}

/**
 * A flat face's area with its round boundaries (a disc, a round hole) taken as the true circle rather than the
 * inscribed polygon the tessellation draws. Undefined when the face has no round boundary.
 */
export function planarFaceArea(triangles: readonly MeasureTriangle[], normal: MeasureVec3): number | undefined {
  const [across, other] = planeAxes(normal);
  let area = 0,
    round = false;
  for (const triangle of triangles) area += triangleArea(triangle);
  const id = (p: MeasureVec3) => p.join(',');
  const count = new Map<string, number>();
  for (const triangle of triangles)
    for (let k = 0; k < 3; k++) {
      const edge = edgeKey(id(triangle[k]!), id(triangle[(k + 1) % 3]!));
      count.set(edge, (count.get(edge) ?? 0) + 1);
    }
  const next = new Map<string, [MeasureVec3, MeasureVec3]>();
  for (const triangle of triangles)
    for (let k = 0; k < 3; k++) {
      const a = triangle[k]!,
        b = triangle[(k + 1) % 3]!;
      if (count.get(edgeKey(id(a), id(b))) === 1) next.set(id(a), [a, b]);
    }
  const used = new Set<string>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: MeasureVec3[] = [];
    let at = start;
    while (!used.has(at) && next.has(at)) {
      used.add(at);
      const [a, b] = next.get(at)!;
      loop.push(a);
      at = id(b);
    }
    if (at !== start || loop.length < 8) continue;
    const circle = fitCircle(loop.map(p => [dot(p, across), dot(p, other)]));
    if (!circle || circle.spread > circle.radius * 1e-3) continue;
    const radius = circle.radius;
    let signed = 0;
    for (let i = 0; i < loop.length; i++)
      signed += dot(cross(sub(loop[i]!, loop[0]!), sub(loop[(i + 1) % loop.length]!, loop[0]!)), normal) / 2;
    // The face's winding runs around its outer boundary one way and around its holes the other.
    area += Math.sign(signed) * (Math.PI * radius * radius - Math.abs(signed));
    round = true;
  }
  return round ? area : undefined;
}
