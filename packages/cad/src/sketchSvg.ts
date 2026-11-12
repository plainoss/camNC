import { isNurbsCurve, rationalBezierSpans, rationalCurveData, tessellateCurve, tessellateRationalCurve } from './curves';
import {
  cadLengthUnitMm,
  clampedCurveData,
  formatExportNumber,
  sketchExportCurves,
  type SketchExportCurve,
  type SketchExportEntity,
  type SketchExportOptions,
} from './sketchExport';
import type { CadLengthUnit, CadPoint, CadSketch } from './types';

export interface SketchSvgOptions extends SketchExportOptions {
  /** Chord tolerance in mm for the curves SVG can't draw exactly. */
  tolerance?: number;
}

/** SVG has no m or ft, so those sizes are given in a unit it has. */
const svgSize: Record<CadLengthUnit, { unit: string; factor: number }> = {
  mm: { unit: 'mm', factor: 1 },
  cm: { unit: 'cm', factor: 1 },
  m: { unit: 'cm', factor: 100 },
  in: { unit: 'in', factor: 1 },
  ft: { unit: 'in', factor: 12 },
};
const tau = 2 * Math.PI;
/** Stroke width in mm. */
const STROKE = 0.25;

/** A curve's extent in sketch mm: exact for lines, circles, arcs and ellipses; splines within 0.001 mm. */
function curveBounds(entity: SketchExportEntity, points: ReadonlyMap<string, CadPoint>) {
  const extent = (list: CadPoint[]) => ({
    minX: Math.min(...list.map(p => p.x)),
    minY: Math.min(...list.map(p => p.y)),
    maxX: Math.max(...list.map(p => p.x)),
    maxY: Math.max(...list.map(p => p.y)),
  });
  if (entity.type === 'line') return extent([points.get(entity.startId)!, points.get(entity.endId)!]);
  if (entity.type === 'circle' || entity.type === 'arc') {
    const c = points.get(entity.centerId)!,
      r = entity.radius;
    const on = (angle: number) => ({ x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) });
    if (entity.type === 'circle') return extent([on(0), on(Math.PI / 2), on(Math.PI), on((3 * Math.PI) / 2)]);
    const sweep = (((entity.endAngle - entity.startAngle) % tau) + tau) % tau || tau;
    const quarters = [0, 1, 2, 3, 4, 5, 6, 7]
      .map(k => (k * Math.PI) / 2)
      .filter(angle => {
        const along = (((angle - entity.startAngle) % tau) + tau) % tau;
        return along <= sweep;
      });
    return extent([on(entity.startAngle), on(entity.startAngle + sweep), ...quarters.map(on)]);
  }
  if (entity.type === 'ellipse') {
    const c = points.get(entity.centerId)!,
      f = points.get(entity.focusId)!;
    const focal = Math.hypot(f.x - c.x, f.y - c.y),
      a = Math.hypot(focal, entity.radius),
      b = entity.radius;
    const angle = focal ? Math.atan2(f.y - c.y, f.x - c.x) : 0;
    const hx = Math.hypot(a * Math.cos(angle), b * Math.sin(angle)),
      hy = Math.hypot(a * Math.sin(angle), b * Math.cos(angle));
    return { minX: c.x - hx, maxX: c.x + hx, minY: c.y - hy, maxY: c.y + hy };
  }
  const box = extent(tessellateCurve(entity, points, 0.001));
  return { minX: box.minX - 0.001, minY: box.minY - 0.001, maxX: box.maxX + 0.001, maxY: box.maxY + 0.001 };
}

/**
 * The sketch as an SVG at 1:1 in `unit`. SVG's y points down, so y is negated and the sketch origin stays at (0, 0).
 * Lines, circles, arcs, ellipses and Bézier spans of degree 3 or less are exact. Rational spans, as conics and weighted
 * splines have, and higher degrees become polylines within `tolerance`.
 */
