import { faceRemovalDepth } from './faceRemovalDepth';
import { cadDocumentVersion } from './documentVersion';
import { applyExtrudeRemovals, isSpatialRemoval } from './extrudeRemoval';
import { entityPointIds, newCadId } from './document';
import { faceExtrudeProblem, resolveFaceProfiles } from './faceExtrude';
import { cadSketchRegions, evaluateCadFeatures, isCadPart } from './features';
import { CAD_CHORD_TOLERANCE, evaluateCadPart, polygonArea } from './geometry';
import { regionGroups } from './regionProfile';
import { sketchRegions, type CadSketchRegion } from './sketchRegions';
import type { CadCut, CadDocument, CadEntity, CadFaceSketch, CadFeature, CadPart, CadSketch } from './types';

/** The part or sketch feature whose sketch a part extrudes: its own, or the one it shares. */
export const sketchOwnerId = (part: CadPart): string => part.sketchOf ?? part.id;

/** Whether two parts extrude the same sketch. */
export const sharesSketch = (a: CadPart, b: CadPart): boolean => sketchOwnerId(a) === sketchOwnerId(b);

/** What sets how far and which way a part is extruded from its sketch. */
const depthKeys = ['thickness', 'thicknessExpression', 'upTo', 'upToDatum', 'symmetric', 'thin'] as const;

/**
 * How far below a part's top an Extrude → Add of the part's own sketch ends: 0 when it extrudes its regions just as far
 * and the same way, the step down when it is a plain extrude that ends lower, or null when it's neither.
 */
export function addedRegionStep(target: CadPart, step: CadPart): number | null {
  if (!sharesSketch(target, step) || !target.drawnOn?.inward !== !step.drawnOn?.inward) return null;
  if (depthKeys.every(key => JSON.stringify(target[key]) === JSON.stringify(step[key]))) return 0;
  const plain = (part: CadPart) => !part.upTo && !part.upToDatum && !part.symmetric && !part.thin;
  const below = target.thickness - step.thickness;
  return plain(target) && plain(step) && below >= MIN_ADDED_STEP ? below : null;
}

/** The smallest step down an Add's regions can end at, as the shallowest cut. */
const MIN_ADDED_STEP = 0.1;

/**
 * Whether an Extrude → Add of a part's own sketch makes its regions part of that part's profile: it extrudes them as far,
 * or less far, the same way; less far, the part is stepped down over them. Otherwise, as when it ends beyond the part's
 * top, it is a body joined to the part, as another sketch's Add is.
 */
export const addsRegionsTo = (target: CadPart, step: CadPart): boolean => addedRegionStep(target, step) !== null;

/**
 * Whether a part is an Extrude → Add of another sketch, or of the same one with a depth of its own: a body of its own,
 * joined to the part it adds to. It's built and
 * made like a part, but listed as part of that one. How it's machined, as one piece or several, is decided later.
 */
export function isJoinedBody(document: Pick<CadDocument, 'parts'>, part: CadPart): boolean {
  if (!part.addTo || part.extrude === false || part.suppressed || part.remove || copyFaceOperationProblem(part)) return false;
  const target = document.parts.find(candidate => candidate.id === part.addTo);
  return !!target && isCadPart(target) && !addsRegionsTo(target, part);
}

/** The parts and the bodies joined to them: everything built as a solid. */
export const isCadBody = (document: CadDocument, part: CadPart): boolean => isCadPart(part) || isJoinedBody(document, part);

/** The parts and sketch features that extrude a part's sketch, the part itself among them. */
export const sketchUsers = (document: CadDocument, part: CadPart): CadPart[] =>
  document.parts.filter(candidate => sharesSketch(candidate, part));

/** Instance-specific Add/Remove is not represented yet; never redirect a copy-face edit to its source family. */
export function copyFaceOperationProblem(part: CadPart): string | null {
  const on = part.drawnOn?.on;
  return on && 'partId' in on && on.copyId
    ? 'A sketch on a copy can make a new part. Add, Remove and Hole on a copy are not supported yet.'
    : null;
}

