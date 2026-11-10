import { evaluateCurvePoint, evaluateCurveTangent, type CadEntity, type CadPoint, type CadPointEntity, type CadSketch } from '@wbcnc/cad';

export interface MeasuredBounds {
  at: [number, number];
  size: [number, number];
}
const valueAt = (coefficients: readonly number[], t: number) => coefficients.reduceRight((sum, coefficient) => sum * t + coefficient, 0);
function roots(coefficients: readonly number[]): number[] {
  const c = [...coefficients],
    scale = Math.max(...c.map(Math.abs), 1);
  while (c.length > 1 && Math.abs(c.at(-1)!) < 1e-13 * scale) c.pop();
  if (c.length === 1) return [];
  if (c.length === 2) {
    const root = -c[0]! / c[1]!;
    return root > 0 && root < 1 ? [root] : [];
  }
  const critical = roots(c.slice(1).map((v, i) => v * (i + 1)));
  const found = critical.filter(t => Math.abs(valueAt(c, t)) < 1e-10 * scale);
  const boundaries = [0, ...critical, 1];
  for (let i = 0; i + 1 < boundaries.length; i++) {
    let lo = boundaries[i]!,
      hi = boundaries[i + 1]!,
      low = valueAt(c, lo),
      high = valueAt(c, hi);
    if (low * high >= 0) continue;
    for (let j = 0; j < 60; j++) {
      const mid = (lo + hi) / 2,
        v = valueAt(c, mid);
      if (low * v <= 0) {
        hi = mid;
        high = v;
      } else {
        lo = mid;
        low = v;
      }
    }
    found.push((lo + hi) / 2);
  }
  return found;
}
const choose = (n: number, k: number) => {
  let value = 1;
  for (let i = 1; i <= k; i++) value = (value * (n - i + 1)) / i;
  return value;
};
function bernsteinPolynomial(values: readonly number[]) {
  const degree = values.length - 1;
  return values.map(
    (_, k) => choose(degree, k) * values.slice(0, k + 1).reduce((sum, value, i) => sum + (-1) ** (k - i) * choose(k, i) * value, 0)
  );
}
export function curveExtremaPoints(entity: Exclude<CadEntity, { type: 'point' }>, points: ReadonlyMap<string, CadPoint>): CadPoint[] {
  const at = (t: number) => evaluateCurvePoint(entity, points, t),
    parameters = [0, 1];
  if (entity.type === 'line') return parameters.map(at);
  if (entity.type === 'circle' || entity.type === 'arc') {
    const tau = 2 * Math.PI,
      wrap = (v: number) => ((v % tau) + tau) % tau;
    const start = entity.type === 'arc' ? entity.startAngle : 0,
      sweep = entity.type === 'arc' ? wrap(entity.endAngle - start) || tau : tau;
    for (let i = 0; i < 4; i++) {
      const t = wrap((i * Math.PI) / 2 - start) / sweep;
      if (t <= 1) parameters.push(t);
    }
  } else if (entity.type === 'ellipse') {
    const c = points.get(entity.centerId)!,
      f = points.get(entity.focusId)!,
      angle = Math.atan2(f.y - c.y, f.x - c.x);
    const a = Math.hypot(f.x - c.x, f.y - c.y, entity.radius),
      b = entity.radius,
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    const x = Math.atan2(-b * sin, a * cos),
      y = Math.atan2(b * cos, a * sin);
    return [x, x + Math.PI, y, y + Math.PI].map(t => ({
      x: c.x + a * Math.cos(t) * cos - b * Math.sin(t) * sin,
      y: c.y + a * Math.cos(t) * sin + b * Math.sin(t) * cos,
    }));
  } else if (entity.type === 'bezier') {
    for (const axis of ['x', 'y'] as const) {
      const coordinates = entity.controlPointIds.map(id => points.get(id)![axis]);
      const derivative = coordinates.slice(1).map((value, i) => (coordinates.length - 1) * (value - coordinates[i]!));
      parameters.push(...roots(bernsteinPolynomial(derivative)));
    }
  } else if (entity.type === 'spline') {
    const lo = entity.knots[entity.degree]!,
      hi = entity.knots[entity.closed ? entity.controlPointIds.length + 3 : entity.controlPointIds.length]!;
    const spans = [...new Set([0, ...entity.knots.filter(k => k > lo && k < hi).map(k => (k - lo) / (hi - lo)), 1])];
    if (entity.degree > 3 || entity.weights.some(w => Math.abs(w - 1) > 1e-12))
      throw new Error('Measured fitting supports polynomial splines up to degree three.');
    for (let i = 0; i + 1 < spans.length; i++)
      for (const axis of ['x', 'y'] as const) {
        const a = spans[i]!,
          b = spans[i + 1]!;
        const v0 = evaluateCurveTangent(entity, points, a)[axis],
          vm = evaluateCurveTangent(entity, points, (a + b) / 2)[axis],
          v1 = evaluateCurveTangent(entity, points, b)[axis];
        const quadratic = 2 * (v1 + v0 - 2 * vm),
          linear = v1 - v0 - quadratic;
        parameters.push(a, b, ...roots([v0, linear, quadratic]).map(t => a + t * (b - a)));
      }
  } else {
    // Rational conic derivative numerator is quadratic; the positive weight denominator cannot add extrema.
    const p = [points.get(entity.startId)!, points.get(entity.controlId)!, points.get(entity.endId)!],
      w = entity.rho / (1 - entity.rho);
    const denominator = [1, 2 * (w - 1), 2 * (1 - w)];
    for (const axis of ['x', 'y'] as const) {
      const n = [p[0]![axis], 2 * (w * p[1]![axis] - p[0]![axis]), p[0]![axis] - 2 * w * p[1]![axis] + p[2]![axis]];
      parameters.push(
        ...roots([
          n[1]! - n[0]! * denominator[1]!,
          2 * (n[2]! - n[0]! * denominator[2]!),
          n[2]! * denominator[1]! - n[1]! * denominator[2]!,
        ])
      );
    }
  }
  return parameters.map(at);
}
/** Measures actual analytic curves, never their control polygon or the rendered chord approximation. */
export function measuredSketchBounds(sketch: CadSketch, ids?: ReadonlySet<string>): MeasuredBounds {
  const points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
  const samples = sketch.entities.flatMap(e =>
    e.type === 'point' || (e.type === 'line' && e.owner) || (!ids && e.construction) || (ids && !ids.has(e.id))
      ? []
      : curveExtremaPoints(e, points)
  );
  if (!samples.length || samples.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('Measured bounds need valid sketch curves.');
  const minX = Math.min(...samples.map(p => p.x)),
    maxX = Math.max(...samples.map(p => p.x)),
    minY = Math.min(...samples.map(p => p.y)),
    maxY = Math.max(...samples.map(p => p.y));
  return { at: [minX, minY], size: [maxX - minX, maxY - minY] };
}
