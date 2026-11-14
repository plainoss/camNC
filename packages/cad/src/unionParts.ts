import { addLine, createCadPart } from './document';
import { cadDrawnOnSupports, effectivePlacement, resolveDrawnPlacements } from './drawnOn';
import { isJoinedBody } from './extrudeSteps';
import { overlappedParts } from './partOverlap';
import { evaluateCadFeatures } from './features';
import { CAD_CHORD_TOLERANCE, evaluateCadPart, pointInPolygon } from './geometry';
import { rotateVector, type Vec3 } from './placement';
import { regionInteriorPoint, sketchRegions } from './sketchRegions';
import type { CadCut, CadDocument, CadPart, CadPartCut, CadPlacement, CadPoint, EvaluatedCadPart } from './types';

const kSame = 1e-6;
/** The smallest step a union leaves between parts of different heights; less is the same height. */
const kMinStep = 0.1;

const conjugate = ([x, y, z, w]: readonly number[]) => [-x!, -y!, -z!, w!];
const toWorld = (placement: CadPlacement, point: Vec3): Vec3 => {
  const turned = rotateVector(placement.rotation, point);
  return [turned[0] + placement.position[0], turned[1] + placement.position[1], turned[2] + placement.position[2]];
};
const toLocal = (placement: CadPlacement, point: Vec3): Vec3 =>
  rotateVector(conjugate(placement.rotation), [
    point[0] - placement.position[0],
    point[1] - placement.position[1],
    point[2] - placement.position[2],
  ]);

export interface UnionInput {
  shape: EvaluatedCadPart;
  source: CadPart;
  at: CadPlacement;
}

/**
 * One part of the parts a Boolean › Union joins, in the first one's place and name: their outlines joined, as high as
 * the highest, and stepped down from the top where only lower ones were. It joins plain boards drawn on one plane and
 * extruded the same way from it; anything else is refused with the reason, as joining it needs a solid of another kind.
 */
export function unitedPart(
  host: UnionInput,
  tools: readonly UnionInput[],
  operation: 'union' | 'intersect' = 'union'
): { part: EvaluatedCadPart } | { refused: string } {
  const all = [host, ...tools];
  for (const { shape, source } of all) {
    if (shape.holes.length || shape.cuts?.length)
      return { refused: `${shape.name} has holes or cuts, which a union or intersection can't keep yet.` };
    if (source.drawnOn?.inward || source.symmetric || source.thin) return { refused: `${shape.name} isn't extruded up from its sketch.` };
  }
  // Every outline in the first part's sketch coordinates, on its sketch plane.
  const outlines: CadPoint[][] = [];
  for (const { shape, at } of all) {
    const points = shape.outline.map(p => toLocal(host.at, toWorld(at, [p.x, p.y, 0])));
    const up = toLocal(host.at, toWorld(at, [shape.outline[0]!.x, shape.outline[0]!.y, 1]));
    const tilt = [up[0] - points[0]![0], up[1] - points[0]![1], up[2] - points[0]![2] - 1];
    if (points.some(p => Math.abs(p[2]) > kSame) || tilt.some(v => Math.abs(v) > kSame))
      return { refused: `${shape.name} isn't drawn on the same plane, extruded the same way, as ${host.shape.name}.` };
    outlines.push(points.map(([x, y]) => ({ x, y })));
  }
  let sketch = createCadPart('Union').sketch;
  for (const outline of outlines)
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length]!;
      sketch = addLine(sketch, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    });
  // An intersection keeps only what every board shares, as high as the lowest of them.
  const height = (operation === 'union' ? Math.max : Math.min)(...all.map(({ shape }) => shape.thickness));
  const regions: string[] = [];
  const cuts: CadCut[] = [];
  for (const region of sketchRegions(sketch, CAD_CHORD_TOLERANCE)) {
    const inside = regionInteriorPoint(region.points);
    if (!inside) continue;
    const covering = all.filter((_, i) => pointInPolygon(inside, outlines[i]!));
    if (!covering.length || (operation === 'intersect' && covering.length < all.length)) continue;
    regions.push(region.id);
    const step = height - Math.max(...covering.map(({ shape }) => shape.thickness));
    if (step >= kMinStep) cuts.push({ type: 'cut', id: `union:${region.id}`, sketchId: sketch.id, regionId: region.id, depth: step });
  }
  const joined: CadPart = { ...createCadPart(host.shape.name, height), id: host.shape.partId, sketch, regions, features: cuts };
  const profile = evaluateCadPart(joined).part;
  const result = profile && evaluateCadFeatures(joined, profile);
  const problem = result?.diagnostics.find(d => d.severity === 'error');
  if (!result || problem) return { refused: problem?.message ?? `${host.shape.name} can't be joined with its tools.` };
  return { part: { ...result.part, partId: host.shape.partId, name: host.shape.name } };
}

