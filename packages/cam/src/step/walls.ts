import type { Pt, Vec3 } from '../geom';
import { runsOnCircles, type Circle } from './arcs';

/**
 * A side face over one or more stacked slabs: a straight wall or a cylinder run, with its vertices at the bottom and the
 * top, and the vertices of the heights it passes on its first and last vertical side.
 */
export interface Wall {
  circle?: Circle;
  ccw: boolean;
  along: Pt[];
  low: number;
  high: number;
  bottom: number[];
  top: number[];
  /** Vertices at each height passed, bottom to top: above the run's first point and above its last. */
  first: number[];
  last: number[];
}

/**
 * The walls of the slabs, where a run whose outline is the same in the slab above continues as one face, so a wall the
 * material doesn't change along runs from its bottom to its top in one piece. A run that differs, as a pocket's walls
 * that stop at its floor, starts or ends a face of its own.
 */
export function stackedWalls(
  slabs: readonly { low: number; high: number; region: Pt[][] }[],
  circles: readonly Circle[],
  vertex: (x: number, y: number, z: number) => number
): Wall[] {
  const walls: Wall[] = [];
  const key = (wall: { circle?: Circle; ccw: boolean }, ids: number[]) =>
    `${wall.circle ? `${circles.indexOf(wall.circle)}${wall.ccw ? '+' : '-'}` : 'line'}:${ids.join(',')}`;
  let open = new Map<string, Wall>();
  for (const { low, high, region } of slabs) {
    const next = new Map<string, Wall>();
    // A whole circle is cut into two halves from wherever its path starts: start where the slab below's halves did.
    const starts = new Set([...open.values()].flatMap(wall => (wall.circle ? [wall.top[0]!] : [])));
    for (const path of region) {
      const ids = path.map(p => vertex(p.x, p.y, low));
      const from = Math.max(
        0,
        ids.findIndex(id => starts.has(id))
      );
      const turned = from ? [...path.slice(from), ...path.slice(0, from)] : path;
      for (const run of runsOnCircles(turned, circles)) {
        const along = run.points,
          bottom = along.map(p => vertex(p.x, p.y, low)),
          top = along.map(p => vertex(p.x, p.y, high));
        const below = open.get(key(run, bottom));
        if (below) {
          below.first.push(below.top[0]!);
          below.last.push(below.top.at(-1)!);
          below.top = top;
          below.high = high;
          next.set(key(run, top), below);
          continue;
        }
        const wall: Wall = { ...(run.circle && { circle: run.circle }), ccw: run.ccw, along, low, high, bottom, top, first: [], last: [] };
        walls.push(wall);
        next.set(key(run, top), wall);
      }
    }
    open = next;
  }
  return walls;
}

/**
 * The loops without the vertices a stacked wall passed at a height where nothing else has a corner: where every loop
 * that uses one runs straight up through it. A vertex another face turns at stays, so their edges still meet.
 */
export function withoutSeams(
  drafts: { loops: number[][] }[],
  chains: readonly { vertices: readonly number[] }[],
  points: readonly Vec3[],
  seams: ReadonlySet<number>
) {
  const vertical = (a: number, b: number) =>
    Math.abs(points[a]![0] - points[b]![0]) < 1e-3 && Math.abs(points[a]![1] - points[b]![1]) < 1e-3 && points[a]![2] !== points[b]![2];
  const kept = new Set(chains.flatMap(chain => chain.vertices));
  for (const { loops } of drafts)
    for (const loop of loops)
      loop.forEach((v, n) => {
        if (!seams.has(v)) return;
        const before = loop[(n + loop.length - 1) % loop.length]!,
          after = loop[(n + 1) % loop.length]!;
        const z = points[v]![2];
        // Straight up through it: one neighbour below and one above, on its vertical line.
        if (!vertical(before, v) || !vertical(v, after) || (points[before]![2] - z) * (points[after]![2] - z) >= 0) kept.add(v);
      });
  for (const draft of drafts) draft.loops = draft.loops.map(loop => loop.filter(v => !seams.has(v) || kept.has(v)));
}

/** The B-rep with only the points its edges end at, so no vertex is written that no face has. */
export function withUsedPoints<B extends { points: Vec3[]; edges: { start: number; end: number }[] }>(brep: B): B {
  const at = new Map<number, number>();
  for (const edge of brep.edges) for (const v of [edge.start, edge.end]) if (!at.has(v)) at.set(v, at.size);
  const points = brep.points.filter((_, v) => at.has(v));
  // Kept in their order, so the numbering follows the old one.
  [...at.keys()].sort((a, b) => a - b).forEach((v, n) => at.set(v, n));
  return { ...brep, points, edges: brep.edges.map(edge => ({ ...edge, start: at.get(edge.start)!, end: at.get(edge.end)! })) };
}