/** The board an Extrude → Remove cuts into: the one its sketch is drawn on, by the top or the underside. */
export function removeSupport(document: CadDocument, part: CadPart): { board: CadPart; face: 'top' | 'underside' } | { error: string } {
  const on = part.drawnOn?.on;
  const copyProblem = copyFaceOperationProblem(part);
  if (copyProblem) return { error: copyProblem };
  if (!on || 'plane' in on || (on.face !== 'top' && on.face !== 'underside'))
    return { error: 'Remove cuts into the top or underside of a board: sketch on one of those faces.' };
  const board = document.parts.find(candidate => candidate.id === on.partId);
  if (!board) return { error: 'The board it was drawn on is gone.' };
  if (board.thin) return { error: 'Cutting into a thin board isn’t supported yet.' };
  return { board, face: on.face };
}

const removedSketchId = (part: CadPart) => `${part.id}:removed`;

/** A sketch's points drawn on their own: not construction, not a used edge's, not the end or centre of a line or curve. */
export function standaloneSketchPoints(sketch: CadSketch): Extract<CadEntity, { type: 'point' }>[] {
  const used = new Set(
    sketch.entities.flatMap(entity => (entity.type === 'point' ? [] : entityPointIds(entity).filter(id => id !== entity.id)))
  );
  return sketch.entities.filter(
    (entity): entity is Extract<CadEntity, { type: 'point' }> =>
      entity.type === 'point' && !entity.construction && !entity.faceEdge && !used.has(entity.id)
  );
}

/**
 * A Hole step's sketch as the board sees it: a circle round each of its standalone points, as wide as the hole. The
 * circles take their IDs from their points, so the holes keep theirs as the design changes.
 */
export function holeSketch(part: CadPart): CadSketch {
  const centres = standaloneSketchPoints(part.sketch);
  const radius = part.hole!.diameter / 2;
  return {
    ...part.sketch,
    entities: centres.flatMap(point => [
      { ...point, construction: true },
      { id: `${point.id}:hole`, type: 'circle' as const, centerId: point.id, radius },
    ]),
    constraints: [],
  };
}

