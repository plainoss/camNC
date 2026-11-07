import { newCadId } from './document';
import { pointEquivalence } from './pointEquivalence';
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

/** Seed diameter edits on the detached solve copy while keeping logical axis point IDs stable. */
export function conditionEllipseAxes(sketch: CadSketch): void {
  const points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
  const equivalent = pointEquivalence(sketch.constraints);
  const fixed = new Set([...points.values()].filter(p => p.fixed).map(p => equivalent.canonical(p.id)));
  for (const ellipse of sketch.entities) {
    if (ellipse.type !== 'ellipse') continue;
    const center = points.get(ellipse.centerId)!,
      focus = points.get(ellipse.focusId)!;
    const majorStart = points.get(ellipse.majorStartId)!,
      majorEnd = points.get(ellipse.majorEndId)!;
    const minorStart = points.get(ellipse.minorStartId)!,
      minorEnd = points.get(ellipse.minorEndId)!;
    const driver = (a: string, b: string) =>
      sketch.constraints.find(
        c =>
          c.type === 'distance' &&
          !c.driven &&
          ((equivalent.equivalent(c.pointAId, a) && equivalent.equivalent(c.pointBId, b)) ||
            (equivalent.equivalent(c.pointAId, b) && equivalent.equivalent(c.pointBId, a)))
      );
    const majorDriver = driver(majorStart.id, majorEnd.id),
      minorDriver = driver(minorStart.id, minorEnd.id);
    if (!majorDriver && !minorDriver) continue;
    const currentMajor = Math.hypot(majorStart.x - majorEnd.x, majorStart.y - majorEnd.y) / 2;
    const currentMinor = Math.hypot(minorStart.x - minorEnd.x, minorStart.y - minorEnd.y) / 2;
    const a = majorDriver && 'value' in majorDriver ? majorDriver.value / 2 : currentMajor;
    const b = minorDriver && 'value' in minorDriver ? minorDriver.value / 2 : currentMinor;
    if (
      ![a, b].every(v => Number.isFinite(v) && v > 0) ||
      (Math.abs(a - currentMajor) < 1e-9 && Math.abs(b - currentMinor) < 1e-9 && b <= a)
    )
      continue;
    const unit = (p: CadPoint) => {
      const length = Math.hypot(p.x - center.x, p.y - center.y);
      return { x: (p.x - center.x) / length, y: (p.y - center.y) / length };
    };
    const u = unit(majorStart),
      v = unit(minorStart);
    const move = (point: CadPointEntity, x: number, y: number) => {
      if (!fixed.has(equivalent.canonical(point.id))) {
        point.x = x;
        point.y = y;
      }
    };
    move(majorStart, center.x + a * u.x, center.y + a * u.y);
    move(majorEnd, center.x - a * u.x, center.y - a * u.y);
    move(minorStart, center.x + b * v.x, center.y + b * v.y);
    move(minorEnd, center.x - b * v.x, center.y - b * v.y);
    const swapped = b > a;
    if (swapped) {
      [ellipse.majorStartId, ellipse.majorEndId, ellipse.minorStartId, ellipse.minorEndId] = [
        minorStart.id,
        minorEnd.id,
        majorEnd.id,
        majorStart.id,
      ];
      ellipse.primaryAxis = ellipse.primaryAxis === 'major' ? 'minor' : 'major';
    }
    const major = Math.max(a, b),
      minor = Math.min(Math.min(a, b), major - Math.min(1e-8, major * 1e-8));
    const direction = swapped ? v : u,
      focal = Math.sqrt((major - minor) * (major + minor));
    ellipse.radius = minor;
    move(focus, center.x + direction.x * focal, center.y + direction.y * focal);
  }
}
