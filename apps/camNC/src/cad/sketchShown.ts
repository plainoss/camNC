import type { CadDocument, CadPart } from '@wbcnc/cad';

/**
 * Whether a part's sketch shows before its eye is toggled: only while no Extrude uses it. Extrude hides the sketch it
 * builds from, whether it makes a new part, adds to one or removes from others; rolled back past the extrude, or with
 * the extrude suppressed, the sketch shows again.
 */
export const sketchShownByDefault = (part: CadPart): boolean => part.extrude === false || !!part.suppressed;

/** The same for a feature list row: a sketch row (`<part>:sketch`) follows its part, and the other rows show. */
export function featureShownByDefault(document: CadDocument, featureId: string): boolean {
  if (!featureId.endsWith(':sketch')) return true;
  const part = document.parts.find(candidate => `${candidate.id}:sketch` === featureId);
  return !part || sketchShownByDefault(part);
}
