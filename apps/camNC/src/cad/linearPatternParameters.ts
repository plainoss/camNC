import type { CadLengthUnit } from '@wbcnc/cad';
import { lengthText } from './designUnits';
import type { CadLinearPattern, CadLinearPatternExpressions, CadSketchPattern, CadPoint, CadSketch, CadValueScope } from '@wbcnc/cad';
import { cadExpressionNames, entityPointIds, patternSourceIds } from '@wbcnc/cad';
import { parseCadValue } from './valueExpressions';
export interface LinearPatternParameters {
  countX: string;
  countY: string;
  spacingX: string;
  spacingY: string;
  angleX: string;
  angleY: string;
  secondDirection: boolean;
}
export const initialLinearPatternParameters = (lengthUnit: CadLengthUnit = 'mm'): LinearPatternParameters => ({
  countX: '3',
  countY: '2',
  spacingX: lengthText(40, lengthUnit),
  spacingY: lengthText(40, lengthUnit),
  angleX: '0',
  angleY: '90',
  secondDirection: false,
});
export function linearPatternParameters(pattern: CadLinearPattern, lengthUnit: CadLengthUnit = 'mm'): LinearPatternParameters {
  return {
    countX: pattern.expressions?.countX ?? String(pattern.countX),
    countY: pattern.expressions?.countY ?? String(pattern.countY > 1 ? pattern.countY : 2),
    spacingX: pattern.expressions?.spacingX ?? lengthText(Math.hypot(pattern.stepX.x, pattern.stepX.y), lengthUnit),
    spacingY: pattern.expressions?.spacingY ?? lengthText(Math.hypot(pattern.stepY.x, pattern.stepY.y), lengthUnit),
    angleX: String((Math.atan2(pattern.stepX.y, pattern.stepX.x) * 180) / Math.PI),
    angleY: String((Math.atan2(pattern.stepY.y, pattern.stepY.x) * 180) / Math.PI),
    secondDirection: pattern.countY > 1,
  };
}
/** Counts and spacings may use the design's variables; those are kept as typed so the pattern follows them. */
export function parseLinearPatternParameters(
  parameters: LinearPatternParameters,
  variables?: CadValueScope,
  lengthUnit: CadLengthUnit = 'mm'
) {
  const expressions: CadLinearPatternExpressions = {};
  const read = (key: Exclude<keyof LinearPatternParameters, 'secondDirection'>, unit: 'mm' | 'deg' | 'scalar') => {
    const result = parseCadValue(parameters[key], { unit, variables, lengthUnit });
    if ('error' in result) throw new Error(result.error);
    if (
      (key === 'countX' || key === 'countY' || key === 'spacingX' || key === 'spacingY') &&
      result.expression &&
      cadExpressionNames(result.expression).length
    ) {
      expressions[key] = result.expression;
      // A count from variables says how many fit, so it rounds down, as the pattern does when they change.
      if (key === 'countX' || key === 'countY') return Math.floor(result.value + 1e-9);
    }
    return result.value;
  };
  const vector = (spacing: number, angle: number) => {
    const r = (angle * Math.PI) / 180;
    const x = spacing * Math.cos(r),
      y = spacing * Math.sin(r);
    return { x: Math.abs(x) < 1e-12 ? 0 : x, y: Math.abs(y) < 1e-12 ? 0 : y };
  };
  try {
    return {
      ok: true as const,
      countX: read('countX', 'scalar'),
      countY: parameters.secondDirection ? read('countY', 'scalar') : 1,
      stepX: vector(read('spacingX', 'mm'), read('angleX', 'deg')),
      stepY: vector(read('spacingY', 'mm'), read('angleY', 'deg')),
      ...(Object.keys(expressions).length && { expressions }),
    };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
  }
}
export function linearPatternAnchor(sketch: CadSketch, ids: readonly string[]): CadPoint {
  const wanted = new Set(
    ids.flatMap(id => {
      const e = sketch.entities.find(e => e.id === id);
      return !e ? [] : e.type === 'point' ? [id] : entityPointIds(e);
    })
  );
  const points = sketch.entities.filter(e => e.type === 'point' && wanted.has(e.id));
  const xs = points.flatMap(e => (e.type === 'point' ? [e.x] : [])),
    ys = points.flatMap(e => (e.type === 'point' ? [e.y] : []));
  return xs.length ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 } : { x: 0, y: 0 };
}
export const editablePatternSources = (pattern: CadSketchPattern) => patternSourceIds(pattern);
