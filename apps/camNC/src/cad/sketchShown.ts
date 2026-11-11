import { activeDesign, type CadDocument } from '@wbcnc/cad';

const cache = new WeakMap<CadDocument, ReadonlySet<string>>();

/**
 * The parts whose sketch shows before its eye is toggled: those no built Extrude uses. Extrude hides the sketch it builds
 * from, whether it makes a new part, adds to one, removes from others or drills holes, and whether it's the sketch's own
 * part or another extruding it through `sketchOf`. Rolled back past the extrude, or with the extrude suppressed (also
 * through its folder), the sketch shows again.
 */
export function sketchesShownByDefault(document: CadDocument): ReadonlySet<string> {
  let shown = cache.get(document);
  if (!shown) {
    // The active design marks every suppressed extrude as not extruded, however it's suppressed.
    const active = activeDesign(document).parts;
    const extrudedElsewhere = new Set(active.flatMap(part => (part.sketchOf && part.extrude !== false ? [part.sketchOf] : [])));
    shown = new Set(active.filter(part => part.extrude === false && !extrudedElsewhere.has(part.id)).map(part => part.id));
    cache.set(document, shown);
  }
  return shown;
}

/** The same for a feature list row: a sketch row (`<part>:sketch`) follows its part, and the other rows show. */
export function featureShownByDefault(document: CadDocument, featureId: string): boolean {
  if (!featureId.endsWith(':sketch')) return true;
  const partId = featureId.slice(0, -':sketch'.length);
  return !document.parts.some(part => part.id === partId) || sketchesShownByDefault(document).has(partId);
}
