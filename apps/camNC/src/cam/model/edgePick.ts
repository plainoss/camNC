import * as THREE from 'three';

type Vec3 = [number, number, number];

/** A straight edge of a part, end to end, in the same space as the part's mesh. */
export interface ModelEdge {
  a: Vec3;
  b: Vec3;
}

/** The angle between two faces, in degrees, above which their shared line is an edge, as the view draws edges. */
const kEdgeAngle = 20;
const featureEdges = new WeakMap<Float32Array, { indices: ArrayLike<number>; lines: Float32Array }>();

/** The mesh's edges as pairs of points, worked out once for each mesh. */
function edgesOf(positions: Float32Array, indices: ArrayLike<number>): Float32Array {
  let cached = featureEdges.get(positions);
  if (cached?.indices !== indices) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(Array.from(indices));
    const lines = new THREE.EdgesGeometry(geometry, kEdgeAngle);
    const edges = lines.getAttribute('position').array as Float32Array;
    geometry.dispose();
    lines.dispose();
    cached = { indices, lines: edges };
    featureEdges.set(positions, cached);
  }
  return cached.lines;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(...a);

/** How far `point` is from the segment a–b. */
function distanceToSegment(point: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a),
    span = dot(ab, ab);
  const t = span ? Math.max(0, Math.min(1, dot(sub(point, a), ab) / span)) : 0;
  return length(sub(point, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
}

/** Whether `p` lies on the line through a and b. */
const onLine = (p: Vec3, a: Vec3, b: Vec3) => {
  const ab = sub(b, a),
    ap = sub(p, a);
  const cross: Vec3 = [ab[1] * ap[2] - ab[2] * ap[1], ab[2] * ap[0] - ab[0] * ap[2], ab[0] * ap[1] - ab[1] * ap[0]];
  return length(cross) <= 1e-6 * Math.max(1, length(ab) * length(ap));
};

/**
 * The part's edge nearest a click on it, when the click is within `tolerance` of one: the whole straight edge, joined
 * from the pieces the mesh splits it into, so a pick gives the edge from end to end. Distances are in the mesh's space.
 */
export function nearestEdge(positions: Float32Array, indices: ArrayLike<number>, point: Vec3, tolerance: number): ModelEdge | null {
  return nearestEdgeBy(positions, indices, (a, b) => distanceToSegment(point, a, b), tolerance);
}

/**
 * The same, with each piece of edge measured by `distance`, such as how far it's drawn on screen from the pointer, so
 * a tolerance in pixels holds however the face is turned.
 */
export function nearestEdgeBy(
  positions: Float32Array,
  indices: ArrayLike<number>,
  distance: (a: Vec3, b: Vec3) => number,
  tolerance: number
): ModelEdge | null {
  const edges = edgesOf(positions, indices);
  const at = (i: number): Vec3 => [edges[i]!, edges[i + 1]!, edges[i + 2]!];
  let best: { a: Vec3; b: Vec3; distance: number } | null = null;
  for (let i = 0; i < edges.length; i += 6) {
    const a = at(i),
      b = at(i + 3);
    const away = distance(a, b);
    if (away <= tolerance && (!best || away < best.distance)) best = { a, b, distance: away };
  }
  if (!best) return null;
  return wholeEdge(edges, best);
}

function wholeEdge(edges: Float32Array, initial: ModelEdge): ModelEdge {
  const at = (i: number): Vec3 => [edges[i]!, edges[i + 1]!, edges[i + 2]!];
  // Grow it along the same line through the pieces that touch its ends.
  let { a, b } = initial;
  for (let grown = true; grown; ) {
    grown = false;
    for (let i = 0; i < edges.length; i += 6) {
      const p = at(i),
        q = at(i + 3);
      if (!onLine(p, a, b) || !onLine(q, a, b)) continue;
      const same = (x: Vec3, y: Vec3) => length(sub(x, y)) < 1e-6;
      for (const [from, to] of [
        [p, q],
        [q, p],
      ] as const) {
        if (same(from, b) && !same(to, a) && dot(sub(to, b), sub(b, a)) > 0) {
          b = to;
          grown = true;
        } else if (same(from, a) && !same(to, b) && dot(sub(to, a), sub(a, b)) > 0) {
          a = to;
          grown = true;
        }
      }
    }
  }
  return { a, b };
}

/** Complete straight edges from known boundary segments, with collinear triangulation splits joined. */
export function joinStraightEdges(segments: readonly ModelEdge[]): ModelEdge[] {
  const epsilon = 1e-6;
  type Incident = { from: Vec3; to: Vec3; index: number };
  const buckets = new Map<string, Incident[]>();
  const cell = (p: Vec3) => p.map(value => Math.round(value / epsilon));
  const add = (from: Vec3, to: Vec3, index: number) => {
    const key = cell(from).join(','),
      previous = buckets.get(key);
    const incident = { from, to, index };
    if (previous) previous.push(incident);
    else buckets.set(key, [incident]);
  };
  segments.forEach(({ a, b }, index) => {
    add(a, b, index);
    add(b, a, index);
  });
  const near = (point: Vec3): Incident[] => {
    const [x, y, z] = cell(point),
      result: Incident[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const incident of buckets.get(`${x! + dx},${y! + dy},${z! + dz}`) ?? [])
            if (length(sub(incident.from, point)) < epsilon) result.push(incident);
    return result;
  };
  const visited = new Set<number>();
  const unique = new Map<string, ModelEdge>();
  segments.forEach((segment, index) => {
    if (visited.has(index)) return;
    visited.add(index);
    let { a, b } = segment;
    // Only segments incident to an endpoint can extend its line. Scanning every boundary edge for every little
    // pocket facet made a first cabinet-face click quadratic even when almost none of the edges were collinear.
    for (const end of ['a', 'b'] as const)
      for (;;) {
        const point = end === 'a' ? a : b,
          other = end === 'a' ? b : a,
          along = sub(point, other);
        let next: Incident | undefined,
          reach = 0;
        for (const incident of near(point)) {
          if (!onLine(incident.to, a, b) || length(sub(incident.to, other)) < epsilon) continue;
          const distance = dot(sub(incident.to, point), along);
          if (distance > reach) {
            next = incident;
            reach = distance;
          }
        }
        if (!next) break;
        visited.add(next.index);
        if (end === 'a') a = next.to;
        else b = next.to;
      }
    const [first, second] = [a, b].sort((a, b) => a.join(',').localeCompare(b.join(',')));
    const edge = { a: first!, b: second! };
    const key = [edge.a.join(','), edge.b.join(',')].join('/');
    unique.set(key, edge);
  });
  return [...unique.values()];
}

/**
 * How far a piece of edge is drawn from the pointer on screen, in pixels: the edge in the mesh's space, placed by
 * `matrix` and seen by `camera` on a view `width` × `height` pixels, with the pointer in normalized device coordinates.
 */
export function screenDistance(
  camera: THREE.Camera,
  matrix: THREE.Matrix4,
  width: number,
  height: number,
  pointer: { x: number; y: number }
): { segment: (a: Vec3, b: Vec3) => number; point: (p: Vec3) => number } {
  const toScreen = (p: Vec3): [number, number] => {
    const v = new THREE.Vector3(...p).applyMatrix4(matrix).project(camera);
    return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height];
  };
  const at: [number, number] = [((pointer.x + 1) / 2) * width, ((1 - pointer.y) / 2) * height];
  return {
    segment: (a, b) => {
      const [ax, ay] = toScreen(a),
        [bx, by] = toScreen(b);
      const dx = bx - ax,
        dy = by - ay,
        span = dx * dx + dy * dy;
      const t = span ? Math.max(0, Math.min(1, ((at[0] - ax) * dx + (at[1] - ay) * dy) / span)) : 0;
      return Math.hypot(at[0] - ax - dx * t, at[1] - ay - dy * t);
    },
    point: p => {
      const [x, y] = toScreen(p);
      return Math.hypot(at[0] - x, at[1] - y);
    },
  };
}
