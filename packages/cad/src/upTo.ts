import { removalInward } from './extrudeRemoval';
import { cadDatumFrame } from './datumPlanes';
import { cadFaceFrame, resolveDrawnPlacements } from './drawnOn';
import { cadSketchFrame } from './usedEdges';
import type { CadDocument } from './types';

/** How thin an extrude up to a face can be before it's taken to be wrong, in mm. */
const kThinnest = 0.1;

/**
 * Each part extruded up to a plane or face made as thick as the distance from its sketch's plane to it, so it reaches
 * that face wherever it is. One that would be no thicker than nothing keeps its last thickness.
 */
export function resolveUpTo(document: CadDocument): CadDocument {
  if (!document.parts.some(part => part.upTo)) return document;
  let changed = false;
  // Faces are where their parts now are, as when one was moved by changing what it's drawn on.
  const placed = resolveDrawnPlacements(document).document;
  const parts = document.parts.map(part => {
    if (!part.upTo || part.thin || !part.drawnOn) return part;
    const from = cadSketchFrame(placed, placed.parts.find(candidate => candidate.id === part.id)!);
    const to = (part.upToDatum && cadDatumFrame(placed, part.upToDatum)) || cadFaceFrame(placed, part.upTo);
    if (!from || 'error' in to) return part;
    const reach = [0, 1, 2].reduce((sum, axis) => sum + (to.origin[axis]! - from.origin[axis]!) * from.normal[axis]!, 0);
    const thickness = Math.round(((part.remove ? removalInward(part) : part.drawnOn.inward) ? -reach : reach) * 1e6) / 1e6;
    if (!(thickness > kThinnest) || Math.abs(thickness - part.thickness) < 1e-9) return part;
    changed = true;
    const next = { ...part, thickness };
    delete next.thicknessExpression;
    return next;
  });
  return changed ? { ...document, parts } : document;
}
