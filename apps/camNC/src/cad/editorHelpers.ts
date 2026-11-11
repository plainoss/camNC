import type { CadSnapResult } from '@wbcnc/cad-editor/picking';
import {
  CAD_CHORD_TOLERANCE,
  entityPointIds as curvePointIds,
  evaluateCadPart,
  isCadPart,
  pointInPolygon,
  regionInteriorPoint,
  sketchRegions,
  type CadDocument,
  type CadEntity,
  type CadPart,
} from '@wbcnc/cad';
import { extrudeMergeTarget } from './extrudeMergeTarget';

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

/**
 * A sketch made a part by Extrude. A single line drawn on a plane or face is a thin board standing on it. A sketch on a
 * part's face adds to that part by default, with it in the merge scope. Picked from its row in the feature list
 * (`pickAll`), a sketch of several regions, such as overlapping shapes or outlines apart, starts with all of them; just
 * finished, with none, for them to be picked in the view.
 */
export function extrudedSketch(document: CadDocument, sketch: CadPart, pickAll: boolean): CadPart {
  const made = { ...sketch };
  delete made.extrude;
  if (made.drawnOn && !made.thin && isSingleLine(made)) return { ...made, thin: { depth: 100, midPlane: true } };
  const on = made.drawnOn?.on;
  const face = on && 'partId' in on ? on.partId : null;
  const onto = face && document.parts.find(candidate => candidate.id === face);
  if (onto && isCadPart(onto) && !(on && 'partId' in on && on.copyId)) made.addTo = extrudeMergeTarget(document, made, onto.id);
  if (pickAll && !made.regions && evaluateCadPart(made).diagnostics.some(d => d.severity === 'error')) {
    const solid = solidRegionIds(made);
    if (solid.length > 1) made.regions = solid;
  }
  return made;
}

/** A sketch on a part's face made a Hole step: round holes at its points, 5 mm across, through the part. */
export function asHole(part: CadPart): CadPart {
  const made: CadPart = { ...part, remove: part.remove ?? { depth: 'through' }, hole: part.hole ?? { diameter: 5 } };
  delete made.extrude;
  return made;
}

/**
 * An extrude of all of its sketch, as a first extrude is: as one outline, or, when the sketch isn't one, such as closed
 * shapes apart, each of its solid regions, each group apart becoming a part of its own on OK. A region inside a hole
 * of another, such as a circle in a rectangle, stays a hole; one inside that again is solid. A Remove cuts the whole
 * sketch, and Add and Thin keep it whole too: neither makes parts of shapes apart.
 */
export function wholeSketch(extrude: CadPart): CadPart {
  const whole = { ...extrude };
  delete whole.regions;
  if (whole.remove || whole.addTo || whole.thin || evaluateCadPart(whole).part) return whole;
  const solid = solidRegionIds(whole);
  return solid.length ? { ...whole, regions: solid } : whole;
}

/** A sketch's regions that are solid: not inside a hole of another, or inside one again, as an island in it. */
function solidRegionIds(part: CadPart): string[] {
  const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
  return regions
    .filter(region => {
      const inside = regionInteriorPoint(region.points);
      const depth = inside ? regions.filter(other => other !== region && pointInPolygon(inside, other.points)).length : 0;
      return depth % 2 === 0;
    })
    .map(region => region.id);
}
