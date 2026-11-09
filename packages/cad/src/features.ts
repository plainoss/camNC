import { applyExtrudeRemovals, isSpatialRemoval } from './extrudeRemoval';
import { faceRemovalDepth } from './faceRemovalDepth';
import { newCadId, originId } from './document';
import { cadCuts, cadFaceSketches, faceIsUnderside, flipUnderside } from './featureModel';
import { CAD_CHORD_TOLERANCE, evaluateCadPart, polygonArea, validateCadDocument } from './geometry';
import { relieveCorners } from './cornerRelief';
import { applyPartCuts } from './cutParts';
import { patternInstanceOffset, patternMaster } from './pattern';
import { sketchRegions, type CadSketchRegion } from './sketchRegions';
import { activeDesign } from './suppression';
import type {
  CadCut,
  CadCutDepth,
  CadDiagnostic,
  CadDocument,
  CadFaceRef,
  CadFaceSketch,
  CadPart,
  CadPoint,
  CadSketch,
  EvaluatedCadCut,
  EvaluatedCadPart,
} from './types';
import { isCadBody, resolveExtrudeSteps } from './extrudeSteps';

/** Whether a part is one, rather than a sketch not yet extruded, a suppressed extrude, or an extrude that adds to or cuts others. */
export const isCadPart = (part: CadPart): boolean => part.extrude !== false && !part.suppressed && part.addTo === undefined && !part.remove;

/** Features belong to the newer format, so an older build refuses the file instead of silently cutting without them. */
export function withFeatureVersion(document: CadDocument): CadDocument {
  return { ...document, version: document.parts.some(part => part.features?.length) ? 2 : 1 };
}
function editPart(
  document: CadDocument,
  partId: string,
  edit: (features: NonNullable<CadPart['features']>) => CadPart['features']
): CadDocument {
  return withFeatureVersion({
    ...document,
    parts: document.parts.map(part => {
      if (part.id !== partId) return part;
      const { features: current, ...rest } = part,
        features = edit(current ?? []);
      return features?.length ? { ...rest, features } : rest;
    }),
  });
}

export function addFaceSketch(document: CadDocument, partId: string, on: CadFaceRef): { document: CadDocument; sketchId: string } {
  const sketch: CadSketch = { id: newCadId(), entities: [], constraints: [] };
  sketch.entities.push({ id: originId(sketch), type: 'point', x: 0, y: 0, fixed: true, construction: true });
  return {
    document: editPart(document, partId, features => [...features, { type: 'sketch', id: newCadId(), on, sketch }]),
    sketchId: sketch.id,
  };
}

/** Sets the depth of a region's cut, adding the cut if it has none. A region has at most one cut. */
export function setCutDepth(
  document: CadDocument,
  partId: string,
  sketchId: string,
  regionId: string,
  depth: CadCutDepth,
  /** The depth as typed, when it uses design variables. */
  depthExpression?: string
): CadDocument {
  const typed = depth !== 'through' && depthExpression ? { depthExpression } : {};
  return editPart(document, partId, features =>
    features.some(f => f.type === 'cut' && f.sketchId === sketchId && f.regionId === regionId)
      ? features.map(f => {
          if (f.type !== 'cut' || f.sketchId !== sketchId || f.regionId !== regionId) return f;
          // Setting a depth means the cut is wanted, so it comes back on.
          const { suppressed: _suppressed, depthExpression: _typed, ...cut } = f;
          return { ...cut, depth, ...typed };
        })
      : [...features, { type: 'cut', id: newCadId(), sketchId, regionId, depth, ...typed }]
  );
}

/** Switches a cut off or back on, keeping its depth. */
export function setCutSuppressed(document: CadDocument, partId: string, cutId: string, suppressed: boolean): CadDocument {
  return editPart(document, partId, features =>
    features.map(f => {
      if (f.type !== 'cut' || f.id !== cutId) return f;
      const { suppressed: _suppressed, ...cut } = f;
      return suppressed ? { ...cut, suppressed } : cut;
    })
  );
}

