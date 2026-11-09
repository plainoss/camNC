import { cadSketchRegions, evaluateCadFeatures } from './features';
import { evaluateCadPart, polygonArea } from './geometry';
import type { CadSketchRegion } from './sketchRegions';
import type { CadCut, CadDocument, CadEntity, CadFaceSketch, CadFeature, CadPart } from './types';

/** The part or sketch feature whose sketch a part extrudes: its own, or the one it shares. */
export const sketchOwnerId = (part: CadPart): string => part.sketchOf ?? part.id;

/** Whether two parts extrude the same sketch. */
export const sharesSketch = (a: CadPart, b: CadPart): boolean => sketchOwnerId(a) === sketchOwnerId(b);

/** The parts and sketch features that extrude a part's sketch, the part itself among them. */
export const sketchUsers = (document: CadDocument, part: CadPart): CadPart[] =>
  document.parts.filter(candidate => sharesSketch(candidate, part));

/** The board an Extrude → Remove cuts into: the one its sketch is drawn on, by the top or the underside. */
export function removeSupport(document: CadDocument, part: CadPart): { board: CadPart; face: 'top' | 'underside' } | { error: string } {
  const on = part.drawnOn?.on;
  if (!on || 'plane' in on || (on.face !== 'top' && on.face !== 'underside'))
    return { error: 'Remove cuts into the top or underside of a board: sketch on one of those faces.' };
  const board = document.parts.find(candidate => candidate.id === on.partId);
  if (!board) return { error: 'The board it was drawn on is gone.' };
  if (board.thin) return { error: 'Cutting into a thin board isn’t supported yet.' };
  return { board, face: on.face };
}

const removedSketchId = (part: CadPart) => `${part.id}:removed`;

/** A Remove step's sketch as the board it cuts sees it: on its face, with the face's edges as plain construction. */
function removedSketch(part: CadPart, face: 'top' | 'underside'): CadFaceSketch {
  const entities = part.sketch.entities.map((entity): CadEntity => {
    if (!entity.faceEdge) return entity;
    const { faceEdge: _faceEdge, ...kept } = entity;
    return kept as CadEntity;
  });
  return { type: 'sketch', id: removedSketchId(part), on: face, sketch: { ...part.sketch, entities }, removedBy: part.id };
}

/**
 * The regions an Extrude → Remove can cut, with the board's outline closing them off as a face sketch's are, and the
 * ones it cuts when none are picked: every closed region but what's left of the face. Of the regions bounded partly by
 * the board's outline, the largest is the board, not a notch.
 */
export function removalRegions(document: CadDocument, part: CadPart): { regions: CadSketchRegion[]; cut: string[] } | { error: string } {
  const support = removeSupport(document, part);
  if ('error' in support) return support;
  const board = {
    ...support.board,
    features: [...(support.board.features ?? []).filter(feature => feature.removedBy !== part.id), removedSketch(part, support.face)],
  };
  const regions = cadSketchRegions(board, part.sketch.id);
  const outlineId = `${board.id}:outline`;
  const rest = regions
    .filter(region => region.curveIds.includes(outlineId))
    .reduce<CadSketchRegion | null>(
      (largest, region) => (!largest || Math.abs(polygonArea(region.points)) > Math.abs(polygonArea(largest.points)) ? region : largest),
      null
    );
  const cut = regions.filter(region => region !== rest && region.curveIds.some(id => id !== outlineId)).map(region => region.id);
  return { regions, cut };
}

/** The regions a Remove step cuts: those picked that are there, or by default all of them but what's left of the face. */
function removedRegionIds(document: CadDocument, part: CadPart): string[] {
  const found = removalRegions(document, part);
  if ('error' in found) return [];
  return part.regions ? part.regions.filter(id => found.regions.some(region => region.id === id)) : found.cut;
}

/**
 * Keeps what the design's extrude steps make of each other in step, as the reference regenerates its feature list:
 *
 * - A part extruding another's sketch gets a copy of it, on the same plane or face. When the sketch's owner is gone,
 *   the first part still using it owns it.
 * - A part takes the regions Extrude → Add steps join to it.
 * - A board takes the face sketches and cuts of the Extrude → Remove steps drawn on it.
 *
 * The design comes back unchanged when there's nothing to do.
 */