/** A Remove step's sketch as the board it cuts sees it: on its face, with the face's edges as plain construction. */
function removedSketch(part: CadPart, face: 'top' | 'underside'): CadFaceSketch {
  if (part.hole) return { type: 'sketch', id: removedSketchId(part), on: face, sketch: holeSketch(part), removedBy: part.id };
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
  if (part.drawnOn && ('plane' in part.drawnOn.on || typeof part.drawnOn.on.face === 'object')) {
    const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
    return { regions, cut: regions.map(region => region.id) };
  }
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
  document = resolveFaceProfiles(document);
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
    // Extrudes of a shared sketch start on its plane, wherever that is.
    if (owner.drawnOn) {
      next.drawnOn = { ...(part.drawnOn ?? {}), on: owner.drawnOn.on, offset: owner.drawnOn.offset };
      if (owner.drawnOn.datum) next.drawnOn.datum = owner.drawnOn.datum;
      else delete next.drawnOn.datum;
    } else {
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

  // A part another New extrude made too follows that extrude's settings; once that extrude is gone, or no longer of the
  // same sketch, the part is an extrude of its own. Made an Add or a Remove, the extrude takes the parts' regions back:
  // it's one feature, adding or cutting them all, and made New again it makes a part of each again.
  let leads = new Map(parts.map(part => [part.id, part]));
  const folds = (part: CadPart, lead = leads.get(part.extrudedWith ?? '')) =>
    !!lead && !lead.extrudedWith && !lead.hole && (lead.addTo !== undefined || !!lead.remove) && sharesSketch(lead, part);
  const folded = new Map<string, string[]>();
  for (const part of parts)
    if (folds(part)) folded.set(part.extrudedWith!, [...(folded.get(part.extrudedWith!) ?? []), ...(part.regions ?? [])]);
  if (folded.size) {
    parts = parts.flatMap(part => {
      if (folds(part)) return [];
      const regions = folded.get(part.id);
      return regions ? [{ ...part, regions: [...new Set([...(part.regions ?? []), ...regions])] }] : [part];
    });
    leads = new Map(parts.map(part => [part.id, part]));
    const kept = new Set(parts.map(part => part.id));
    if (document.folders)
      document = {
        ...document,
        folders: document.folders.map(folder => ({ ...folder, partIds: folder.partIds.filter(id => kept.has(id)) })),
      };
  }
  parts = parts.map(part => {
    if (!part.extrudedWith) return part;
    const lead = leads.get(part.extrudedWith);
    if (!lead || lead.extrudedWith || lead.hole || !sharesSketch(lead, part)) {
      const own = { ...part };
      delete own.extrudedWith;
      return own;
    }
    return withExtrudeSettingsOf(part, lead);
  });

  const added = new Map<string, string[]>();
  // An Add that ends lower than its part steps the part down over its regions, as a cut from the top kept with the Add.
  const removed = new Map<string, CadFeature[]>();
  for (const step of parts) {
    const target = step.addTo && parts.find(part => part.id === step.addTo);
    // A suppressed Add adds nothing, as in the reference.
    // Nor does one not extruded, such as a sketch whose extrude was deleted.
    const below = target && addedRegionStep(target, step);
    if (step.suppressed || step.extrude === false || !target || !target.regions || below === null || step.addTo === step.id) continue;
    added.set(target.id, [...(added.get(target.id) ?? []), ...(step.regions ?? [])]);
    if (!below) continue;
    const steps = (step.regions ?? []).map(
      (regionId): CadCut => ({
        type: 'cut',
        id: `${step.id}:cut:${regionId}`,
        sketchId: target.sketch.id,
        regionId,
        depth: below,
        removedBy: step.id,
      })
    );
    removed.set(target.id, [...(removed.get(target.id) ?? []), ...steps]);
  }
  parts = parts.map(part => {
    const regions = added.get(part.id);
    if (!regions && !part.addedRegions) return part;
    const next = { ...part };
    if (regions?.length) next.addedRegions = [...new Set(regions)];
    else delete next.addedRegions;
    return next;
  });

  const resolved = { ...document, parts };
  for (const step of parts) {
    // A suppressed Remove cuts nothing, and nor does a sketch not extruded.
    if (!step.remove || step.suppressed || step.extrude === false || isSpatialRemoval(step)) continue;
    const support = removeSupport(resolved, step);
    if ('error' in support) continue;
    const extent = faceRemovalDepth(step, support.board.thickness);
    if ('error' in extent) continue;
    const face = removedSketch(step, support.face);
    const typed =
      !extent.derived && step.remove.depth !== 'through' && step.remove.depthExpression
        ? { depthExpression: step.remove.depthExpression }
        : {};
    const cuts = removedRegionIds(resolved, step).map(
      (regionId): CadCut => ({
        type: 'cut',
        id: `${step.id}:cut:${regionId}`,
        sketchId: step.sketch.id,
        regionId,
        depth: extent.depth,
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

  const changed =
    parts.length !== document.parts.length || parts.some((part, index) => JSON.stringify(part) !== JSON.stringify(document.parts[index]));
  if (!changed) return document;
  return { ...document, parts, version: cadDocumentVersion({ ...document, parts }) };
}

/** Why an Extrude → Add or Remove step can't do what it says, or null when it can. */
export function extrudeStepProblem(document: CadDocument, part: CadPart): string | null {
  if (part.addTo !== undefined || part.remove || part.hole) {
    const problem = copyFaceOperationProblem(part);
    if (problem) return problem;
  }
  if (part.faceProfile && part.drawnOn && 'partId' in part.drawnOn.on) {
    const problem = faceExtrudeProblem(document, part.drawnOn.on, part.id);
    if (problem) return problem;
  }
  if (part.addTo === '') return 'Pick a part for the merge scope.';
  if (part.addTo) {
    const target = document.parts.find(candidate => candidate.id === part.addTo);
    if (!target) return 'The part it adds to is gone. Pick another, or make a new part.';
    // Another sketch's extrude, or one with a depth of its own, is joined as a body of its own: it only needs a profile.
    if (!addsRegionsTo(target, part)) {
      const problem = evaluateCadPart(part).diagnostics.find(diagnostic => diagnostic.severity === 'error');
      return problem ? (part.regions ? problem.message : 'Pick a region of the sketch in the view.') : null;
    }
    if (!target.regions) return `${target.name} is its whole sketch already.`;
    if (!part.regions?.length) return 'Pick the regions to add in the view.';
    const problem = evaluateCadPart({ ...target, addedRegions: [...(target.addedRegions ?? []), ...part.regions] }).diagnostics.find(
      diagnostic => diagnostic.severity === 'error'
    );
    return problem ? (problem.code === 'region-count' ? `The regions don’t touch ${target.name}.` : problem.message) : null;
  }
  if (part.remove) {
    if (isSpatialRemoval(part)) {
      const shapes = document.parts.flatMap(candidate => {
        const profile = evaluateCadPart(candidate).part;
        return profile ? [evaluateCadFeatures(candidate, profile).part] : [];
      });
      return (
        applyExtrudeRemovals(document, shapes).diagnostics.find(problem => problem.partId === part.id && problem.severity === 'error')
          ?.message ?? null
      );
    }
    const support = removeSupport(document, part);
    if ('error' in support) return support.error;
    const extent = faceRemovalDepth(part, support.board.thickness);
    if ('error' in extent) return extent.error;
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

/**
 * Why converting an extrude would discard a body other steps need. Adding another sketch retains its body and IDs,
 * so copies, face sketches and later cuts still work. A same-sketch Add or Remove has no body of its own.
 */
export function partIsBuiltOn(document: CadDocument, part: CadPart, addTo?: CadPart): string | null {
  const keepsBody = !!addTo && !addsRegionsTo(addTo, part);
  if (
    !keepsBody &&
    (part.copies?.length ||
      part.pattern ||
      document.partCuts?.some(step => [...step.tools, ...step.targets].some(id => id.split(':')[0] === part.id)))
  )
    return `${part.name} is copied or cut by other steps, so it stays a part.`;
  if (
    !keepsBody &&
    document.parts.some(candidate => candidate.drawnOn && !('plane' in candidate.drawnOn.on) && candidate.drawnOn.on.partId === part.id)
  )
    return `Other parts are drawn on ${part.name}, so it stays a part.`;
  if (document.parts.some(candidate => candidate.addTo === part.id)) return `Other steps add to ${part.name}, so it stays a part.`;
  return null;
}

/**
 * The regions of a part's sketch that none of its extrudes use yet. A part that's its whole sketch uses all of them,
 * islands too, since those are its holes.
 */
export function unusedRegions(document: CadDocument, part: CadPart): string[] {
  const users = sketchUsers(document, part);
  if (users.some(user => !user.regions && !user.remove)) return [];
  const used = new Set(
    users.flatMap(user => {
      if (!user.remove) return [...(user.regions ?? []), ...(user.addedRegions ?? [])];
      const found = removalRegions(document, user);
      return 'error' in found ? [] : (user.regions ?? found.cut);
    })
  );
  return sketchRegions(part.sketch, CAD_CHORD_TOLERANCE)
    .map(region => region.id)
    .filter(id => !used.has(id));
}

/**
 * Another extrude of a part's sketch, as Extrude always starts one: a new part, of the same thickness, starting with the
 * regions its sketch's extrudes leave unused when they make one part, and with none picked otherwise.
 */
export function newExtrudeOf(document: CadDocument, part: CadPart, name: string): CadPart {
  const unused = unusedRegions(document, part);
  const owner = document.parts.find(candidate => candidate.id === sketchOwnerId(part)) ?? part;
  const made: CadPart = {
    id: newCadId(),
    name,
    thickness: part.thickness,
    ...(part.thicknessExpression && { thicknessExpression: part.thicknessExpression }),
    sketch: owner.sketch,
    sketchOf: owner.id,
    regions: unused,
    ...(owner.drawnOn && {
      drawnOn: { on: owner.drawnOn.on, offset: owner.drawnOn.offset, ...(owner.drawnOn.datum && { datum: owner.drawnOn.datum }) },
    }),
    ...(!owner.drawnOn && owner.placement && { placement: owner.placement }),
  };
  return unused.length && evaluateCadPart(made).part ? made : { ...made, regions: [] };
}

/** What a part made by another's extrude takes from it: how far, which way and whether it's extruded at all. */
const extrudeSettingKeys = [
  'thickness',
  'thicknessExpression',
  'extrude',
  'upTo',
  'upToDatum',
  'symmetric',
  'suppressed',
  'thin',
  'cornerRelief',
] as const;

function withExtrudeSettingsOf(part: CadPart, lead: CadPart): CadPart {
  const next: CadPart = { ...part };
  for (const key of extrudeSettingKeys) {
    if (lead[key] === undefined) delete next[key];
    else (next as unknown as Record<string, unknown>)[key] = lead[key];
  }
  if (next.drawnOn && lead.drawnOn) {
    next.drawnOn = { ...next.drawnOn };
    if (lead.drawnOn.inward === undefined) delete next.drawnOn.inward;
    else next.drawnOn.inward = lead.drawnOn.inward;
  }
  return JSON.stringify(next) === JSON.stringify(part) ? part : next;
}

/** The parts a part's extrude makes: itself, then those made with it, in the design's order. */
export function extrudeGroup(document: Pick<CadDocument, 'parts'>, partId: string): CadPart[] {
  return document.parts.filter(part => part.id === partId || part.extrudedWith === partId);
}

/** The part whose extrude made a part: the one it was made with, or itself. */
export function extrudeLeadId(document: Pick<CadDocument, 'parts'>, partId: string): string {
  const with_ = document.parts.find(part => part.id === partId)?.extrudedWith;
  return with_ && document.parts.some(part => part.id === with_) ? with_ : partId;
}

/**
 * A New extrude of regions that lie apart makes a part of each group of them that touch, as the first is: the first
 * group stays with the extrude, and each other is a part of its own of the same sketch, as thick, made with it: the
 * extrude stays one feature. `id` names the part
 * made of each group after the first, by its index, so a preview of the split and the split itself make the same parts.
 */
export function splitApartRegions(
  document: CadDocument,
  partId: string,
  id: (groupIndex: number) => string = () => newCadId()
): CadDocument {
  const part = document.parts.find(candidate => candidate.id === partId);
  if (!part?.regions || part.regions.length < 2 || part.addTo || part.remove) return document;
  const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE).filter(region => part.regions!.includes(region.id));
  const groups = regionGroups(regions);
  if (groups.length < 2) return document;
  const owner = sketchOwnerId(part);
  const made = groups.slice(1).map((group, index): CadPart => {
    const next: CadPart = {
      ...part,
      id: id(index + 1),
      name: `Part ${document.parts.length + index + 1}`,
      sketchOf: owner,
      extrudedWith: part.id,
      regions: group.regionIds,
    };
    delete next.extrudeName;
    // What was done to the extrude's own part afterwards isn't the new part's.
    for (const key of ['features', 'copies', 'pattern', 'addedRegions', 'moved'] as const) delete next[key];
    return next;
  });
  const parts = document.parts.flatMap(candidate =>
    candidate.id === partId ? [{ ...candidate, regions: groups[0]!.regionIds }, ...made] : [candidate]
  );
  // They're in the extrude's folder too, beside it.
  const madeIds = made.map(next => next.id);
  const folders = document.folders?.map(folder =>
    folder.partIds.includes(partId)
      ? { ...folder, partIds: folder.partIds.flatMap(id => (id === partId ? [id, ...madeIds] : [id])) }
      : folder
  );
  return { ...document, revision: document.revision + 1, parts, ...(folders && { folders }) };
}

/**
 * An extrude left with no regions of its own while it makes other parts hands the feature to the first of them, which
 * keeps all it has. The extrude's own part is no longer made: it's the sketch alone when the sketch is its own, and
 * gone when it extrudes another's.
 */
export function handOverEmptyExtrude(document: CadDocument, partId: string): CadDocument {
  const lead = document.parts.find(part => part.id === partId);
  const next = document.parts.find(part => part.extrudedWith === partId);
  if (!lead || !next || lead.regions?.length !== 0) return document;
  const parts = document.parts.flatMap((part): CadPart[] => {
    if (part.id === next.id) {
      const promoted: CadPart = { ...part, ...(lead.extrudeName !== undefined && { extrudeName: lead.extrudeName }) };
      delete promoted.extrudedWith;
      return [promoted];
    }
    if (part.extrudedWith === partId) return [{ ...part, extrudedWith: next.id }];
    if (part.id !== partId) return [part];
    if (part.sketchOf) return [];
    const sketch: CadPart = { ...part, extrude: false };
    for (const key of ['regions', 'extrudeName', 'upTo', 'upToDatum', 'symmetric', 'suppressed', 'thin'] as const) delete sketch[key];
    return [sketch];
  });
  const kept = new Set(parts.map(part => part.id));
  const folders = document.folders?.map(folder => ({ ...folder, partIds: folder.partIds.filter(id => kept.has(id)) }));
  return { ...document, revision: document.revision + 1, parts, ...(folders && { folders }) };
}
