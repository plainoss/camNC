import {
  entityPointIds as curvePointIds,
  evaluateCadPart,
  type CadDocument,
  type CadEntity,
  type CadPart,
  type CadSketch,
} from '@wbcnc/cad';

// Small helpers of the sketch editor, kept apart so the editor itself stays readable.

const pointsOf = (sketch: CadSketch) => new Map(sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));

export type ChainAnchor = { pointId: string; curveId: string };

export const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('input:not([type="checkbox"]),textarea,select,[contenteditable]');
export const entityPointIds = (entity: CadEntity): string[] => {
  if (entity.type === 'point') return [entity.id];
  return curvePointIds(entity);
};

/** A sketch of one straight line and nothing else, as a board drawn edge-on is. */
export const isSingleLine = (part: CadPart) => {
  const curves = part.sketch.entities.filter(entity => entity.type !== 'point' && !entity.construction);
  return curves.length === 1 && curves[0]!.type === 'line';
};
/** A part with nothing drawn yet, such as a new design's first, which the studio doesn't list until it's sketched. */
export const isBlank = (part: CadPart) => !part.drawnOn && part.sketch.entities.every(entity => entity.type === 'point' && entity.fixed);
export const hasOutline = (document: CadDocument, partId: string) =>
  !!evaluateCadPart(document.parts.find(part => part.id === partId)!).part;
export function replacePart(document: CadDocument, partId: string, change: (part: CadPart) => CadPart): CadDocument {
  return { ...document, parts: document.parts.map(p => (p.id === partId ? change(p) : p)) };
}
export function chainGeometry(sketch: CadSketch, chain: ChainAnchor | null) {
  if (!chain) return null;
  const points = pointsOf(sketch);
  const point = points.get(chain.pointId);
  const curve = sketch.entities.find(e => e.id === chain.curveId);
  if (!point || !curve) return null;
  if (curve.type === 'line') {
    const other = points.get(curve.startId === point.id ? curve.endId : curve.startId);
    if (other) return { point, tangent: { x: point.x - other.x, y: point.y - other.y }, curve };
  }
  if (curve.type === 'arc') {
    const center = points.get(curve.centerId);
    if (center) {
      const direction = curve.endId === point.id ? 1 : -1;
      return { point, tangent: { x: -(point.y - center.y) * direction, y: (point.x - center.x) * direction }, curve };
    }
  }
  return null;
}
