/** Coordinates in the assembly's millimetre frame, before exploded/flat display offsets. */
export type MeasureVec3 = [number, number, number];
export type MeasureTriangle = [MeasureVec3, MeasureVec3, MeasureVec3];
/** A planar face contains only its actual material triangles, including the boundaries around holes. */
export type MeasureEntity =
  | { kind: 'vertex'; point: MeasureVec3 }
  | { kind: 'edge'; a: MeasureVec3; b: MeasureVec3 }
  | { kind: 'face'; triangles: MeasureTriangle[]; normal: MeasureVec3 };

export interface MeasureWitness {
  a: MeasureVec3;
  b: MeasureVec3;
}
export interface MeasureRow {
  id: string;
  label: string;
  /** Millimetres, square millimetres or degrees, before display-unit conversion. */
  value: number;
  kind: 'length' | 'area' | 'angle' | 'position';
  axis?: 'x' | 'y' | 'z';
  witness?: MeasureWitness;
}
export interface MeasureResult {
  rows: MeasureRow[];
  /** Straight edges only; their direction is not tied to the arbitrary order of their endpoints. */
  parallel?: boolean;
  problem?: string;
}

const add = (a: MeasureVec3, b: MeasureVec3): MeasureVec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: MeasureVec3, b: MeasureVec3): MeasureVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v: MeasureVec3, s: number): MeasureVec3 => [v[0] * s, v[1] * s, v[2] * s];
const dot = (a: MeasureVec3, b: MeasureVec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: MeasureVec3, b: MeasureVec3): MeasureVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (v: MeasureVec3): number => Math.hypot(...v);
const distance = (a: MeasureVec3, b: MeasureVec3): number => length(sub(a, b));
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const at = (a: MeasureVec3, b: MeasureVec3, t: number): MeasureVec3 => add(a, scale(sub(b, a), t));
const finitePoint = (point: MeasureVec3): boolean => point.length === 3 && point.every(Number.isFinite);
const triangleArea = ([a, b, c]: MeasureTriangle): number => length(cross(sub(b, a), sub(c, a))) / 2;
const pointsOf = (entity: MeasureEntity): MeasureVec3[] =>
  entity.kind === 'vertex' ? [entity.point] : entity.kind === 'edge' ? [entity.a, entity.b] : entity.triangles.flat();
const edgesOf = ([a, b, c]: MeasureTriangle): [MeasureVec3, MeasureVec3][] => [
  [a, b],
  [b, c],
  [c, a],
];
const swapped = ({ a, b }: MeasureWitness): MeasureWitness => ({ a: b, b: a });

/** Stable ties avoid jumping between equivalent witnesses as the same geometry is selected again. */
function before(a: MeasureWitness, b: MeasureWitness): boolean {
  const aa = [...a.a, ...a.b],
    bb = [...b.a, ...b.b];
  for (let i = 0; i < aa.length; i++) {
    if (aa[i]! < bb[i]!) return true;
    if (aa[i]! > bb[i]!) return false;
  }
  return false;
}

function prefer(candidate: MeasureWitness, best: MeasureWitness | null, maximum = false): boolean {
  if (!best) return true;
  const next = distance(candidate.a, candidate.b),
    previous = distance(best.a, best.b);
  // A relative machine-roundoff comparison resolves arithmetic ties, without treating a real nonzero gap as zero.
  const roundoff = Number.EPSILON * 16 * Math.max(next, previous);
  if (Math.abs(next - previous) <= roundoff) return before(candidate, best);
  return maximum ? next > previous : next < previous;
}

function nearestPointOnSegment(point: MeasureVec3, a: MeasureVec3, b: MeasureVec3): MeasureVec3 {
  const ab = sub(b, a),
    span = dot(ab, ab);
  return span ? at(a, b, clamp(dot(sub(point, a), ab) / span)) : a;
}

