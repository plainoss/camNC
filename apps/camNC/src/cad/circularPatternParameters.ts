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
export function circularPatternParameters(pattern: CadCircularPattern, sketch: CadSketch): CircularPatternParameters {
  const center = sketch.entities.find(e => e.id === pattern.centerId);
  return {
    count: String(pattern.countX),
    angle: String(pattern.angle),
    closed: pattern.closed,
    centerX: String(center?.type === 'point' ? center.x : 0),
    centerY: String(center?.type === 'point' ? center.y : 0),
  };
}
export function parseCircularPatternParameters(parameters: CircularPatternParameters) {
  const read = (text: string, unit: 'mm' | 'deg' | 'scalar') => {
    const p = parseCadValue(text, { unit });
    if ('error' in p) throw new Error(p.error);
    return p.value;
  };
  try {
    return {
      ok: true as const,
      count: read(parameters.count, 'scalar'),
      angle: parameters.closed ? 360 : read(parameters.angle, 'deg'),
      closed: parameters.closed,
      center: { x: read(parameters.centerX, 'mm'), y: read(parameters.centerY, 'mm') },
    };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
  }
}
