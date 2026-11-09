import type { Vec3 } from './geom';
import type { MotionPath, MotionRole } from './motion';

/** Repeat tab positions on every lap of a contour ramp, including intervals crossing the seam. */
export function repeatTabIntervals(intervals: (readonly [number, number])[], perimeter: number, travel: number): [number, number][] {
  if (!Number.isFinite(perimeter) || perimeter <= 0 || !Number.isFinite(travel) || travel < 0)
    throw new RangeError('Invalid contour length for tabs');
  const out: [number, number][] = [];
  for (const [a, b] of intervals)
    for (let k = Math.floor(-b / perimeter); k <= Math.ceil((travel - a) / perimeter); k++) {
      const shifted: [number, number] = [a + k * perimeter, b + k * perimeter];
      if (shifted[1] >= 0 && shifted[0] <= travel) out.push(shifted);
    }
  return out;
}

/** Raise the pass to the tab height over each interval, with vertical steps at the tab borders. */
export function applyTabMotion<T extends MotionPath>(
  pass: T,
  intervals: (readonly [number, number])[],
  tabZ: number,
  plungeFeed: number
): T & { roles: MotionRole[] } {
  const inside = (s: number) => intervals.some(([a, b]) => s > a && s < b);
  const first = [...pass.pts[0]] as Vec3;
  if (inside(1e-7)) first[2] = Math.max(first[2], tabZ);
  const pts: Vec3[] = [first],
    feeds = [pass.feeds[0]],
    roles: MotionRole[] = [pass.roles?.[0] ?? 'approach'];
  let along = 0;
  const append = (p: Vec3, feed: number, role: MotionRole) => {
    const previous = pts.at(-1)!;
    pts.push(p);
    feeds.push(p[2] < previous[2] - 1e-8 ? Math.min(feed, plungeFeed) : feed);
    roles.push(role);
  };
  for (let i = 1; i < pass.pts.length; i++) {
    const a = pass.pts[i - 1],
      b = pass.pts[i],
      len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const boundaries = intervals.flatMap(([start, end]) => [start, end]);
    const cuts = [...new Set(boundaries.filter(s => s > along + 1e-8 && s <= along + len + 1e-8))].sort((x, y) => x - y);
    if (!cuts.length || Math.abs(cuts.at(-1)! - (along + len)) > 1e-8) cuts.push(along + len);
    for (const s of cuts) {
      const t = len > 1e-8 ? (s - along) / len : 1;
      const p = Math.abs(s - (along + len)) < 1e-8 ? ([...b] as Vec3) : (a.map((v, axis) => v + t * (b[axis] - v)) as Vec3);
      const baseRole = pass.roles?.[i] ?? (b[2] < a[2] - 1e-8 ? (len > 1e-8 ? 'ramp' : 'plunge') : 'cut');
      const before = inside(s - 1e-7) ? Math.max(p[2], tabZ) : p[2];
      const after = inside(s + 1e-7) ? Math.max(p[2], tabZ) : p[2];
      append([p[0], p[1], before], pass.feeds[i], before > p[2] + 1e-8 ? 'tab' : baseRole);
      if (Math.abs(after - before) > 1e-8) append([p[0], p[1], after], pass.feeds[i], 'tab');
    }
    along += len;
  }
  return { ...pass, pts, feeds, roles };
}
