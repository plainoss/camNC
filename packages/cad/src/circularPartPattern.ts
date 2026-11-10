import type { CadCircularPartPattern } from './types';

const finiteVector = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

/** Used by file loading and direct edits, so an invalid picked line never produces NaN placements. */
export function validCircularPartPattern(value: unknown): value is CadCircularPartPattern {
  if (!value || typeof value !== 'object') return false;
  const pattern = value as CadCircularPartPattern;
  return (
    finiteVector(pattern.origin) &&
    finiteVector(pattern.axis) &&
    Math.hypot(...pattern.axis) > 0 &&
    Number.isFinite(Math.hypot(...pattern.axis)) &&
    Number.isFinite(pattern.angle) &&
    (pattern.angleExpression === undefined || typeof pattern.angleExpression === 'string') &&
    (pattern.equalSpacing === undefined || typeof pattern.equalSpacing === 'boolean') &&
    (pattern.opposite === undefined || typeof pattern.opposite === 'boolean')
  );
}

/** The seed counts as instance zero. A closed ring omits the duplicate endpoint of the total sweep. */
export function circularPartPatternStep(pattern: CadCircularPartPattern, count: number): number {
  if (!validCircularPartPattern(pattern)) throw new Error('Invalid CAD circular part pattern');
  const closed = Math.abs(Math.abs(pattern.angle) - 360) < 1e-9;
  const divisor = pattern.equalSpacing === false ? 1 : closed ? count : Math.max(1, count - 1);
  return (pattern.angle / divisor) * (pattern.opposite ? -1 : 1);
}
