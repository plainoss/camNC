import type { CadLengthUnit } from '@wbcnc/cad';
import { lengthText } from './designUnits';
import type { CadPoint } from '@wbcnc/cad';
import { parseCadValue } from './valueExpressions';
export type TransformDragKind = 'translate' | 'rotate' | 'scale' | 'pivot';
export interface TransformParameters {
  dx: string;
  dy: string;
  angle: string;
  scale: string;
  pivotX: string;
  pivotY: string;
  copy: boolean;
}
export const initialTransformParameters = (pivot: CadPoint = { x: 0, y: 0 }, lengthUnit: CadLengthUnit = 'mm'): TransformParameters => ({
  dx: '0',
  dy: '0',
  angle: '0',
  scale: '1',
  pivotX: lengthText(pivot.x, lengthUnit),
  pivotY: lengthText(pivot.y, lengthUnit),
  copy: false,
});
export function parseTransformParameters(parameters: TransformParameters, lengthUnit: CadLengthUnit = 'mm') {
  const read = (key: Exclude<keyof TransformParameters, 'copy'>, unit: 'mm' | 'deg' | 'scalar') => {
    const result = parseCadValue(parameters[key], { unit, lengthUnit });
    if ('error' in result) throw new Error(result.error);
    return result.value;
  };
  try {
    return {
      ok: true as const,
      translation: { x: read('dx', 'mm'), y: read('dy', 'mm') },
      angle: read('angle', 'deg'),
      scale: read('scale', 'scalar'),
      pivot: { x: read('pivotX', 'mm'), y: read('pivotY', 'mm') },
      copy: parameters.copy,
    };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
  }
}
/** Repositioning the pivot preserves the current similarity map; it only changes its parameterization. */
export function repositionTransformPivot(
  parameters: TransformParameters,
  pivot: CadPoint,
  lengthUnit: CadLengthUnit = 'mm'
): TransformParameters {
  const value = parseTransformParameters(parameters, lengthUnit);
  if (!value.ok) return { ...parameters, pivotX: lengthText(pivot.x, lengthUnit), pivotY: lengthText(pivot.y, lengthUnit) };
  const dx = value.pivot.x - pivot.x,
    dy = value.pivot.y - pivot.y,
    r = (value.angle * Math.PI) / 180,
    c = value.scale * Math.cos(r),
    s = value.scale * Math.sin(r);
  return {
    ...parameters,
    pivotX: lengthText(pivot.x, lengthUnit),
    pivotY: lengthText(pivot.y, lengthUnit),
    dx: lengthText(value.translation.x + (1 - c) * dx + s * dy, lengthUnit),
    dy: lengthText(value.translation.y - s * dx + (1 - c) * dy, lengthUnit),
  };
}
