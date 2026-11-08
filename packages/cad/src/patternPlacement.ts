import type { CadSketchPattern, CadPatternInstance, CadPoint, CadEntity } from './types';
export function patternAngle(pattern: CadSketchPattern, instance: Pick<CadPatternInstance, 'x' | 'y'>): number {
  return pattern.type === 'circularPattern'
    ? ((instance.x - pattern.masterX) * pattern.angle * Math.PI) / 180 / (pattern.closed ? pattern.countX : pattern.countX - 1)
    : 0;
}
export function patternPosition(
  pattern: CadSketchPattern,
  instance: Pick<CadPatternInstance, 'x' | 'y'>,
  point: CadPoint,
  entities: ReadonlyMap<string, CadEntity>
): CadPoint {
  if (pattern.type === 'linearPattern')
    return {
      x: point.x + (instance.x - pattern.masterX) * pattern.stepX.x + (instance.y - pattern.masterY) * pattern.stepY.x,
      y: point.y + (instance.x - pattern.masterX) * pattern.stepX.y + (instance.y - pattern.masterY) * pattern.stepY.y,
    };
  const center = entities.get(pattern.centerId);
  if (center?.type !== 'point') return { x: NaN, y: NaN };
  const a = patternAngle(pattern, instance),
    c = Math.cos(a),
    s = Math.sin(a),
    x = point.x - center.x,
    y = point.y - center.y;
  return { x: center.x + c * x - s * y, y: center.y + s * x + c * y };
}
