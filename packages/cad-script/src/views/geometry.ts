import {
  activeDesign,
  cadCopyName,
  cadDrawnOnSupports,
  consumedTools,
  effectivePlacement,
  evaluatedPartCopy,
  isCadBody,
  placePoint,
  type CadDocument,
  type CadEvaluation,
  type CadPlacement,
  type CadPoint,
  type EvaluatedCadPart,
} from '@wbcnc/cad';
import { reportGeometry } from '../reportGeometry';

export type ViewPoint = [number, number, number];
export interface CadViewBody {
  id: string;
  name: string;
  shape: EvaluatedCadPart;
  placement?: CadPlacement;
}
export interface CadViewLine {
  body: string;
  kind: 'outline' | 'hole' | 'cut';
  cut?: string;
  /** Open side edges or closed cap contours, already transformed into the assembly. */
  points: ViewPoint[];
  closed: boolean;
}

/** Physical pieces, with each copy's own evaluated cuts, in the same places CAM names them. */
export function cadViewBodies(given: CadDocument, parts: readonly EvaluatedCadPart[], evaluation?: CadEvaluation): CadViewBody[] {
  const geometry = reportGeometry(given, parts, evaluation);
  const document = activeDesign(geometry.document);
  const supports = cadDrawnOnSupports(document),
    consumed = consumedTools(document);
  return document.parts.flatMap(source => {
    const shape = geometry.parts.find(part => part.partId === source.id);
    if (!shape || !isCadBody(document, source) || consumed.has(source.id) || !shape.outline.length) return [];
    return [
      { id: source.id, name: source.name, shape, placement: effectivePlacement(source, supports) },
      ...(source.copies ?? []).map((copy, index) => ({
        id: `${source.id}:${copy.id}`,
        name: cadCopyName(source, index),
        shape: evaluatedPartCopy(shape, copy),
        placement: copy.placement,
      })),
    ];
  });
}

/** Extruded evaluated contours, not boxes: cut floors, islands and both faces stay visible as line drawings. */
export function cadViewLines(body: CadViewBody): CadViewLine[] {
  const result: CadViewLine[] = [];
  const world = (point: CadPoint, z: number) => placePoint(body.placement, [point.x, point.y, z]);
  const contour = (points: readonly CadPoint[], low: number, high: number, kind: CadViewLine['kind'], cut?: string) => {
    if (!points.length) return;
    for (const z of low === high ? [low] : [low, high])
      result.push({ body: body.name, kind, ...(cut && { cut }), points: points.map(point => world(point, z)), closed: true });
    if (high === low) return;
    for (const [index, point] of points.entries()) {
      const previous = points[(index + points.length - 1) % points.length],
        next = points[(index + 1) % points.length];
      const ax = point.x - previous.x,
        ay = point.y - previous.y,
        bx = next.x - point.x,
        by = next.y - point.y;
      // Straight tessellation vertices carry no edge. Keeping only turns avoids a dark wall of redundant verticals.
      if (Math.abs(ax * by - ay * bx) < 1e-8) continue;
      result.push({ body: body.name, kind, ...(cut && { cut }), points: [world(point, low), world(point, high)], closed: false });
    }
  };
  const shape = body.shape;
  contour(shape.outline, 0, shape.thickness, 'outline');
  for (const hole of shape.holes) contour(hole, 0, shape.thickness, 'hole');
  for (const cut of shape.cuts ?? []) {
    const low = cut.side === 'underside' ? cut.from : shape.thickness - cut.to;
    const high = cut.side === 'underside' ? cut.to : shape.thickness - cut.from;
    contour(cut.outline, low, high, 'cut', cut.id);
    for (const island of cut.islands) contour(island, low, high, 'cut', cut.id);
  }
  return result;
}

export const svgNumber = (value: number) => Number(value.toFixed(3));
export const svgText = (value: string) =>
  value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
