import type { SvgContour, SvgPoint, SvgSegment } from './types';
const tolerance = 1e-3;
type HPoint = [number, number, number];
const xy = (p: HPoint): SvgPoint => [p[0] / p[2], p[1] / p[2]];
function distance(p: SvgPoint, a: SvgPoint, b: SvgPoint): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function flatten(segment: SvgSegment): SvgPoint[] {
  const poles = segment.points.map((p, i): HPoint => {
    const w = segment.kind === 'conic' && i === 1 ? segment.rho / (1 - segment.rho) : 1;
    return [p[0] * w, p[1] * w, w];
  });
  const out: SvgPoint[] = [xy(poles[0])];
  const visit = (p: HPoint[], depth: number) => {
    const start = xy(p[0]),
      end = xy(p.at(-1)!);
    if (p.every(v => distance(xy(v), start, end) <= tolerance)) {
      out.push(end);
      return;
    }
    if (depth >= 20 || out.length > 4096) throw new Error('SVG curve is too complex to validate safely.');
    const levels = [p];
    for (let n = p.length - 1; n > 0; n--)
      levels.push(
        levels
          .at(-1)!
          .slice(0, n)
          .map((v, i) => v.map((x, k) => (x + levels.at(-1)![i + 1][k]) / 2) as HPoint)
      );
    visit(
      levels.map(l => l[0]),
      depth + 1
    );
    visit(levels.map(l => l.at(-1)!).reverse(), depth + 1);
  };
  visit(poles, 0);
  return out;
}
const cross = (a: SvgPoint, b: SvgPoint, c: SvgPoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function near(a: SvgPoint, b: SvgPoint, c: SvgPoint, d: SvgPoint): boolean {
  const pad = 2 * tolerance;
  if (
    Math.max(a[0], b[0]) + pad < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) + pad < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) + pad < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) + pad < Math.min(a[1], b[1])
  )
    return false;
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
  return Math.min(distance(a, c, d), distance(b, c, d), distance(c, a, b), distance(d, a, b)) <= pad;
}
function inside(point: SvgPoint, poly: SvgPoint[]): boolean {
  let value = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) value = !value;
  }
  return value;
}
/** Validate simple, separated closed contours; keep only boundaries where SVG fill changes.
 * Flattening is for conservative topology checks only. Imported curves remain exact.
 */
export function filledContours(contours: SvgContour[]): SvgContour[] {
  const polys = contours.map(c => c.segments.flatMap(s => flatten(s).slice(0, -1)));
  if (polys.reduce((sum, p) => sum + p.length, 0) > 8192) throw new Error('SVG has too many edges for topology validation.');
  const areas = polys.map(p => p.reduce((a, v, i) => a + v[0] * p[(i + 1) % p.length][1] - v[1] * p[(i + 1) % p.length][0], 0) / 2);
  if (areas.some(a => Math.abs(a) < tolerance * tolerance)) throw new Error('SVG contains a degenerate closed contour.');
  let checks = 0;
  for (let a = 0; a < polys.length; a++)
    for (let b = a; b < polys.length; b++) {
      const p = polys[a],
        q = polys[b];
      for (let i = 0; i < p.length; i++)
        for (let j = a === b ? i + 1 : 0; j < q.length; j++) {
          if (a === b && (j === i + 1 || (i === 0 && j === p.length - 1))) continue;
          if (++checks > 20_000_000) throw new Error('SVG topology exceeds the validation budget.');
          if (near(p[i], p[(i + 1) % p.length], q[j], q[(j + 1) % q.length]))
            throw new Error('Intersecting, touching or nearly touching SVG contours are unsupported.');
        }
    }
  const parents = polys.map((p, i) => polys.flatMap((q, j) => (j !== i && inside(p[0], q) ? [j] : [])));
  const isFilled = (active: number[]) => {
    const groups = new Map<number, number[]>();
    for (const index of active) {
      const key = contours[index].group;
      groups.set(key, [...(groups.get(key) ?? []), index]);
    }
    return [...groups.values()].some(ids =>
      contours[ids[0]].fillRule === 'evenodd' ? ids.length % 2 === 1 : ids.reduce((n, index) => n + Math.sign(areas[index]), 0) !== 0
    );
  };
  return contours.filter((_, i) => isFilled(parents[i]) !== isFilled([...parents[i], i]));
}
