export type SectionVec3 = [number, number, number];
export interface SectionSegment {
  a: SectionVec3;
  b: SectionVec3;
}
interface Node {
  point: SectionVec3;
  id: number;
}
interface Bounds {
  low: SectionVec3;
  high: SectionVec3;
}
type Tree = Bounds & ({ nodes: Node[] } | { left: Tree; right: Tree });
interface Edge {
  a: number;
  b: number;
  balance: number;
  count: number;
}

const sub = (a: SectionVec3, b: SectionVec3): SectionVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: SectionVec3, b: SectionVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: SectionVec3) => Math.hypot(...a);
const bounds = (points: SectionVec3[]): Bounds => {
  const low: SectionVec3 = [Infinity, Infinity, Infinity],
    high: SectionVec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points)
    for (let k = 0; k < 3; k++) {
      low[k] = Math.min(low[k]!, point[k]!);
      high[k] = Math.max(high[k]!, point[k]!);
    }
  return { low, high };
};
function tree(nodes: Node[]): Tree {
  const box = bounds(nodes.map(node => node.point));
  if (nodes.length <= 8) return { ...box, nodes };
  const sizes = sub(box.high, box.low),
    axis = sizes.indexOf(Math.max(...sizes));
  nodes.sort((a, b) => a.point[axis]! - b.point[axis]!);
  const middle = Math.floor(nodes.length / 2);
  return { ...box, left: tree(nodes.slice(0, middle)), right: tree(nodes.slice(middle)) };
}
function nearby(source: Tree, box: Bounds, tolerance: number, output: Node[]) {
  if ([0, 1, 2].some(k => source.low[k]! > box.high[k]! + tolerance || source.high[k]! < box.low[k]! - tolerance)) return;
  if ('nodes' in source) output.push(...source.nodes);
  else {
    nearby(source.left, box, tolerance, output);
    nearby(source.right, box, tolerance, output);
  }
}
function accumulate(map: Map<string, Edge>, a: number, b: number, count = 1) {
  if (a === b) return;
  const low = Math.min(a, b),
    high = Math.max(a, b),
    key = `${low}/${high}`,
    previous = map.get(key);
  if (previous) {
    previous.balance += a === low ? 1 : -1;
    previous.count += count;
  } else map.set(key, { a: low, b: high, balance: a === low ? 1 : -1, count });
}

/** Weld rounding-equivalent endpoints and split finite T-junctions before counting oriented edge incidences. */
export function sectionEdges(
  segments: SectionSegment[],
  tolerance: number,
  solid = false
): {
  points: SectionVec3[];
  edges: Edge[];
  snap: (point: SectionVec3) => SectionVec3;
  problem?: string;
} {
  const points: SectionVec3[] = [],
    cells = new Map<string, number[]>();
  const zOffsets = segments.every(({ a, b }) => a[2] === 0 && b[2] === 0) ? [0] : [-1, 0, 1];
  const cell = (point: SectionVec3) => point.map(value => Math.floor(value / tolerance));
  const find = (point: SectionVec3): number | undefined => {
    const [x, y, z] = cell(point);
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1])
        for (const dz of zOffsets)
          for (const id of cells.get(`${x! + dx},${y! + dy},${z! + dz}`) ?? []) if (length(sub(point, points[id]!)) <= tolerance) return id;
    return undefined;
  };
  const node = (point: SectionVec3): number => {
    const found = find(point);
    if (found !== undefined) return found;
    const id = points.push(point) - 1,
      key = cell(point).join(','),
      bucket = cells.get(key);
    if (bucket) bucket.push(id);
    else cells.set(key, [id]);
    return id;
  };
  const entries = segments.map(({ a, b }) => ({ a: node(a), b: node(b) })).filter(({ a, b }) => a !== b);
  const exact = new Map<string, Edge>();
  for (const { a, b } of entries) accumulate(exact, a, b);
  const snap = (point: SectionVec3): SectionVec3 => points[find(point) ?? -1] ?? point;
  const failure = () => ({ points, edges: [], snap, problem: 'The part mesh has an open or non-manifold boundary.' });
  if (solid && [...exact.values()].some(edge => edge.count > 2)) return failure();
  if (!entries.length || (solid && [...exact.values()].every(edge => edge.count === 2 && edge.balance === 0)))
    return { points, edges: [], snap };
  const source = tree(points.map((point, id) => ({ point, id }))),
    split = new Map<string, Edge>();
  for (const entry of entries) {
    const a = points[entry.a]!,
      b = points[entry.b]!,
      ab = sub(b, a),
      span = dot(ab, ab),
      candidates: Node[] = [];
    nearby(source, bounds([a, b]), tolerance, candidates);
    const along = [
      { id: entry.a, t: 0 },
      { id: entry.b, t: 1 },
    ];
    for (const candidate of candidates) {
      if (candidate.id === entry.a || candidate.id === entry.b) continue;
      const ap = sub(candidate.point, a),
        t = dot(ap, ab) / span;
      if (t <= 0 || t >= 1) continue;
      const off: SectionVec3 = [ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]];
      if (length(off) <= tolerance) along.push({ id: candidate.id, t });
    }
    along.sort((p, q) => p.t - q.t);
    for (let i = 1; i < along.length; i++) accumulate(split, along[i - 1]!.id, along[i]!.id);
  }
  const all = [...split.values()];
  if (solid && all.some(edge => edge.count !== 2 || edge.balance !== 0)) return failure();
  return { points, edges: all.filter(edge => edge.balance !== 0), snap };
}