/** One face sketch as its own document, so the sketch editor can work on it like any other drawing. */
export function faceSketchDocument(document: CadDocument, partId: string, sketchId: string): CadDocument {
  const part = document.parts.find(candidate => candidate.id === partId),
    face = part && cadFaceSketches(part).find(candidate => candidate.sketch.id === sketchId);
  if (!part || !face) throw new Error('This face sketch no longer exists.');
  return {
    version: 1,
    id: `${document.id}:face:${sketchId}`,
    name: document.name,
    revision: document.revision,
    parts: [{ id: part.id, name: part.name, thickness: part.thickness, sketch: face.sketch }],
  };
}

/** Puts an edited face sketch back into its document. */
export function withFaceSketchDocument(document: CadDocument, partId: string, sketchId: string, edited: CadDocument): CadDocument {
  return {
    ...document,
    revision: Math.max(document.revision, edited.revision),
    parts: document.parts.map(part =>
      part.id !== partId
        ? part
        : {
            ...part,
            features: part.features?.map(feature =>
              feature.type === 'sketch' && feature.sketch.id === sketchId ? { ...feature, sketch: edited.parts[0]!.sketch } : feature
            ),
          }
    ),
  };
}

/** Puts a face sketch on another face, for one that lost the pocket floor it sat on. */
export function moveFaceSketch(document: CadDocument, partId: string, sketchId: string, on: CadFaceRef): CadDocument {
  return editPart(document, partId, features => features.map(f => (f.type === 'sketch' && f.sketch.id === sketchId ? { ...f, on } : f)));
}

/** Removes a feature, and the cuts of a removed sketch. Sketches on a removed cut's floor report the lost face. */
export function removeCadFeature(document: CadDocument, partId: string, featureId: string): CadDocument {
  return editPart(document, partId, features => {
    const gone = features.find(f => f.id === featureId),
      sketchId = gone?.type === 'sketch' ? gone.sketch.id : null;
    return features.filter(f => f.id !== featureId && !(f.type === 'cut' && f.sketchId === sketchId));
  });
}

/** The regions cuts can refer to in one of a part's sketches. Face sketches also use the part's outline as a boundary. */
export function cadSketchRegions(part: CadPart, sketchId: string, outline?: CadPoint[]): CadSketchRegion[] {
  if (sketchId === part.sketch.id) return sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
  const face = cadFaceSketches(part).find(candidate => candidate.sketch.id === sketchId);
  if (!face) return [];
  const profile = outline ?? evaluateCadPart(part).part?.outline,
    points = profile && faceIsUnderside(part, face.on) ? flipUnderside(profile) : profile;
  return points ? sketchRegions(face.sketch, CAD_CHORD_TOLERANCE, { boundary: { id: `${part.id}:outline`, points } }) : [];
}

/** CAM drops anything smaller, so these are refused up front and never vanish without a word. */
const MIN_CUT_DEPTH = 0.01;
const MIN_CUT_AREA = 1;

/**
 * The regions a pattern's copies make of a region drawn by its original: found by mapping the region's curves through
 * each copy's IDs. Curves the pattern doesn't own, such as the part's outline that closes a groove running off it, stay
 * as they are. Copies whose region isn't there, as a pattern shrinks, are left out. A region of a copy has none, so a
 * cut given to one copy stays on it.
 */