/** The closest pair on two finite segments, including zero-length, parallel and endpoint-clamped segments. */
function segmentPair(a: MeasureVec3, b: MeasureVec3, c: MeasureVec3, d: MeasureVec3): MeasureWitness {
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(a, c),
    uu = dot(u, u),
    vv = dot(v, v),
    vw = dot(v, w);
  if (!uu) return { a, b: nearestPointOnSegment(a, c, d) };
  if (!vv) return { a: nearestPointOnSegment(c, a, b), b: c };
  const uw = dot(u, w),
    uv = dot(u, v),
    normal = cross(u, v),
    denominator = dot(normal, normal);
  // Parallel segments have infinitely many supporting-line solutions. Endpoint projections below retain their finite extent.
  // The cross-product denominator avoids subtracting two almost equal squared dot products for near-parallel lines.
  let s = denominator ? clamp(dot(cross(v, w), normal) / denominator) : 0;
  let t = (uv * s + vw) / vv;
  if (t < 0) {
    t = 0;
    s = clamp(-uw / uu);
  } else if (t > 1) {
    t = 1;
    s = clamp((uv - uw) / uu);
  }
  let best: MeasureWitness = { a: at(a, b, s), b: at(c, d, t) };
  // These also choose a deterministic witness when parallel segments overlap in projection.
  for (const pair of [
    { a, b: nearestPointOnSegment(a, c, d) },
    { a: b, b: nearestPointOnSegment(b, c, d) },
    { a: nearestPointOnSegment(c, a, b), b: c },
    { a: nearestPointOnSegment(d, a, b), b: d },
  ])
    if (prefer(pair, best)) best = pair;
  return best;
}

/** Closest point on a triangle's occupied surface, rather than its bounding box or infinite plane. */
function nearestPointOnTriangle(point: MeasureVec3, [a, b, c]: MeasureTriangle): MeasureVec3 {
  const ab = sub(b, a),
    ac = sub(c, a);
  const normal = cross(ab, ac),
    span = length(normal);
  if (span) {
    const unit = scale(normal, 1 / span),
      projected = sub(point, scale(unit, dot(sub(point, a), unit)));
    // Cross-product half-spaces retain skinny triangle interiors where a barycentric dot determinant cancels to zero.
    if (insideTriangle(projected, [a, b, c], unit)) return projected;
  }
  let best = a;
  for (const [start, end] of [
    [a, b],
    [b, c],
    [c, a],
  ] as const) {
    const candidate = nearestPointOnSegment(point, start, end);
    if (prefer({ a: point, b: candidate }, { a: point, b: best })) best = candidate;
  }
  return best;
}

const insideTriangle = (point: MeasureVec3, triangle: MeasureTriangle, normal: MeasureVec3): boolean =>
  edgesOf(triangle).every(([a, b]) => dot(cross(sub(b, a), sub(point, a)), normal) >= 0);

function segmentTriangleIntersection(a: MeasureVec3, b: MeasureVec3, [p, q, r]: MeasureTriangle): MeasureVec3 | null {
  const pq = sub(q, p),
    pr = sub(r, p),
    normal = cross(pq, pr),
    direction = sub(b, a),
    denominator = dot(normal, direction);
  // Coplanar intersections are found by the endpoint/edge distance cases, so no arbitrary tolerance fills a real gap.
  if (!denominator) return null;
  const t = dot(normal, sub(p, a)) / denominator;
  if (t < 0 || t > 1) return null;
  const point = at(a, b, t);
  return insideTriangle(point, [p, q, r], normal) ? point : null;
}

function segmentTrianglePair(a: MeasureVec3, b: MeasureVec3, triangle: MeasureTriangle): MeasureWitness {
  const intersection = segmentTriangleIntersection(a, b, triangle);
  if (intersection) return { a: intersection, b: intersection };
  let best: MeasureWitness = { a, b: nearestPointOnTriangle(a, triangle) };
  const end = { a: b, b: nearestPointOnTriangle(b, triangle) };
  if (prefer(end, best)) best = end;
  for (const [p, q] of edgesOf(triangle)) {
    const candidate = segmentPair(a, b, p, q);
    if (prefer(candidate, best)) best = candidate;
  }
  return best;
}