const area = (points: SectionVec3[]) =>
  points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]!;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
const turn = (a: SectionVec3, b: SectionVec3, c: SectionVec3) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function crosses(a: SectionVec3, b: SectionVec3, c: SectionVec3, d: SectionVec3) {
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}
interface ContourEdge extends Bounds {
  a: SectionVec3;
  b: SectionVec3;
  index: number;
}
type ContourTree = Bounds & ({ edges: ContourEdge[] } | { left: ContourTree; right: ContourTree });
function contourTree(edges: ContourEdge[]): ContourTree {
  const box = bounds(edges.flatMap(edge => [edge.low, edge.high]));
  if (edges.length <= 8) return { ...box, edges };
  const axis = box.high[0] - box.low[0] > box.high[1] - box.low[1] ? 0 : 1;
  edges.sort((a, b) => a.low[axis] + a.high[axis] - b.low[axis] - b.high[axis]);
  const middle = Math.floor(edges.length / 2);
  return { ...box, left: contourTree(edges.slice(0, middle)), right: contourTree(edges.slice(middle)) };
}
function contourCrossing(source: ContourTree, edge: ContourEdge): boolean {
  // Disjoint finite segment bounds cannot cross. This broad phase leaves the exact orientation predicate unchanged.
  if (source.low[0] > edge.high[0] || source.high[0] < edge.low[0] || source.low[1] > edge.high[1] || source.high[1] < edge.low[1])
    return false;
  if ('edges' in source)
    return source.edges.some(
      other =>
        other.index > edge.index &&
        other.low[0] <= edge.high[0] &&
        other.high[0] >= edge.low[0] &&
        other.low[1] <= edge.high[1] &&
        other.high[1] >= edge.low[1] &&
        crosses(edge.a, edge.b, other.a, other.b)
    );
  return contourCrossing(source.left, edge) || contourCrossing(source.right, edge);
}

/** Closed oriented cut contours. Odd graph degrees and crossing loops are reported instead of guessed into caps. */
export function sectionContours(segments: SectionSegment[], tolerance: number) {
  const joined = sectionEdges(segments, tolerance),
    outgoing = new Map<number, number>(),
    incoming = new Map<number, number>();
  const failed = (problem: string) => ({ ...joined, loops: [] as SectionVec3[][], problem });
  for (const edge of joined.edges) {
    if (Math.abs(edge.balance) !== 1) return failed('The section boundary overlaps itself.');
    const a = edge.balance > 0 ? edge.a : edge.b,
      b = edge.balance > 0 ? edge.b : edge.a;
    if (outgoing.has(a) || incoming.has(b)) return failed('The section boundary branches or touches itself.');
    outgoing.set(a, b);
    incoming.set(b, a);
  }
  if ([...outgoing.keys()].some(id => !incoming.has(id)) || [...incoming.keys()].some(id => !outgoing.has(id)))
    return failed('The section boundary is not closed.');
  const visited = new Set<number>(),
    loops: SectionVec3[][] = [];
  for (const start of outgoing.keys()) {
    if (visited.has(start)) continue;
    const ids: number[] = [];
    let next = start;
    do {
      if (visited.has(next)) return failed('The section boundary is not a simple loop.');
      visited.add(next);
      ids.push(next);
      next = outgoing.get(next)!;
    } while (next !== start);
    const loop = ids.map(id => joined.points[id]!);
    if (loop.length < 3 || area(loop) === 0) continue;
    loops.push(loop);
  }
  const contourSegments = loops.flatMap(loop => loop.map((a, i) => ({ a, b: loop[(i + 1) % loop.length]! })));
  const edges = contourSegments.map((edge, index): ContourEdge => ({ ...edge, ...bounds([edge.a, edge.b]), index }));
  if (edges.length) {
    const source = contourTree([...edges]);
    if (edges.some(edge => contourCrossing(source, edge))) return failed('The section boundary crosses itself.');
  }
  return { ...joined, loops };
}

export const sectionContourArea = area;
export function sectionContains(loop: SectionVec3[], point: SectionVec3) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]!,
      b = loop[j]!;
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
