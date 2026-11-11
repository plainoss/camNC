import { finite, type SvgBounds, type SvgPoint, type SvgSegment } from './types';
export function evaluateSegment(s: SvgSegment, t: number): SvgPoint {
  const points = s.points.map(p => [...p] as SvgPoint);
  if (s.kind === 'conic') {
    const w = s.rho / (1 - s.rho),
      a = (1 - t) ** 2,
      b = 2 * w * t * (1 - t),
      c = t * t,
      d = a + b + c;
    return [(a * points[0][0] + b * points[1][0] + c * points[2][0]) / d, (a * points[0][1] + b * points[1][1] + c * points[2][1]) / d];
  }
  for (let n = points.length - 1; n > 0; n--)
    for (let i = 0; i < n; i++) points[i] = [points[i][0] * (1 - t) + points[i + 1][0] * t, points[i][1] * (1 - t) + points[i + 1][1] * t];
  return points[0];
}
function roots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-14) return Math.abs(b) < 1e-14 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(discriminant));
  return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
}
export function segmentBounds(s: SvgSegment): SvgBounds {
  const ts = [0, 1];
  for (const axis of [0, 1]) {
    const p = s.points.map(v => v[axis]);
    if (s.kind === 'conic') {
      const w = s.rho / (1 - s.rho),
        n0 = p[0],
        n1 = 2 * (w * p[1] - p[0]),
        n2 = p[0] - 2 * w * p[1] + p[2],
        d1 = 2 * (w - 1),
        d2 = 2 * (1 - w);
      ts.push(...roots(n2 * d1 - n1 * d2, 2 * (n2 - n0 * d2), n1 - n0 * d1));
    } else if (p.length === 3) ts.push(...roots(0, p[0] - 2 * p[1] + p[2], p[1] - p[0]));
    else if (p.length === 4) ts.push(...roots(-p[0] + 3 * p[1] - 3 * p[2] + p[3], 2 * (p[0] - 2 * p[1] + p[2]), p[1] - p[0]));
  }
  const points = ts.filter(t => t >= 0 && t <= 1).map(t => evaluateSegment(s, t));
  const lo: SvgPoint = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))];
  return { at: lo, size: [Math.max(...points.map(p => p[0])) - lo[0], Math.max(...points.map(p => p[1])) - lo[1]] };
}
export function geometryBounds(segments: SvgSegment[]): SvgBounds {
  if (!segments.length) throw new Error('SVG contains no supported geometry.');
  const boxes = segments.map(segmentBounds),
    lo: SvgPoint = [Math.min(...boxes.map(b => b.at[0])), Math.min(...boxes.map(b => b.at[1]))];
  const size: SvgPoint = [
    Math.max(...boxes.map(b => b.at[0] + b.size[0])) - lo[0],
    Math.max(...boxes.map(b => b.at[1] + b.size[1])) - lo[1],
  ];
  [...lo, ...size].forEach(n => finite(n));
  return { at: lo, size };
}