const unions = new WeakMap<CadDocument, Map<string, { part: EvaluatedCadPart } | { refused: string }>>();

/**
 * What a Boolean › Union step makes of the design's parts as drawn: the joined part, or why it can't join them. It joins
 * whole parts only, as their sketches make them, so parts with copies, joined Add bodies, or cuts from other steps are
 * refused rather than losing that material. A refused union changes nothing and uses up no tools.
 */
export function unionOf(document: CadDocument, step: CadPartCut): { part: EvaluatedCadPart } | { refused: string } {
  const known = unions.get(document) ?? unions.set(document, new Map()).get(document)!;
  const seen = known.get(step.id);
  if (seen) return seen;
  const made = unite(document, step);
  known.set(step.id, made);
  return made;
}

function unite(document: CadDocument, step: CadPartCut): { part: EvaluatedCadPart } | { refused: string } {
  const ids = [...step.targets.slice(0, 1), ...step.tools];
  if (step.targets.length !== 1 || !step.tools.length || ids.some(id => id.includes(':')))
    return { refused: 'A Boolean › Union joins whole parts: pick parts, not copies.' };
  const parts = ids.map(id => document.parts.find(part => part.id === id));
  if (parts.some(part => !part)) return { refused: 'A part this Boolean › Union joins is gone.' };
  const joined = parts as CadPart[];
  for (const part of joined) {
    if (part.copies?.length || part.pattern) return { refused: `${part.name} has copies, which a union can't join yet.` };
    if (document.parts.some(other => other.addTo === part.id && isJoinedBody(document, other)))
      return { refused: `${part.name} has a body added to it, which a union can't join yet.` };
  }
  // Other steps' cuts in these parts would be lost, and parts other steps use or join can't be joined here too: the union
  // joins the parts as their own sketches make them.
  const usedByOthers = (document.partCuts ?? []).some(
    other =>
      other.id !== step.id &&
      !other.suppressed &&
      joined.some(part => [...other.targets, ...other.tools].some(id => id.split(':')[0] === part.id))
  );
  if (usedByOthers || joined.some(part => part.features?.some(feature => feature.type === 'cut')))
    return { refused: 'A part this union joins has cuts or pockets, or another step uses it, which a union can’t keep yet.' };
  // Nor can it join a part an Add with Merge with all makes or joins, other than the one this step is.
  const merging = document.parts.filter(
    other => other.mergeAll && !other.suppressed && other.extrude !== false && `${other.id}:merge-all` !== step.id
  );
  if (
    joined.some(part => part.mergeAll && `${part.id}:merge-all` !== step.id) ||
    merging.some(other => joined.some(part => overlappedParts(document, other.id).includes(part.id)))
  )
    return { refused: 'A part this joins is joined by an Add with Merge with all too, which can’t be combined yet.' };
  // Placed as drawn, whether or not the document given has been solved.
  const placed = resolveDrawnPlacements(document).document;
  const supports = cadDrawnOnSupports(placed);
  const inputs: UnionInput[] = [];
  for (const source of joined.map(part => placed.parts.find(candidate => candidate.id === part.id)!)) {
    const shape = evaluateCadPart(source).part,
      at = effectivePlacement(source, supports);
    if (!shape || !at) return { refused: `${source.name} isn't built, so it can't be joined.` };
    inputs.push({ shape, source, at });
  }
  return unitedPart(inputs[0]!, inputs.slice(1), step.operation === 'intersect' ? 'intersect' : 'union');
}

/**
 * What an Extrude › Add with Merge with all makes: the union of every earlier part it runs into with it, in the place of
 * the first of them, as a Boolean › Union step of them would. Null when it runs into none, so it stays a part of its own.
 */
export function mergedWithAll(
  document: CadDocument,
  part: CadPart
): { hostId: string; joined: string[]; made: { part: EvaluatedCadPart } | { refused: string } } | null {
  if (!part.mergeAll || part.suppressed || part.extrude === false) return null;
  const touched = overlappedParts(document, part.id);
  if (!touched.length) return null;
  if (document.operationOrder !== undefined)
    return {
      hostId: touched[0]!,
      joined: [],
      made: { refused: 'Merge with all isn’t available in a design with ordered operations yet.' },
    };
  const step: CadPartCut = {
    id: `${part.id}:merge-all`,
    targets: [touched[0]!],
    tools: [...touched.slice(1), part.id],
    clearance: 0,
    operation: 'union',
  };
  return { hostId: touched[0]!, joined: step.tools, made: unionOf(document, step) };
}
