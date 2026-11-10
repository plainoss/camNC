import { cadPartReferenceName, type CadDocument, type CadDrawnOn } from '@wbcnc/cad';

const kPlaneNames = { top: 'the top plane', front: 'the front plane', right: 'the right plane' } as const;

/** What a part is drawn on, said the way a person would. */
export function drawnOnName(document: CadDocument, on: CadDrawnOn['on']): string {
  if ('plane' in on) return kPlaneNames[on.plane];
  const support = cadPartReferenceName(document, on.partId) ?? 'a removed part';
  return on.face === 'top' ? `the top of ${support}` : on.face === 'underside' ? `the underside of ${support}` : `an edge of ${support}`;
}
