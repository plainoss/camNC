import { addCircle } from './document';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import type { CadPoint, CadSketch } from './types';

/** Circumcircle in local coordinates to avoid cancellation far from the origin. */
export function circleThroughThreePoints(a: CadPoint, b: CadPoint, c: CadPoint) {
  const ux = b.x - a.x,
    uy = b.y - a.y,
    vx = c.x - a.x,
    vy = c.y - a.y;
  const u = Math.hypot(ux, uy),
    v = Math.hypot(vx, vy),
    w = Math.hypot(c.x - b.x, c.y - b.y);
  const cross = ux * vy - uy * vx;
  if (
    ![a.x, a.y, b.x, b.y, c.x, c.y, cross].every(Number.isFinite) ||
    Math.min(u, v, w) <= CAD_GEOMETRY_TOLERANCE ||
    Math.abs(cross) <= CAD_GEOMETRY_TOLERANCE * Math.max(u, v, w)
  )
    return null;
  const u2 = ux * ux + uy * uy,
    v2 = vx * vx + vy * vy;
  const x = a.x + (vy * u2 - uy * v2) / (2 * cross);
  const y = a.y + (ux * v2 - vx * u2) / (2 * cross);
  const radius = Math.hypot(x - a.x, y - a.y);
  return [x, y, radius].every(Number.isFinite) ? { x, y, radius } : null;
}

/** Free creation does not introduce extra rim points or driving dimensions. */
export function addThreePointCircle(
  sketch: CadSketch,
  options: { points: readonly [CadPoint, CadPoint, CadPoint]; construction?: boolean }
) {
  const circle = circleThroughThreePoints(...options.points);
  if (!circle) throw new Error('Choose three distinct circle points that are not on one straight line.');
  return addCircle(sketch, { ...circle, construction: options.construction });
}
