import { newCadId } from './document';
import { cadSketchRegions, setCutDepth, withFeatureVersion } from './features';
import { polygonArea } from './geometry';
import type { CadCutDepth, CadDocument, CadEntity } from './types';

/**
 * Extrude → Remove, as the reference does it: a new part's sketch, drawn on a board's top or underside, is cut into that
 * board instead of becoming a part of its own. The sketch becomes one of the board's face sketches, and each region it
 * closes off is cut `depth` deep, or all the way through. The face's edges stay in the sketch as fixed construction, so
 * what was tied to them keeps its place.
 *
 * Every closed region is cut, except what's left of the face: of the regions bounded partly by the board's own outline,
 * the largest is the board, not a notch.
 */
export function extrudeRemove(
  document: CadDocument,
  partId: string,
  depth: CadCutDepth,
  depthExpression?: string
): { document: CadDocument } | { error: string } {
  const part = document.parts.find(candidate => candidate.id === partId);
  const on = part?.drawnOn?.on;
  if (!part || !on || 'plane' in on || (on.face !== 'top' && on.face !== 'underside'))
    return { error: 'Remove cuts into the top or underside of a board: sketch on one of those faces.' };
  const support = document.parts.find(candidate => candidate.id === on.partId);
  if (!support) return { error: 'The board it was drawn on is gone.' };
  if (support.thin) return { error: 'Cutting into a thin board isn’t supported yet.' };
  if (depth !== 'through' && !(depth > 0)) return { error: 'A cut needs some depth.' };
  // A part other steps build on stays a part.
  if (
    part.copies?.length ||
    part.pattern ||
    document.partCuts?.some(step => [...step.tools, ...step.targets].some(id => id.split(':')[0] === part.id))
  )
    return { error: `${part.name} is copied or cut by other steps, so it stays a part.` };
  if (document.parts.some(candidate => candidate.drawnOn && !('plane' in candidate.drawnOn.on) && candidate.drawnOn.on.partId === part.id))
    return { error: `Other parts are drawn on ${part.name}, so it stays a part.` };
  const entities = part.sketch.entities.map((entity): CadEntity => {
    if (!entity.faceEdge) return entity;
    const { faceEdge: _faceEdge, ...kept } = entity;
    return kept as CadEntity;
  });
  const sketch = { ...part.sketch, entities };
  const board = { ...support, features: [...(support.features ?? []), { type: 'sketch' as const, id: newCadId(), on: on.face, sketch }] };
  const regions = cadSketchRegions(board, sketch.id);
  const outlineId = `${support.id}:outline`;
  const touching = regions.filter(region => region.curveIds.includes(outlineId));
  const rest = touching.reduce<(typeof regions)[number] | null>(
    (largest, region) => (!largest || Math.abs(polygonArea(region.points)) > Math.abs(polygonArea(largest.points)) ? region : largest),
    null
  );
  const cut = regions.filter(region => region !== rest && region.curveIds.some(id => id !== outlineId));
  if (!cut.length) return { error: 'Draw a closed shape on the face to cut it out.' };
  let next = withFeatureVersion({
    ...document,
    revision: document.revision + 1,
    parts: document.parts.flatMap(candidate => (candidate.id === part.id ? [] : candidate.id === support.id ? [board] : [candidate])),
  });
  for (const region of cut) next = setCutDepth(next, support.id, sketch.id, region.id, depth, depthExpression);
  return { document: next };
}
