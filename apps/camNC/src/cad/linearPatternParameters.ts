import type { CadLinearPattern, CadSketchPattern, CadPoint, CadSketch } from '@wbcnc/cad';
import { entityPointIds, patternSourceIds } from '@wbcnc/cad';
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
export const initialLinearPatternParameters = (): LinearPatternParameters => ({
  countX: '3',
  countY: '2',
  spacingX: '40',
  spacingY: '40',
  angleX: '0',
  angleY: '90',
  secondDirection: false,
});
export function linearPatternParameters(pattern: CadLinearPattern): LinearPatternParameters {
  return {
    countX: String(pattern.countX),
    countY: String(pattern.countY > 1 ? pattern.countY : 2),
    spacingX: String(Math.hypot(pattern.stepX.x, pattern.stepX.y)),
    spacingY: String(Math.hypot(pattern.stepY.x, pattern.stepY.y)),
    angleX: String((Math.atan2(pattern.stepX.y, pattern.stepX.x) * 180) / Math.PI),
    angleY: String((Math.atan2(pattern.stepY.y, pattern.stepY.x) * 180) / Math.PI),
    secondDirection: pattern.countY > 1,
  };
}
export function parseLinearPatternParameters(parameters: LinearPatternParameters) {
  const read = (key: Exclude<keyof LinearPatternParameters, 'secondDirection'>, unit: 'mm' | 'deg' | 'scalar') => {
    const result = parseCadValue(parameters[key], { unit });
    if ('error' in result) throw new Error(result.error);
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