function patternCopyRegions(
  sketch: CadSketch,
  regions: CadSketchRegion[],
  region: CadSketchRegion
): { region: CadSketchRegion; key: string }[] {
  for (const pattern of sketch.constraints) {
    if (pattern.type !== 'linearPattern' && pattern.type !== 'circularPattern') continue;
    const own = patternMaster(pattern);
    if (!own) continue;
    const seedOf = new Map(Object.entries(own.idMap).map(([seed, id]) => [id, seed]));
    if (!region.curveIds.some(id => seedOf.has(id))) continue;
    return pattern.instances.flatMap(instance => {
      if (instance === own) return [];
      const mapped = region.curveIds.map(id => (seedOf.has(id) ? instance.idMap[seedOf.get(id)!] : id));
      if (mapped.some(id => !id)) return [];
      // Regions on both sides of a patterned line share its curves, so the copy must also be the original moved.
      const step = patternInstanceOffset(pattern, instance);
      const copy = regions.find(
        candidate =>
          sameIds(candidate.curveIds, mapped as string[]) && sameShape(region, candidate, pattern.type === 'linearPattern' ? step : null)
      );
      return copy ? [{ region: copy, key: `${instance.x},${instance.y}` }] : [];
    });
  }
  return [];
}

/** Whether a region's curves include one a pattern made for a copy it no longer has. Region IDs list their curves' sides. */
function onDroppedPatternCopy(sketch: CadSketch, regionId: string): boolean {
  const sides = regionId
    .slice(regionId.indexOf(':region:') + ':region:'.length)
    .replace(/#\d+$/, '')
    .split('|');
  const curves = new Set(sides.map(side => side.slice(0, side.lastIndexOf(':'))));
  const present = new Set(sketch.entities.map(entity => entity.id));
  return sketch.constraints.some(
    c =>
      (c.type === 'linearPattern' || c.type === 'circularPattern') &&
      c.instances.some(instance => Object.values(instance.idMap).some(id => curves.has(id) && !present.has(id)))
  );
}

/** Whether a region could be another one moved by `step`, or turned somewhere when there's no step: the same area, and the same extent shifted. */
function sameShape(original: CadSketchRegion, candidate: CadSketchRegion, step: CadPoint | null): boolean {
  const area = (region: CadSketchRegion) =>
    Math.abs(polygonArea(region.points)) - region.holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0);
  if (Math.abs(area(original) - area(candidate)) > 1e-3 * Math.max(1, area(original))) return false;
  if (!step) return true;
  const extent = (points: CadPoint[]) => [
    Math.min(...points.map(p => p.x)),
    Math.min(...points.map(p => p.y)),
    Math.max(...points.map(p => p.x)),
    Math.max(...points.map(p => p.y)),
  ];
  const [x0, y0, x1, y1] = extent(original.points),
    moved = [x0! + step.x, y0! + step.y, x1! + step.x, y1! + step.y];
  return extent(candidate.points).every((value, i) => Math.abs(value - moved[i]!) < 1e-3);
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * Applies a part's features to its evaluated profile. An inner loop stays a through-hole unless its cut says otherwise,
 * so parts without features evaluate exactly as they always have.
 */
export function evaluateCadFeatures(part: CadPart, profile: EvaluatedCadPart): { part: EvaluatedCadPart; diagnostics: CadDiagnostic[] } {
  const cut = cutFeatures(part, profile);
  if (!part.cornerRelief) return cut;
  const { part: next, skipped } = relieveCorners(cut.part, part.cornerRelief.diameter);
  const diagnostics = [...cut.diagnostics];
  if (skipped.length)
    diagnostics.push({
      code: 'corner-relief-skipped',
      severity: 'warning',
      partId: part.id,
      message: `${skipped.length === 1 ? 'One corner is' : `${skipped.length} corners are`} too tight for a ${part.cornerRelief.diameter} mm bone and stay square.`,
      points: skipped,
    });
  return { part: next, diagnostics };
}

function cutFeatures(part: CadPart, profile: EvaluatedCadPart): { part: EvaluatedCadPart; diagnostics: CadDiagnostic[] } {
  if (!part.features?.length) return { part: profile, diagnostics: [] };
  const diagnostics: CadDiagnostic[] = [];
  const error = (code: string, message: string, entityIds?: string[]) =>
    diagnostics.push({ code, message, severity: 'error', partId: part.id, entityIds });
  const regions = new Map<string, CadSketchRegion[]>([[part.sketch.id, cadSketchRegions(part, part.sketch.id)]]);
  const faces = new Map<string, CadFaceRef>();
  for (const face of cadFaceSketches(part)) {
    regions.set(face.sketch.id, cadSketchRegions(part, face.sketch.id, profile.outline));
    faces.set(face.sketch.id, face.on);
  }
  const cuts: EvaluatedCadCut[] = [],
    keptHoles = new Set<string>();
  const start = (face: CadFaceRef | undefined): { side: EvaluatedCadCut['side']; from: number } | null => {
    if (face === undefined || face === 'top') return { side: 'top', from: 0 };
    if (face === 'underside') return { side: 'underside', from: 0 };
    const floor = cuts.find(cut => cut.id === face.floorOf);
    return floor && !floor.through ? { side: floor.side, from: floor.to } : null;
  };
  const uncut = profile.loops.filter(loop => loop.kind === 'hole');
  for (const feature of part.features) {
    if (feature.type === 'sketch') {
      if (!start(feature.on)) error('cut-face-lost', 'A sketch lost the pocket floor it sat on. Move it to another face, or remove it.');
      continue;
    }
    if (feature.suppressed) continue;
    const region = regions.get(feature.sketchId)?.find(candidate => candidate.id === feature.regionId);
    if (!region) {
      const sketch =
        feature.sketchId === part.sketch.id ? part.sketch : cadFaceSketches(part).find(f => f.sketch.id === feature.sketchId)?.sketch;
      // A copy a shrinking pattern dropped takes its cut with it, as the copy's material is no longer there to cut.
      if (sketch && onDroppedPatternCopy(sketch, feature.regionId))
        diagnostics.push({
          code: 'cut-copy-gone',
          severity: 'warning',
          partId: part.id,
          message: 'A cut was on a pattern copy that’s gone, so it’s left out.',
        });
      else error('cut-region-missing', 'A cut lost its sketch region. Pick the region again, or remove the cut.');
      continue;
    }
    const at = start(faces.get(feature.sketchId));
    if (!at) continue;
    const sketch =
      feature.sketchId === part.sketch.id ? part.sketch : cadFaceSketches(part).find(f => f.sketch.id === feature.sketchId)!.sketch;
    // A pattern's copies are cut as their original is, including copies it gains later, unless a copy has its own cut.
    const ownCuts = new Set(cadCuts(part).flatMap(cut => (cut.sketchId === feature.sketchId ? [cut.regionId] : [])));
    const copies = patternCopyRegions(sketch, regions.get(feature.sketchId)!, region).filter(copy => !ownCuts.has(copy.region.id));
    for (const { region: target, key } of [{ region, key: '' }, ...copies]) {
      const failed = diagnostics.length;
      cutRegion(feature, target, key ? `${feature.id}~${key}` : feature.id, at);
      // One problem is enough: the copies would only repeat it.
      if (diagnostics.length > failed) break;
    }
  }
  function cutRegion(feature: CadCut, region: CadSketchRegion, id: string, at: { side: EvaluatedCadCut['side']; from: number }) {
    const fromProfile = feature.sketchId === part.sketch.id,
      hole = fromProfile ? uncut.find(loop => sameIds(loop.entityIds, region.curveIds)) : undefined;
    if (hole && feature.depth === 'through') {
      keptHoles.add(hole.id);
      return;
    }
    if (hole) uncut.splice(uncut.indexOf(hole), 1);
    if (feature.depth === 0) return;
    if (feature.depth === 'through') {
      // A through cut mustn't change the part's outline or leave a loose piece: CAM holds each part by its one outline.
      if (fromProfile) {
        error('cut-whole-part', 'The whole part can’t be cut through. Pick a region inside it.', region.curveIds);
        return;
      }
      if (region.curveIds.includes(`${part.id}:outline`)) {
        error('cut-through-edge', 'A through cut can’t reach the part’s edge. Change the profile instead, or use a separate part.');
        return;
      }
      if (region.holes.length) {
        error('cut-through-island', 'A through cut can’t leave a loose piece inside it. Use a separate part for that piece.');
        return;
      }
    } else {
      const left = part.thickness - at.from;
      // Thickness can change after the depth was set, so a pocket must never quietly become a through cut.
      if (feature.depth > left - MIN_CUT_DEPTH) {
        error(
          'cut-too-deep',
          `A ${feature.depth} mm cut doesn’t fit in the ${+left.toFixed(3)} mm of material left. Make it shallower, or cut through.`
        );
        return;
      }
      if (feature.depth < MIN_CUT_DEPTH) {
        error('cut-too-shallow', `A cut needs to be at least ${MIN_CUT_DEPTH} mm deep. Make it deeper, or leave the region uncut.`);
        return;
      }
    }
    const flip = (points: CadPoint[]) => (at.side === 'underside' ? flipUnderside(points) : points),
      outline = hole ? [...hole.points].reverse() : flip(region.points);
    if (Math.abs(polygonArea(outline)) - region.holes.reduce((sum, island) => sum + Math.abs(polygonArea(island)), 0) < MIN_CUT_AREA) {
      error('cut-too-small', `A cut needs at least ${MIN_CUT_AREA} mm² of area to be machined.`);
      return;
    }
    const to = feature.depth === 'through' ? part.thickness : at.from + feature.depth;
    cuts.push({
      id,
      regionId: region.id,
      side: at.side,
      from: at.from,
      to,
      through: feature.depth === 'through',
      outline,
      islands: region.holes.map(flip),
    });
  }
  // Holes whose loop gained a depth aren't holes any more; every other inner loop keeps its place and order.
  const holes = profile.loops.filter(loop => loop.kind === 'hole' && (uncut.includes(loop) || keptHoles.has(loop.id)));
  return {
    part: {
      ...profile,
      holes: holes.map(loop => loop.points),
      loops: profile.loops.filter(loop => loop.kind === 'outer' || holes.includes(loop)),
      ...(cuts.length && { cuts }),
    },
    diagnostics,
  };
}

export function evaluateCadDocument(given: CadDocument): { parts: EvaluatedCadPart[]; diagnostics: CadDiagnostic[] } {
  // What's suppressed in the feature list isn't built.
  // Regenerate named face cuts before evaluating the sketches that reference their pocket floors.
  const document = activeDesign(given.parts.some(part => part.remove && !isSpatialRemoval(part)) ? resolveExtrudeSteps(given) : given);
  const diagnostics = validateCadDocument(document);
  if (diagnostics.some(d => d.severity === 'error')) return { parts: [], diagnostics };
  const parts: EvaluatedCadPart[] = [];
  for (const part of document.parts) {
    if (part.remove && !isSpatialRemoval(part) && part.extrude !== false && !part.suppressed) {
      const on = part.drawnOn?.on;
      const support = on && 'partId' in on && document.parts.find(candidate => candidate.id === on.partId);
      if (support) {
        const extent = faceRemovalDepth(part, support.thickness);
        if ('error' in extent)
          diagnostics.push({ code: 'extrude-remove-unresolved', severity: 'error', partId: part.id, message: extent.error });
      }
    }
    const result = evaluateCadPart(part);
    // A sketch not yet extruded needn't close into a profile, as a part's must: what's wrong with one is only a warning.
    diagnostics.push(
      ...(isCadBody(document, part) ? result.diagnostics : result.diagnostics.map(d => ({ ...d, severity: 'warning' as const })))
    );
    if (!result.part) continue;
    const evaluated = evaluateCadFeatures(part, result.part);
    diagnostics.push(...evaluated.diagnostics);
    parts.push(evaluated.part);
  }
  // Remove geometry is part of a body's shape before a later cut-parts step uses it as a tool.
  const removed = applyExtrudeRemovals(document, parts);
  diagnostics.push(...removed.diagnostics);
  const cut = applyPartCuts(document, removed.parts);
  diagnostics.push(...cut.diagnostics);
  return { parts: diagnostics.some(d => d.severity === 'error') ? [] : cut.parts, diagnostics };
}
