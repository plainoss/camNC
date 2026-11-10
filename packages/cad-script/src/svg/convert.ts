import { addBezier, addConic, addConstraint, addLine, type CadSketch } from '@wbcnc/cad';
import { geometryBounds } from './bounds';
import { filledContours } from './topology';
import { finite, SVG_LIMITS, type SvgPlacement, type SvgPoint, type SvgSegment, type SvgSketchAsset } from './types';
/** Placement uses actual curve extrema. Uniform contain preserves the source's proportions. */
export function placedSvgSegments(asset: SvgSketchAsset, placement: SvgPlacement = {}): SvgSegment[] {
  if (asset.version !== 1 || asset.units !== 'mm') throw new Error('Unsupported SVG geometry version.');
  const source = asset.contours.flatMap(c => c.segments);
  if (!source.length || source.length > SVG_LIMITS.segments) throw new Error('Unsupported SVG segment count.');
  for (const segment of source) {
    const expected = segment.kind === 'line' ? 2 : segment.kind === 'conic' ? 3 : segment.kind === 'bezier' ? segment.points.length : 0;
    if (!expected || segment.points.length !== expected || expected > 4 || (segment.kind === 'bezier' && expected < 3))
      throw new Error('Invalid SVG curve descriptor.');
    for (const p of segment.points) {
      if (p.length !== 2) throw new Error('Invalid SVG point.');
      p.forEach(n => finite(n));
    }
    if (segment.kind === 'conic' && (!Number.isFinite(segment.rho) || segment.rho <= 0 || segment.rho >= 1))
      throw new Error('Invalid SVG conic weight.');
  }
  const bounds = geometryBounds(source),
    at = placement.at ?? [0, 0];
  if (at.length !== 2) throw new Error('SVG placement needs two coordinates.');
  at.forEach(n => finite(n, 'SVG placement'));
  for (const n of [placement.width, placement.height])
    if (n !== undefined && (!Number.isFinite(n) || n <= 0 || n > SVG_LIMITS.coordinate))
      throw new Error('SVG fit dimensions must be positive and finite.');
  if (bounds.size.some(n => n <= 0)) throw new Error('Cannot fit zero-size SVG geometry.');
  let sx = placement.width === undefined ? undefined : placement.width / bounds.size[0],
    sy = placement.height === undefined ? undefined : placement.height / bounds.size[1];
  if (placement.preserveAspect !== false) sx = sy = Math.min(sx ?? Infinity, sy ?? Infinity);
  if (sx === Infinity) sx = sy = 1;
  sx ??= sy ?? 1;
  sy ??= sx;
  const point = (p: SvgPoint): SvgPoint => [finite((p[0] - bounds.at[0]) * sx + at[0]), finite((p[1] - bounds.at[1]) * sy + at[1])];
  return source.map(s => ({ ...s, points: s.points.map(point) }) as SvgSegment);
}
/** Import native, individually editable curves. Position dimensions record the imported
 * control polygon; SVG does not recover tangency, symmetry or other authored CAD intent.
 * Build separately so import never silently attaches to pre-existing sketch points.
 */
export function appendSvgToSketch(sketch: CadSketch, asset: SvgSketchAsset, placement: SvgPlacement = {}): CadSketch {
  let imported: CadSketch = { ...sketch, entities: [], constraints: [] };
  const segments = placedSvgSegments(asset, placement);
  let offset = 0;
  // Fitting can shrink a formerly safe gap below CAD's point-sharing tolerance.
  // Validate in final millimetres before adding any native geometry.
  filledContours(
    asset.contours.map(contour => {
      const own = segments.slice(offset, offset + contour.segments.length);
      offset += own.length;
      return { ...contour, segments: own };
    })
  );
  for (const segment of segments) {
    const p = segment.points.map(([x, y]) => ({ x, y }));
    if (segment.kind === 'line') imported = addLine(imported, { x1: p[0].x, y1: p[0].y, x2: p[1].x, y2: p[1].y });
    else if (segment.kind === 'bezier') imported = addBezier(imported, { points: p });
    else imported = addConic(imported, { start: p[0], control: p[1], end: p[2], rho: segment.rho });
  }
  for (const point of imported.entities)
    if (point.type === 'point') {
      imported = addConstraint(imported, { type: 'positionX', pointId: point.id, value: point.x, label: 'Imported X' });
      imported = addConstraint(imported, { type: 'positionY', pointId: point.id, value: point.y, label: 'Imported Y' });
    }
  return { ...sketch, entities: [...sketch.entities, ...imported.entities], constraints: [...sketch.constraints, ...imported.constraints] };
}
