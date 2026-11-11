import type { Pt } from '../geom';

export interface Circle {
  x: number;
  y: number;
  r: number;
}
/** Part of a closed path: one straight segment, or several consecutive points on a circle. */
export interface PathRun {
  points: Pt[];
  circle?: Circle;
  /** Turns left: the circle's center is on the left of the run. */
  ccw: boolean;
}

/** Clipper rounds points to 1e-4 mm, so points of one arc lie on its circle within that. */
export const ON_CIRCLE = 3e-4;
/**
 * Curves are tessellated within 0.01 mm. A polygon drawn with straight sides bulges far more than that from the circle
 * through its corners, so it stays straight.
 */
const MAX_SAGITTA = 0.03;
const MIN_SEGMENTS = 3;

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function circleThrough(a: Pt, b: Pt, c: Pt): Circle | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y,
    b2 = b.x * b.x + b.y * b.y,
    c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

/** The circle all these points lie on, as consecutive chords short enough to be a tessellated arc, or null. */
function arcThrough(points: Pt[], closed = false): Circle | null {
  const circle = circleThrough(
    points[0]!,
    points[Math.floor(points.length / (closed ? 3 : 2))]!,
    points[closed ? Math.floor((2 * points.length) / 3) : points.length - 1]!
  );
  if (!circle || circle.r > 1e5) return null;
  if (points.some(p => Math.abs(Math.hypot(p.x - circle.x, p.y - circle.y) - circle.r) > ON_CIRCLE)) return null;
  let sweep = 0,
    turn = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!,
      b = points[i + 1]!;
    const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
    if (half > circle.r || circle.r - Math.sqrt(circle.r * circle.r - half * half) > MAX_SAGITTA) return null;
    const side = Math.sign(cross(circle, a, b));
    if (!side || (turn && side !== turn)) return null;
    turn = side;
    sweep += 2 * Math.asin(half / circle.r);
  }
  return closed || sweep < 2 * Math.PI - 1e-6 ? circle : null;
}

/**
 * A closed path cut into straight segments and arcs, in order, each starting where the last ended. A path that is one
 * whole circle comes back as two half arcs, so no face has to close on itself.
 */
export function arcRuns(path: readonly Pt[]): PathRun[] {
  const pts = path.filter((p, i) => {
    const q = path[(i + 1) % path.length]!;
    return Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
  });
  const n = pts.length;
  const line = (a: Pt, b: Pt): PathRun => ({ points: [a, b], ccw: false });
  if (n < 2 * MIN_SEGMENTS) return pts.map((p, i) => line(p, pts[(i + 1) % n]!));
  const circle = arcThrough([...pts, pts[0]!], true);
  if (circle) {
    const half = Math.floor(n / 2),
      ccw = cross(circle, pts[0]!, pts[1]!) > 0;
    return [
      { points: pts.slice(0, half + 1), circle, ccw },
      { points: [...pts.slice(half), pts[0]!], circle, ccw },
    ];
  }
  // Start at a corner, where no arc runs through, so an arc isn't split across the path's start.
  const corner = pts.findIndex((p, i) => {
    const before = pts[(i + n - 1) % n]!,
      after = pts[(i + 1) % n]!;
    return !arcThrough([before, p, after]) || !arcThrough([pts[(i + n - 2) % n]!, before, p, after]);
  });
  const start = Math.max(0, corner);
  const sequence = [...pts.slice(start), ...pts.slice(0, start), pts[start]!];
  const runs: PathRun[] = [];
  for (let i = 0; i < n; ) {
    let j = i + MIN_SEGMENTS,
      fit = j <= n ? arcThrough(sequence.slice(i, j + 1)) : null;
    if (!fit) {
      runs.push(line(sequence[i]!, sequence[i + 1]!));
      i++;
      continue;
    }
    for (let longer: Circle | null; j < n && (longer = arcThrough(sequence.slice(i, j + 2))); j++) fit = longer;
    runs.push({ points: sequence.slice(i, j + 1), circle: fit, ccw: cross(fit, sequence[i]!, sequence[i + 1]!) > 0 });
    i = j;
  }
  return runs;
}

/** The first of `circles` that a straight segment is a chord of, as a tessellated arc's are. */
function chordOf(a: Pt, b: Pt, circles: readonly Circle[]): { circle: Circle; ccw: boolean } | undefined {
  for (const circle of circles) {
    const on = (p: Pt) => Math.abs(Math.hypot(p.x - circle.x, p.y - circle.y) - circle.r) <= ON_CIRCLE;
    if (!on(a) || !on(b)) continue;
    const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
    if (half > circle.r || circle.r - Math.sqrt(circle.r * circle.r - half * half) > MAX_SAGITTA) continue;
    const side = cross(circle, a, b);
    if (side) return { circle, ccw: side > 0 };
  }
  return undefined;
}

/**
 * The path's runs against circles found anywhere in the part, so a boundary shared by several walls is an arc in all of
 * them or none, however short each wall's piece of it is.
 */
export function runsOnCircles(path: readonly Pt[], circles: readonly Circle[]): PathRun[] {
  const pts = path.filter((p, i) => {
    const q = path[(i + 1) % path.length]!;
    return Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
  });
  const n = pts.length;
  const on = pts.map((p, i) => chordOf(p, pts[(i + 1) % n]!, circles));
  const same = (i: number, j: number) => !!on[i] && !!on[j] && on[i]!.circle === on[j]!.circle && on[i]!.ccw === on[j]!.ccw;
  if (n && on.every((_, i) => same(i, 0))) {
    // One whole circle: two half arcs, so no face closes on itself.
    const half = Math.max(1, Math.floor(n / 2));
    return [
      { points: pts.slice(0, half + 1), ...on[0]! },
      { points: [...pts.slice(half), pts[0]!], ...on[0]! },
    ];
  }
  // Start where a run begins, so none is split across the path's start.
  const start = Math.max(
    0,
    pts.findIndex((_, i) => !same(i, (i + n - 1) % n))
  );
  const runs: PathRun[] = [];
  for (let k = 0; k < n; ) {
    const i = (start + k) % n;
    let length = 1;
    while (k + length < n && same(i, (i + length) % n)) length++;
    const points = Array.from({ length: length + 1 }, (_, m) => pts[(i + m) % n]!);
    runs.push(on[i] ? { points, ...on[i]! } : { points, ccw: false });
    k += length;
  }
  return runs;
}

/** Circles that runs of the paths follow, each once. */
export function pathCircles(paths: readonly (readonly Pt[])[]): Circle[] {
  const circles: Circle[] = [];
  for (const path of paths)
    for (const run of arcRuns(path))
      if (
        run.circle &&
        !circles.some(c => Math.hypot(c.x - run.circle!.x, c.y - run.circle!.y) < 1e-3 && Math.abs(c.r - run.circle!.r) < 1e-3)
      )
        circles.push(run.circle);
  return circles;
}
