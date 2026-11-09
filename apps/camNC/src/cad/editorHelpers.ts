import type { CadSnapResult } from './picking';
import { entityPointIds as curvePointIds, evaluateCadPart, type CadDocument, type CadEntity, type CadPart } from '@wbcnc/cad';

// Small helpers of the sketch editor, kept apart so the editor itself stays readable.

export const snapLabels: Record<CadSnapResult['kind'], string> = {
  endpoint: 'Endpoint',
  center: 'Center',
  point: 'Point',
  midpoint: 'Midpoint',
  pointOnCurve: 'On curve',
};

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

/**
 * A part's sketch left on its own once its Extrude is deleted: what the extrude added to, removed from or went up to
 * goes with it. A part extruding another's sketch has no sketch of its own, so it's deleted rather than left.
 */
export function withoutExtrude(part: CadPart): CadPart {
  const next: CadPart = { ...part, extrude: false };
  for (const key of ['extrudeName', 'remove', 'addTo', 'addedRegions', 'upTo', 'upToDatum', 'symmetric', 'suppressed'] as const)
    delete next[key];
  return next;
}