export function sketchToSvg(sketch: CadSketch, options: SketchSvgOptions = {}): string {
  const unit = options.unit ?? 'mm',
    scale = 1 / cadLengthUnitMm[unit],
    tolerance = options.tolerance ?? 0.01;
  const points = new Map<string, CadPoint>();
  for (const entity of sketch.entities) if (entity.type === 'point') points.set(entity.id, entity);
  const curves = sketchExportCurves(sketch, options.construction);

  const n = (value: number) => formatExportNumber(value, 6);
  const at = (p: CadPoint) => `${n(p.x * scale)} ${n(-p.y * scale)}`;
  // The curves' own extremes, then half the stroke, so nothing drawn is clipped at the edge.
  const box = curves.reduce(
    (all, { entity }) => {
      const b = curveBounds(entity, points);
      return {
        minX: Math.min(all.minX, b.minX),
        minY: Math.min(all.minY, b.minY),
        maxX: Math.max(all.maxX, b.maxX),
        maxY: Math.max(all.maxY, b.maxY),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
  const pad = STROKE / 2;
  // In the file's unit, with y flipped.
  const [minX, maxX, minY, maxY] = curves.length
    ? [(box.minX - pad) * scale, (box.maxX + pad) * scale, -(box.maxY + pad) * scale, -(box.minY - pad) * scale]
    : [0, 0, 0, 0];
  const width = maxX - minX,
    height = maxY - minY;

  function pathData({ entity }: SketchExportCurve): string {
    if (entity.type === 'line') return `M ${at(points.get(entity.startId)!)} L ${at(points.get(entity.endId)!)}`;
    if (entity.type === 'circle' || entity.type === 'arc') {
      const c = points.get(entity.centerId)!,
        r = entity.radius;
      const start = entity.type === 'arc' ? entity.startAngle : 0;
      const sweep = entity.type === 'arc' ? (((entity.endAngle - start) % tau) + tau) % tau || tau : tau;
      const on = (angle: number) => ({ x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) });
      // Counterclockwise in the sketch is clockwise once y is flipped: SVG's sweep flag 0. A full turn needs two arcs.
      const arc = (from: number, to: number) => `A ${n(r * scale)} ${n(r * scale)} 0 ${to - from > Math.PI ? 1 : 0} 0 ${at(on(to))}`;
      return sweep >= tau - 1e-12
        ? `M ${at(on(start))} ${arc(start, start + Math.PI)} ${arc(start + Math.PI, start + tau)} Z`
        : `M ${at(on(start))} ${arc(start, start + sweep)}`;
    }
    if (!isNurbsCurve(entity)) return '';
    if (entity.type === 'ellipse') {
      const c = points.get(entity.centerId)!,
        f = points.get(entity.focusId)!;
      const focal = Math.hypot(f.x - c.x, f.y - c.y),
        a = Math.hypot(focal, entity.radius);
      const angle = focal ? Math.atan2(f.y - c.y, f.x - c.x) : 0;
      const end = (sign: number) => ({ x: c.x + sign * a * Math.cos(angle), y: c.y + sign * a * Math.sin(angle) });
      const radii = `${n(a * scale)} ${n(entity.radius * scale)} ${n((-angle * 180) / Math.PI)}`;
      return `M ${at(end(1))} A ${radii} 0 0 ${at(end(-1))} A ${radii} 0 0 ${at(end(1))} Z`;
    }
    const data = clampedCurveData(rationalCurveData(entity, points));
    let d = '';
    for (const span of rationalBezierSpans(data)) {
      const controls = span.controls.map(([x, y, w]) => ({ x: x / w, y: y / w }));
      if (!d) d = `M ${at(controls[0]!)}`;
      const w0 = span.controls[0]![2];
      const polynomial = span.controls.every(p => Math.abs(p[2] - w0) <= 1e-12 * Math.abs(w0));
      if (polynomial && controls.length === 2) d += ` L ${at(controls[1]!)}`;
      else if (polynomial && controls.length === 3) d += ` Q ${at(controls[1]!)} ${at(controls[2]!)}`;
      else if (polynomial && controls.length === 4) d += ` C ${controls.slice(1).map(at).join(' ')}`;
      else {
        const polyline = tessellateRationalCurve(
          {
            degree: controls.length - 1,
            poles: controls,
            weights: span.controls.map(p => p[2]),
            knots: [...Array(controls.length).fill(0), ...Array(controls.length).fill(1)],
          },
          tolerance
        );
        d += polyline
          .slice(1)
          .map(p => ` L ${at(p)}`)
          .join('');
      }
    }
    return d;
  }

  const group = (id: string, style: string, chosen: SketchExportCurve[]) =>
    chosen.length ? `  <g id="${id}" ${style}>\n${chosen.map(curve => `    <path d="${pathData(curve)}"/>`).join('\n')}\n  </g>\n` : '';
  const stroke = `fill="none" stroke="#000" stroke-width="${n(STROKE * scale)}"`;
  const size = svgSize[unit];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width * size.factor)}${size.unit}" height="${n(height * size.factor)}${size.unit}" ` +
    `viewBox="${n(minX)} ${n(minY)} ${n(width)} ${n(height)}">\n` +
    group(
      'sketch',
      stroke,
      curves.filter(curve => !curve.construction)
    ) +
    group(
      'construction',
      `${stroke} stroke-dasharray="${n(2 * scale)} ${n(scale)}" opacity="0.6"`,
      curves.filter(curve => curve.construction)
    ) +
    '</svg>\n'
  );
}
