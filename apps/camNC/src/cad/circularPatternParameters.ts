import type { CadLengthUnit } from '@wbcnc/cad';
import { lengthText } from './designUnits';
import type { CadCircularPattern, CadSketch } from '@wbcnc/cad';
import { parseCadValue } from './valueExpressions';
export interface CircularPatternParameters {
  count: string;
  angle: string;
  centerX: string;
  centerY: string;
  closed: boolean;
}
export const initialCircularPatternParameters = (): CircularPatternParameters => ({
  count: '3',
  angle: '360',
  centerX: '0',
  centerY: '0',
  closed: true,
});
export function circularPatternParameters(
  pattern: CadCircularPattern,
  sketch: CadSketch,
  lengthUnit: CadLengthUnit = 'mm'
): CircularPatternParameters {
  const center = sketch.entities.find(e => e.id === pattern.centerId);
  return {
    count: String(pattern.countX),
    angle: String(pattern.angle),
    closed: pattern.closed,
    centerX: lengthText(center?.type === 'point' ? center.x : 0, lengthUnit),
    centerY: lengthText(center?.type === 'point' ? center.y : 0, lengthUnit),
  };
}
export function parseCircularPatternParameters(parameters: CircularPatternParameters, lengthUnit: CadLengthUnit = 'mm') {
  const read = (text: string, unit: 'mm' | 'deg' | 'scalar') => {
    const p = parseCadValue(text, { unit, lengthUnit });
    if ('error' in p) throw new Error(p.error);
    return p.value;
  };
  try {
    return {
      ok: true as const,
      count: read(parameters.count, 'scalar'),
      angle: parameters.closed ? (read(parameters.angle, 'deg') < 0 ? -360 : 360) : read(parameters.angle, 'deg'),
      closed: parameters.closed,
      center: { x: read(parameters.centerX, 'mm'), y: read(parameters.centerY, 'mm') },
    };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
  }
}
