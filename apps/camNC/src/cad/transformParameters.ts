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
export const initialTransformParameters = (pivot: CadPoint = { x: 0, y: 0 }): TransformParameters => ({
  dx: '0',
  dy: '0',
  angle: '0',
  scale: '1',
  pivotX: String(pivot.x),
  pivotY: String(pivot.y),
  copy: false,
});
export function parseTransformParameters(parameters: TransformParameters) {
  const read = (key: Exclude<keyof TransformParameters, 'copy'>, unit: 'mm' | 'deg' | 'scalar') => {
    const result = parseCadValue(parameters[key], { unit });
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
export function repositionTransformPivot(parameters: TransformParameters, pivot: CadPoint): TransformParameters {
  const value = parseTransformParameters(parameters);
  if (!value.ok) return { ...parameters, pivotX: String(pivot.x), pivotY: String(pivot.y) };
  const dx = value.pivot.x - pivot.x,
    dy = value.pivot.y - pivot.y,
    r = (value.angle * Math.PI) / 180,
    c = value.scale * Math.cos(r),
    s = value.scale * Math.sin(r);
  return {
    ...parameters,
    pivotX: String(pivot.x),
    pivotY: String(pivot.y),
    dx: String(value.translation.x + (1 - c) * dx + s * dy),
    dy: String(value.translation.y - s * dx + (1 - c) * dy),
  };
}