function minimumPair(first: MeasureEntity, second: MeasureEntity): MeasureWitness {
  if (first.kind === 'vertex') {
    const a = first.point;
    if (second.kind === 'vertex') return { a, b: second.point };
    if (second.kind === 'edge') return { a, b: nearestPointOnSegment(a, second.a, second.b) };
    let best: MeasureWitness | null = null;
    for (const triangle of second.triangles) {
      const candidate = { a, b: nearestPointOnTriangle(a, triangle) };
      if (prefer(candidate, best)) best = candidate;
    }
    return best!;
  }
  if (second.kind === 'vertex') return swapped(minimumPair(second, first));
  if (first.kind === 'edge') {
    if (second.kind === 'edge') return segmentPair(first.a, first.b, second.a, second.b);
    let best: MeasureWitness | null = null;
    for (const triangle of second.triangles) {
      const candidate = segmentTrianglePair(first.a, first.b, triangle);
      if (prefer(candidate, best)) best = candidate;
    }
    return best!;
  }
  if (second.kind === 'edge') return swapped(minimumPair(second, first));
  return facePair(first.triangles, second.triangles);
}

interface Bounds {
  low: MeasureVec3;
  high: MeasureVec3;
}
type TriangleTree = Bounds & ({ triangles: MeasureTriangle[] } | { left: TriangleTree; right: TriangleTree });
const boundsOf = (points: MeasureVec3[]): Bounds => {
  const low: MeasureVec3 = [Infinity, Infinity, Infinity],
    high: MeasureVec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points)
    for (const axis of [0, 1, 2]) {
      low[axis] = Math.min(low[axis]!, point[axis]!);
      high[axis] = Math.max(high[axis]!, point[axis]!);
    }
  return { low, high };
};
const boundsDistance = (a: Bounds, b: Bounds): number =>
  Math.hypot(...[0, 1, 2].map(axis => Math.max(0, a.low[axis]! - b.high[axis]!, b.low[axis]! - a.high[axis]!)));

function triangleTree(triangles: MeasureTriangle[]): TriangleTree {
  const records = triangles.map(triangle => ({ triangle, ...boundsOf(triangle) }));
  const build = (items: typeof records): TriangleTree => {
    const bounds = boundsOf(items.flatMap(item => [item.low, item.high]));
    if (items.length <= 6) return { ...bounds, triangles: items.map(item => item.triangle) };
    const sizes = sub(bounds.high, bounds.low),
      axis = sizes.indexOf(Math.max(...sizes));
    items.sort((a, b) => a.low[axis]! + a.high[axis]! - b.low[axis]! - b.high[axis]!);
    const middle = Math.floor(items.length / 2);
    return { ...bounds, left: build(items.slice(0, middle)), right: build(items.slice(middle)) };
  };
  return build(records);
}

/** Spatial bounds prune distant triangle pairs without replacing the finite occupied-surface distance check. */
function facePair(first: MeasureTriangle[], second: MeasureTriangle[]): MeasureWitness {
  let best: MeasureWitness | null = null;
  const visit = (a: TriangleTree, b: TriangleTree) => {
    const lower = boundsDistance(a, b),
      current = best ? distance(best.a, best.b) : Infinity;
    // Bounds are a lower bound; only skip pairs provably farther than the best occupied-surface witness.
    const roundoff = Number.EPSILON * 16 * Math.max(lower, current);
    if (lower > current + roundoff) return;
    // The bounds' low corners also bound every witness lexicographically. Equal-distance branches cannot improve
    // the deterministic witness when even those corners come after the current pair (important for large flat faces).
    if (best && Math.abs(lower - current) <= roundoff && !before({ a: a.low, b: b.low }, best)) return;
    if ('triangles' in a && 'triangles' in b) {
      for (const aa of a.triangles)
        for (const bb of b.triangles) {
          for (const [p, q] of edgesOf(aa)) {
            const candidate = segmentTrianglePair(p, q, bb);
            if (prefer(candidate, best)) best = candidate;
          }
          for (const [p, q] of edgesOf(bb)) {
            const candidate = swapped(segmentTrianglePair(p, q, aa));
            if (prefer(candidate, best)) best = candidate;
          }
        }
      return;
    }
    let pairs: [TriangleTree, TriangleTree][];
    if (!('triangles' in a) && ('triangles' in b || length(sub(a.high, a.low)) >= length(sub(b.high, b.low))))
      pairs = [
        [a.left, b],
        [a.right, b],
      ];
    else if (!('triangles' in b))
      pairs = [
        [a, b.left],
        [a, b.right],
      ];
    else return;
    pairs.sort(([aa, ab], [ba, bb]) => boundsDistance(aa, ab) - boundsDistance(ba, bb));
    for (const [aa, bb] of pairs) {
      visit(aa, bb);
    }
  };
  visit(triangleTree(first), triangleTree(second));
  return best!;
}

