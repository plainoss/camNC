import { cadFaceFrame } from './drawnOn';
import type { CadDirection, CadDocument } from './types';

/** A picked direction in the studio's space, a unit vector, or null when what it was picked from is gone. */
export function cadDirectionVector(document: CadDocument, direction: CadDirection): [number, number, number] | null {
  const frame = cadFaceFrame(document, direction.along);
  if ('error' in frame) return null;
  const sign = direction.flip ? -1 : 1;
  return frame.normal.map(value => value * sign || 0) as [number, number, number];
}
