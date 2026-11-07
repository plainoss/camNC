import { addArc } from './document';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import type { CadPoint, CadSketch } from './types';
const tau = Math.PI * 2;
const wrap = (angle: number) => ((angle % tau) + tau) % tau;
/** Radius is set by the start. The end supplies direction; sweep intent permits major arcs. */
export function centerPointArcFromPoints(center: CadPoint, start: CadPoint, end: CadPoint, sweepIntent = 0) {
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const endRadius = Math.hypot(end.x - center.x, end.y - center.y);
  if (
    ![center.x, center.y, start.x, start.y, end.x, end.y, radius, endRadius, sweepIntent].every(Number.isFinite) ||
    Math.min(radius, endRadius) <= CAD_GEOMETRY_TOLERANCE
  )
    return null;
  const first = Math.atan2(start.y - center.y, start.x - center.x),
    last = Math.atan2(end.y - center.y, end.x - center.x);
  const delta = Math.atan2(Math.sin(last - first), Math.cos(last - first));
  const direction = Math.abs(sweepIntent) > 1e-8 ? Math.sign(sweepIntent) : Math.sign(delta);
  const sweep = direction >= 0 ? wrap(last - first) : wrap(first - last);
  if (radius * sweep <= CAD_GEOMETRY_TOLERANCE || radius * (tau - sweep) <= CAD_GEOMETRY_TOLERANCE) return null;
  return { cx: center.x, cy: center.y, radius, startAngle: direction >= 0 ? first : last, endAngle: direction >= 0 ? last : first };
}
export function addCenterPointArc(
  sketch: CadSketch,
  options: { center: CadPoint; start: CadPoint; end: CadPoint; sweepIntent?: number; construction?: boolean }
): CadSketch {
  const arc = centerPointArcFromPoints(options.center, options.start, options.end, options.sweepIntent);
  if (!arc) throw new Error('Choose a nonzero radius and an arc end away from its center and start.');
  return addArc(sketch, { ...arc, construction: options.construction });
}
