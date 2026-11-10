import type { CadPlacement, CadPoint, EvaluatedCadPart } from '@wbcnc/cad';

type Vec3 = [number, number, number];
type Cell = [number, number, number];
const epsilon = 1e-8;
const cross = (a: readonly number[], b: readonly number[]) => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
function rotate(q: readonly number[], p: readonly number[]): Vec3 {
  const u = cross(q, p),
    v = cross(q, u);
  return p.map((n, i) => n + 2 * (q[3]! * u[i]! + v[i]!)) as Vec3;
}
function orthogonal(loop: readonly CadPoint[]) {
  if (loop.length < 3 || loop.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('Material check requires finite closed polygons.');
  loop.forEach((p, i) => {
    const next = loop[(i + 1) % loop.length]!;
    if (Math.abs(p.x - next.x) > epsilon && Math.abs(p.y - next.y) > epsilon)
      throw new Error('Material check supports orthogonal polygons only.');
  });
}
/** -1 outside,0 boundary,1 inside. A boundary probe must not silently count as either material or empty. */
function relation(loop: readonly CadPoint[], x: number, y: number, tolerance: number): number {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[j]!,
      b = loop[i]!,
      dx = b.x - a.x,
      dy = b.y - a.y;
    const length = Math.hypot(dx, dy),
      area = (x - a.x) * dy - (y - a.y) * dx;
    if (
      length &&
      Math.abs(area) <= tolerance * length &&
      x >= Math.min(a.x, b.x) - tolerance &&
      x <= Math.max(a.x, b.x) + tolerance &&
      y >= Math.min(a.y, b.y) - tolerance &&
      y <= Math.max(a.y, b.y) + tolerance
    )
      return 0;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? 1 : -1;
}

/** Exact cell integration of evaluated orthogonal material; no boundary-mesh or reference-equivalence claim. */
export function axisMaterial(part: EvaluatedCadPart, placement: CadPlacement) {
  const q = placement.rotation;
  if (Math.abs(q.reduce((sum, n) => sum + n * n, 0) - 1) > 1e-6) throw new Error('Material placement must be rigid.');
  const axes = (
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Vec3[]
  ).map(axis => rotate(q, axis));
  if (
    axes.some(
      axis =>
        axis.filter(n => Math.abs(Math.abs(n) - 1) < epsilon).length !== 1 ||
        axis.some(n => Math.abs(n) > epsilon && Math.abs(Math.abs(n) - 1) > epsilon)
    )
  )
    throw new Error('Material placement must be an axis permutation.');
  const cuts = (part.cuts ?? []).map(cut => ({
    ...cut,
    low: Math.max(0, cut.side === 'top' ? part.thickness - cut.to : cut.from),
    high: Math.min(part.thickness, cut.side === 'top' ? part.thickness - cut.from : cut.to),
  }));
  const loops = [part.outline, ...part.holes, ...cuts.flatMap(c => [c.outline, ...c.islands])];
  loops.forEach(orthogonal);
  const contains = (point: readonly number[], strict = false): boolean => {
    const [x, y, z] = point as Vec3;
    const test = (loop: CadPoint[]) => {
      const result = relation(loop, x, y, strict ? epsilon : 0);
      if (strict && result === 0) throw new Error('Material probe lies on a polygon boundary.');
      return result >= 0;
    };
    if (z < 0 || z > part.thickness || !test(part.outline) || part.holes.some(test)) return false;
    if (strict && (Math.abs(z) < epsilon || Math.abs(z - part.thickness) < epsilon))
      throw new Error('Material probe lies on a stock boundary.');
    return !cuts.some(c => {
      if (z < c.low || z > c.high || !test(c.outline) || c.islands.some(test)) return false;
      if (strict && (Math.abs(z - c.low) < epsilon || Math.abs(z - c.high) < epsilon))
        throw new Error('Material probe lies on a cut boundary.');
      return true;
    });
  };
  const points = loops.flat();
  const stops = [
    ...(['x', 'y'] as const).map(axis => [...new Set(points.map(p => p[axis]))].sort((a, b) => a - b)),
    [...new Set([0, part.thickness, ...cuts.flatMap(c => [c.low, c.high])])].sort((a, b) => a - b),
  ];
  const occupied = new Map<string, Cell>();
  let volume = 0;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < stops[0]!.length - 1; i++)
    for (let j = 0; j < stops[1]!.length - 1; j++)
      for (let k = 0; k < stops[2]!.length - 1; k++) {
        const cell: Cell = [i, j, k],
          lo = cell.map((n, a) => stops[a]![n]!),
          hi = cell.map((n, a) => stops[a]![n + 1]!);
        if (!contains(lo.map((n, a) => (n + hi[a]!) / 2))) continue;
        occupied.set(cell.join(','), cell);
        volume += hi.reduce((v, n, a) => v * (n - lo[a]!), 1);
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a]!, lo[a]!);
          max[a] = Math.max(max[a]!, hi[a]!);
        }
      }
  let components = 0;
  const visited = new Set<string>();
  for (const [key, cell] of occupied)
    if (!visited.has(key)) {
      components++;
      const queue = [cell];
      visited.add(key);
      for (let at = 0; at < queue.length; at++)
        for (let axis = 0; axis < 3; axis++)
          for (const direction of [-1, 1]) {
            const next = [...queue[at]!] as Cell;
            next[axis] += direction;
            const id = next.join(',');
            if (occupied.has(id) && !visited.has(id)) {
              visited.add(id);
              queue.push(next);
            }
          }
    }
  const world = Array.from({ length: 8 }, (_, i) =>
    rotate(q, [i & 1 ? max[0]! : min[0]!, i & 2 ? max[1]! : min[1]!, i & 4 ? max[2]! : min[2]!]).map((n, a) => n + placement.position[a]!)
  );
  return {
    volume,
    components,
    bounds: { min: [0, 1, 2].map(a => Math.min(...world.map(p => p[a]!))), max: [0, 1, 2].map(a => Math.max(...world.map(p => p[a]!))) },
    containsWorld(point: readonly number[]) {
      return contains(
        rotate(
          [-q[0], -q[1], -q[2], q[3]],
          point.map((n, a) => n - placement.position[a]!)
        ),
        true
      );
    },
  };
}