function maximumPair(first: MeasureEntity, second: MeasureEntity): MeasureWitness {
  let best: MeasureWitness | null = null;
  const firstPoints = extremePoints(first),
    secondPoints = extremePoints(second);
  // The maximum of a convex distance function over each segment/triangle occurs at an extreme vertex.
  for (const a of firstPoints)
    for (const b of secondPoints) {
      const candidate = { a, b };
      if (prefer(candidate, best, true)) best = candidate;
    }
  return best!;
}

/** Interior tessellation and hole vertices cannot maximize distance. Keep the planar face's convex hull instead. */
function extremePoints(entity: MeasureEntity): MeasureVec3[] {
  if (entity.kind !== 'face') return pointsOf(entity);
  const points = [...new Map(pointsOf(entity).map(point => [point.join(','), point])).values()];
  const drop = entity.normal.map(Math.abs).indexOf(Math.max(...entity.normal.map(Math.abs)));
  const axes = [0, 1, 2].filter(axis => axis !== drop),
    x = axes[0]!,
    y = axes[1]!;
  points.sort((a, b) => a[x]! - b[x]! || a[y]! - b[y]!);
  const turn = (a: MeasureVec3, b: MeasureVec3, c: MeasureVec3) => (b[x]! - a[x]!) * (c[y]! - a[y]!) - (b[y]! - a[y]!) * (c[x]! - a[x]!);
  const half = (ordered: MeasureVec3[]) => {
    const hull: MeasureVec3[] = [];
    for (const point of ordered) {
      while (hull.length >= 2 && turn(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  return [...half(points), ...half([...points].reverse())];
}

function centerOf(entity: MeasureEntity): MeasureVec3 {
  if (entity.kind === 'vertex') return entity.point;
  if (entity.kind === 'edge') return at(entity.a, entity.b, 0.5);
  let total = 0,
    weighted: MeasureVec3 = [0, 0, 0];
  for (const triangle of entity.triangles) {
    const area = triangleArea(triangle);
    total += area;
    weighted = add(weighted, scale(add(add(triangle[0], triangle[1]), triangle[2]), area / 3));
  }
  return scale(weighted, 1 / total);
}

const axes = ['x', 'y', 'z'] as const;
function positionRows(point: MeasureVec3, prefix: string): MeasureRow[] {
  return axes.map((axis, i) => ({
    id: `position-${axis}`,
    label: `${prefix} ${axis.toUpperCase()}`,
    value: point[i]!,
    kind: 'position',
    axis,
  }));
}
function deltaRows(witness: MeasureWitness, prefix: string): MeasureRow[] {
  return axes.map((axis, i) => {
    const end = [...witness.a] as MeasureVec3;
    end[i] = witness.b[i]!;
    const row: MeasureRow = {
      id: `delta-${axis}`,
      label: `${prefix}${axis.toUpperCase()}`,
      value: witness.b[i]! - witness.a[i]!,
      kind: 'position',
      axis,
      witness: { a: witness.a, b: end },
    };
    return row;
  });
}
function directionAngle(a: MeasureVec3, b: MeasureVec3, undirected: boolean): number | null {
  const aa = length(a),
    bb = length(b);
  if (!aa || !bb) return null;
  const unitA = scale(a, 1 / aa),
    unitB = scale(b, 1 / bb),
    cosine = dot(unitA, unitB),
    sine = length(cross(unitA, unitB));
  // atan2 retains small real angles that acos loses when its cosine rounds to one.
  return (Math.atan2(sine, undirected ? Math.abs(cosine) : cosine) * 180) / Math.PI;
}

/** Finite polyhedral measurements. Selection order determines signed XYZ changes and witness direction. */
export function measureEntities(entities: readonly MeasureEntity[]): MeasureResult {
  if (!entities.length) return { rows: [] };
  for (const entity of entities) {
    if (
      !pointsOf(entity).every(finitePoint) ||
      (entity.kind === 'face' && (!finitePoint(entity.normal) || !length(entity.normal) || !Number.isFinite(length(entity.normal))))
    )
      return { rows: [], problem: 'The selected geometry has invalid coordinates.' };
    if (entity.kind === 'face' && (!entity.triangles.length || !entity.triangles.some(triangle => triangleArea(triangle) > 0)))
      return { rows: [], problem: 'The selected face has no measurable area.' };
  }
  const rows: MeasureRow[] = [];
  const edges = entities.filter((entity): entity is Extract<MeasureEntity, { kind: 'edge' }> => entity.kind === 'edge');
  const faces = entities.filter((entity): entity is Extract<MeasureEntity, { kind: 'face' }> => entity.kind === 'face');
  if (edges.length)
    rows.push({
      id: 'length',
      label: edges.length > 1 ? 'Total length' : 'Length',
      value: edges.reduce((sum, edge) => sum + distance(edge.a, edge.b), 0),
      kind: 'length',
      ...(edges.length === 1 && { witness: { a: edges[0]!.a, b: edges[0]!.b } }),
    });
  if (faces.length)
    rows.push({
      id: 'area',
      label: faces.length > 1 ? 'Total area' : 'Area',
      value: faces.reduce((sum, face) => sum + face.triangles.reduce((area, triangle) => area + triangleArea(triangle), 0), 0),
      kind: 'area',
    });
  if (entities.length === 1) rows.push(...positionRows(centerOf(entities[0]!), entities[0]!.kind === 'vertex' ? 'Position' : 'Center'));
  let parallel: boolean | undefined;
  if (entities.length === 2) {
    const [first, second] = entities as readonly [MeasureEntity, MeasureEntity];
    const center: MeasureWitness = { a: centerOf(first), b: centerOf(second) };
    if (first.kind === 'vertex' && second.kind === 'vertex') {
      rows.push({ id: 'distance', label: 'Distance', value: distance(center.a, center.b), kind: 'length', witness: center });
      rows.push(...deltaRows(center, 'Δ'));
    } else {
      for (const [id, label, witness] of [
        ['min-distance', 'Min distance', minimumPair(first, second)],
        ['max-distance', 'Max distance', maximumPair(first, second)],
        ['center-distance', 'Center distance', center],
      ] as const)
        rows.push({ id, label, value: distance(witness.a, witness.b), kind: 'length', witness });
      rows.push(...deltaRows(center, 'Center Δ'));
    }
    const angle =
      first.kind === 'edge' && second.kind === 'edge'
        ? directionAngle(sub(first.b, first.a), sub(second.b, second.a), true)
        : first.kind === 'face' && second.kind === 'face'
          ? directionAngle(first.normal, second.normal, false)
          : null;
    if (angle !== null) {
      rows.push({ id: 'angle', label: 'Angle', value: angle, kind: 'angle' });
      if (first.kind === 'edge' && second.kind === 'edge') parallel = angle <= 1e-9;
    }
  }
  if (rows.some(row => !Number.isFinite(row.value) || (row.witness && (!finitePoint(row.witness.a) || !finitePoint(row.witness.b)))))
    return { rows: [], problem: 'The selected geometry is outside the measurable numeric range.' };
  return { rows, ...(parallel !== undefined && { parallel }) };
}