export function resolveExtrudeSteps(document: CadDocument): CadDocument {
  const byId = new Map(document.parts.map(part => [part.id, part]));
  // A shared sketch's owner, following a chain left by an owner deleted in between.
  const owners = new Map<string, string>();
  const ownerOf = (part: CadPart): string => {
    const seen = new Set<string>();
    let at: CadPart = part;
    while (at.sketchOf && !seen.has(at.id)) {
      seen.add(at.id);
      const next = byId.get(at.sketchOf);
      if (!next) {
        // The first part left using it takes it over.
        const heir = owners.get(at.sketchOf) ?? part.id;
        owners.set(at.sketchOf, heir);
        return heir;
      }
      at = next;
    }
    return at.id;
  };
  let parts = document.parts.map(part => {
    if (!part.sketchOf) return part;
    const ownerId = ownerOf(part);
    if (ownerId === part.id) {
      const owned = { ...part };
      delete owned.sketchOf;
      return owned;
    }
    const owner = byId.get(ownerId)!;
    const next: CadPart = { ...part, sketchOf: ownerId, sketch: owner.sketch };
    if (owner.drawnOn) next.drawnOn = { ...(part.drawnOn ?? { offset: 0 }), on: owner.drawnOn.on };
    else {
      delete next.drawnOn;
      if (owner.placement) next.placement = owner.placement;
    }
    return next;
  });
  // Parts whose owner was taken over by its first user: the others use that one's sketch.
  const heirs = new Map(parts.map(part => [part.id, part]));
  parts = parts.map(part => {
    const owner = part.sketchOf && heirs.get(part.sketchOf);
    return owner && !owner.sketchOf && owner.sketch !== part.sketch ? { ...part, sketch: owner.sketch } : part;
  });

  const added = new Map<string, string[]>();
  for (const step of parts) {
    const target = step.addTo && parts.find(part => part.id === step.addTo);
    if (!target || !target.regions || !sharesSketch(target, step) || step.addTo === step.id) continue;
    added.set(target.id, [...(added.get(target.id) ?? []), ...(step.regions ?? [])]);
  }
  parts = parts.map(part => {
    const regions = added.get(part.id);
    if (!regions && !part.addedRegions) return part;
    const next = { ...part };
    if (regions?.length) next.addedRegions = [...new Set(regions)];
    else delete next.addedRegions;
    return next;
  });

  const removed = new Map<string, CadFeature[]>();
  const resolved = { ...document, parts };
  for (const step of parts) {
    if (!step.remove) continue;
    const support = removeSupport(resolved, step);
    if ('error' in support) continue;
    const face = removedSketch(step, support.face);
    const typed = step.remove.depth !== 'through' && step.remove.depthExpression ? { depthExpression: step.remove.depthExpression } : {};
    const cuts = removedRegionIds(resolved, step).map(
      (regionId): CadCut => ({
        type: 'cut',
        id: `${step.id}:cut:${regionId}`,
        sketchId: step.sketch.id,
        regionId,
        depth: step.remove!.depth,
        ...typed,
        removedBy: step.id,
      })
    );
    removed.set(support.board.id, [...(removed.get(support.board.id) ?? []), face, ...cuts]);
  }
  parts = parts.map(part => {
    const wanted = removed.get(part.id) ?? [];
    if (!wanted.length && !part.features?.some(feature => feature.removedBy)) return part;
    // A step's features stay where they were among the board's own, since later sketches can sit on their floors.
    const remaining = new Map(wanted.map(feature => [feature.id, feature]));
    const features = (part.features ?? []).flatMap(feature => {
      if (!feature.removedBy) return [feature];
      const replacement = remaining.get(feature.id);
      remaining.delete(feature.id);
      return replacement ? [replacement] : [];
    });
    features.push(...remaining.values());
    const next = { ...part, features };
    if (!features.length) delete (next as Partial<CadPart>).features;
    return next;
  });

  const changed = parts.some((part, index) => JSON.stringify(part) !== JSON.stringify(document.parts[index]));
  if (!changed) return document;
  return { ...document, parts, version: parts.some(part => part.features?.length) ? 2 : 1 };
}

/** Why an Extrude → Add or Remove step can't do what it says, or null when it can. */
export function extrudeStepProblem(document: CadDocument, part: CadPart): string | null {
  if (part.addTo) {
    const target = document.parts.find(candidate => candidate.id === part.addTo);
    if (!target) return 'The part it adds to is gone. Pick another, or make a new part.';
    if (!sharesSketch(target, part)) return `Add joins regions of the sketch ${target.name} is made from.`;
    if (!target.regions) return `${target.name} is its whole sketch already.`;
    if (!part.regions?.length) return 'Pick the regions to add in the view.';
    const problem = evaluateCadPart({ ...target, addedRegions: [...(target.addedRegions ?? []), ...part.regions] }).diagnostics.find(
      diagnostic => diagnostic.severity === 'error'
    );
    return problem ? (problem.code === 'region-count' ? `The regions don’t touch ${target.name}.` : problem.message) : null;
  }
  if (part.remove) {
    const support = removeSupport(document, part);
    if ('error' in support) return support.error;
    if (part.remove.depth !== 'through' && !(part.remove.depth > 0)) return 'A cut needs some depth.';
    if (!removedRegionIds(document, part).length) return 'Draw a closed shape on the face to cut it out.';
    // The board has to take the cuts, as CAM machines it: a through cut can't reach its edge, nor a pocket go through.
    const errors = (board: CadPart) => {
      const profile = evaluateCadPart(board).part;
      return profile ? evaluateCadFeatures(board, profile).diagnostics.filter(diagnostic => diagnostic.severity === 'error') : [];
    };
    const board = resolveExtrudeSteps(document).parts.find(candidate => candidate.id === support.board.id)!;
    const without = new Set(
      errors({ ...board, features: board.features?.filter(feature => feature.removedBy !== part.id) }).map(diagnostic => diagnostic.message)
    );
    const refused = errors(board).find(diagnostic => !without.has(diagnostic.message));
    return refused ? refused.message : null;
  }
  return null;
}

/** Whether other steps build on a part, so it has to stay one rather than become an Add or Remove step. */
export function partIsBuiltOn(document: CadDocument, part: CadPart): string | null {
  if (
    part.copies?.length ||
    part.pattern ||
    document.partCuts?.some(step => [...step.tools, ...step.targets].some(id => id.split(':')[0] === part.id))
  )
    return `${part.name} is copied or cut by other steps, so it stays a part.`;
  if (document.parts.some(candidate => candidate.drawnOn && !('plane' in candidate.drawnOn.on) && candidate.drawnOn.on.partId === part.id))
    return `Other parts are drawn on ${part.name}, so it stays a part.`;
  if (document.parts.some(candidate => candidate.addTo === part.id)) return `Other steps add to ${part.name}, so it stays a part.`;
  return null;
}
