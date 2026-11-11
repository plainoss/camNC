import { rationalBezierSpans, type RationalCurveData } from './curves';
import type { CadEntity, CadLengthUnit, CadSketch } from './types';

/** What a sketch export writes, beyond the sketch's own curves. */
export interface SketchExportOptions {
  /** The file's unit. Sketch values are mm and are converted. Defaults to mm. */
  unit?: CadLengthUnit;
  /** Also write construction geometry, on its own layer or group. Off by default: it's reference geometry. */
  construction?: boolean;
}
export type SketchExportEntity = Exclude<CadEntity, { type: 'point' }>;
export interface SketchExportCurve {
  entity: SketchExportEntity;
  construction: boolean;
}

export const cadLengthUnitMm: Record<CadLengthUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

/**
 * The curves of a sketch as drawn, open chains included. Points, dimensions and constraints aren't geometry to export,
 * nor are a face's own edges or a spline's tangent handles, which only steer drawing.
 */
export function sketchExportCurves(sketch: CadSketch, construction = false): SketchExportCurve[] {
  const curves: SketchExportCurve[] = [];
  for (const entity of sketch.entities) {
    if (entity.type === 'point' || entity.faceEdge || (entity.type === 'line' && entity.owner)) continue;
    if (entity.construction && !construction) continue;
    curves.push({ entity, construction: !!entity.construction });
  }
  return curves;
}

/** Fixed decimals, no exponent and no "-0", which every reader parses the same. */
export function formatExportNumber(value: number, decimals = 9): string {
  const text = value.toFixed(decimals).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
}

/** Whether the curve's knots start and end with degree + 1 repeats, the form DXF and STEP readers expect. */
const isClamped = (data: RationalCurveData) => {
  const { knots, degree, poles } = data;
  if (knots.length !== poles.length + degree + 1) return false;
  for (let i = 1; i <= degree; i++) if (knots[i] !== knots[0] || knots.at(-1 - i) !== knots.at(-1)) return false;
  return true;
};

/**
 * The same curve as a clamped B-spline. A closed spline's wrapped periodic basis becomes its exact Bézier spans joined
 * end to end, so readers that only take clamped knot vectors draw the same curve.
 */
export function clampedCurveData(data: RationalCurveData): RationalCurveData {
  if (isClamped(data)) return data;
  const d = data.degree,
    spans = rationalBezierSpans(data);
  const homogeneous = spans.flatMap((span, i) => (i ? span.controls.slice(1) : span.controls));
  const knots = [...Array(d + 1).fill(0)];
  for (let i = 1; i < spans.length; i++) knots.push(...Array(d).fill(i));
  knots.push(...Array(d + 1).fill(spans.length));
  return {
    degree: d,
    knots,
    poles: homogeneous.map(([x, y, w]) => ({ x: x / w, y: y / w })),
    weights: homogeneous.map(p => p[2]),
  };
}
