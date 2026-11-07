import { newCadId } from './document';
import type { CadEllipseEntity, CadPoint, CadPointEntity, CadSketch } from './types';

/** Center, first radius/orientation, then perpendicular distance to the second radius. */
export function ellipseFromPoints(center: CadPoint, axis: CadPoint, through: CadPoint) {
  const dx = axis.x - center.x,
    dy = axis.y - center.y;
  const primary = Math.hypot(dx, dy);
  if (!Number.isFinite(primary) || primary < 0.1) return null;
  const ux = dx / primary,
    uy = dy / primary;
  const secondary = Math.abs((through.x - center.x) * -uy + (through.y - center.y) * ux);
  if (!Number.isFinite(secondary) || secondary < 0.1) return null;
  return { center, primary, secondary, angle: Math.atan2(dy, dx) };
}

export function addEllipse(
  sketch: CadSketch,
  options: {
    center: CadPoint;
    axis: CadPoint;
    through: CadPoint;
    construction?: boolean;
  }
): CadSketch {
  const shape = ellipseFromPoints(options.center, options.axis, options.through);
  if (!shape) throw new Error('Both ellipse radii must be at least 0.1 mm.');
  const primaryAxis = shape.primary >= shape.secondary ? 'major' : 'minor';
  const angle = shape.angle + (primaryAxis === 'minor' ? Math.PI / 2 : 0);
  const a = Math.max(shape.primary, shape.secondary);
  // The focal representation is singular for a perfect circle. Keep a focal separation
  // whose radial effect is below the model tolerance, preserving the placed orientation.
  const b = Math.min(Math.min(shape.primary, shape.secondary), a - Math.min(1e-8, a * 1e-8));
  const ux = Math.cos(angle),
    uy = Math.sin(angle),
    c = shape.center;
  const point = (x: number, y: number): CadPointEntity => ({ id: newCadId(), type: 'point', x, y, construction: options.construction });
  const center = point(c.x, c.y),
    focus = point(c.x + Math.sqrt(a * a - b * b) * ux, c.y + Math.sqrt(a * a - b * b) * uy);
  const majorStart = point(c.x + a * ux, c.y + a * uy),
    majorEnd = point(c.x - a * ux, c.y - a * uy);
  const minorStart = point(c.x - b * uy, c.y + b * ux),
    minorEnd = point(c.x + b * uy, c.y - b * ux);
  const ellipse: CadEllipseEntity = {
    id: newCadId(),
    type: 'ellipse',
    centerId: center.id,
    focusId: focus.id,
    majorStartId: majorStart.id,
    majorEndId: majorEnd.id,
    minorStartId: minorStart.id,
    minorEndId: minorEnd.id,
    radius: b,
    primaryAxis,
    construction: options.construction,
  };
  return { ...sketch, entities: [...sketch.entities, center, focus, majorStart, majorEnd, minorStart, minorEnd, ellipse] };
}
