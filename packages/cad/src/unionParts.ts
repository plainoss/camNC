import { addLine, createCadPart } from './document';
import { cadDrawnOnSupports, effectivePlacement, resolveDrawnPlacements } from './drawnOn';
import { isJoinedBody } from './extrudeSteps';
import { overlappedParts } from './partOverlap';
import { cadSketchRegions, evaluateCadFeatures, isCadPart } from './features';
import { flipUnderside } from './featureModel';
import { CAD_CHORD_TOLERANCE, evaluateCadPart, pointInPolygon } from './geometry';
import { rotateVector, type Vec3 } from './placement';
import { regionInteriorPoint, sketchRegions } from './sketchRegions';
import type { CadCut, CadDocument, CadFaceSketch, CadPart, CadPartCut, CadPlacement, CadPoint, EvaluatedCadPart } from './types';

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
 * the highest, stepped down from the top where only lower ones were and pocketed from below where every one starts
 * higher. It joins plain boards drawn on planes parallel to the first one's, from that plane up, each extruded one way
 * along its normal; anything else is refused with the reason, as joining it needs a solid of another kind.
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
    if (source.symmetric || source.thin) return { refused: `${shape.name} isn't extruded one way from its sketch.` };
  }
  // Every outline in the first part's sketch coordinates, and how high each body runs above its sketch plane: a body
  // drawn on a plane parallel to it, extruded either way along its normal, is a slab between two heights.
  const outlines: CadPoint[][] = [];
  const spans: [number, number][] = [];
  for (const { shape, at } of all) {
    const points = shape.outline.map(p => toLocal(host.at, toWorld(at, [p.x, p.y, 0])));
    const up = toLocal(host.at, toWorld(at, [shape.outline[0]!.x, shape.outline[0]!.y, 1]));
    const along = up[2] - points[0]![2];
    const tilt = [up[0] - points[0]![0], up[1] - points[0]![1], Math.abs(along) - 1];
    const level = points[0]![2];
    if (points.some(p => Math.abs(p[2] - level) > kSame) || tilt.some(v => Math.abs(v) > kSame))
      return { refused: `${shape.name} isn't drawn on a plane parallel to ${host.shape.name}'s, extruded along its normal.` };
    outlines.push(points.map(([x, y]) => ({ x, y })));
    spans.push(along > 0 ? [level, level + shape.thickness] : [level - shape.thickness, level]);
  }
  // The joined part stands on the first part's sketch plane; one reaching below it would have to move it.
  if (spans.some(([low]) => low < -kSame))
    return { refused: `A part reaches below ${host.shape.name}'s sketch plane, which a union can't join yet.` };
  let sketch = createCadPart('Union').sketch;
  for (const outline of outlines)
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length]!;
      sketch = addLine(sketch, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    });
  // What a region of the joined outline is filled between: the covering slabs joined, or for an intersection shared.
  const filled = (inside: CadPoint): [number, number] | null | 'gap' => {
    const covering = spans.filter((_, i) => pointInPolygon(inside, outlines[i]!));
    if (!covering.length || (operation === 'intersect' && covering.length < all.length)) return null;
    if (operation === 'intersect') {
      const low = Math.max(...covering.map(([l]) => l)),
        high = Math.min(...covering.map(([, h]) => h));
      return high - low >= kMinStep ? [low, high] : null;
    }
    const sorted = [...covering].sort((a, b) => a[0] - b[0]);
    const low = sorted[0]![0];
    let high = sorted[0]![1];
    for (const [l, h] of sorted.slice(1)) {
      if (l > high + kSame) return 'gap';
      high = Math.max(high, h);
    }
    return [low, high];
  };
  const regions: string[] = [];
  const cuts: CadCut[] = [];
  const kept: [number, number][] = [];
  const topRegions = sketchRegions(sketch, CAD_CHORD_TOLERANCE);
  for (const region of topRegions) {
    const inside = regionInteriorPoint(region.points);
    const span = inside && filled(inside);
    if (span === 'gap') return { refused: 'The parts would leave a gap between them, which a union can’t join yet.' };
    if (!span) continue;
    regions.push(region.id);
    kept.push(span);
  }
  if (!kept.length) return { refused: `${host.shape.name} can't be joined with its tools.` };
  // A union joins bodies that meet: over an area where their slabs touch, or side by side where their slabs overlap.
  if (operation === 'union' && !connected(outlines, spans, topRegions))
    return { refused: 'The parts don’t all touch, so a union would leave them apart.' };
  // Nor can a part start above the first part's sketch plane, as an intersection sunk into its top would.
  if (Math.min(...kept.map(([low]) => low)) >= kMinStep)
    return { refused: `What's kept starts above ${host.shape.name}'s sketch plane, which can't be made yet.` };
  const height = Math.max(...kept.map(([, high]) => high));
  regions.forEach((regionId, i) => {
    const step = height - kept[i]![1];
    if (step >= kMinStep) cuts.push({ type: 'cut', id: `union:${regionId}`, sketchId: sketch.id, regionId, depth: step });
  });
  // Where every slab starts above the sketch plane, the part is pocketed from its underside up to the lowest of them.
  let joined: CadPart = { ...createCadPart(host.shape.name, height), id: host.shape.partId, sketch, regions, features: cuts };
  if (kept.some(([low]) => low >= kMinStep)) {
    let under = createCadPart('Union underside').sketch;
    for (const outline of outlines) {
      const flipped = flipUnderside(outline);
      flipped.forEach((a, i) => {
        const b = flipped[(i + 1) % flipped.length]!;
        under = addLine(under, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      });
    }
    const face: CadFaceSketch = { type: 'sketch', id: `${host.shape.partId}:union-underside`, on: 'underside', sketch: under };
    const withFace = { ...joined, features: [...cuts, face] };
    const lifted: CadCut[] = [];
    for (const region of cadSketchRegions(withFace, under.id)) {
      const inside = regionInteriorPoint(region.points);
      const span = inside && filled({ x: -inside.x, y: inside.y });
      if (span && span !== 'gap' && span[0] >= kMinStep)
        lifted.push({ type: 'cut', id: `union:under:${region.id}`, sketchId: under.id, regionId: region.id, depth: span[0] });
    }
    if (lifted.length) joined = { ...withFace, features: [...withFace.features, ...lifted] };
  }
  const profile = evaluateCadPart(joined).part;
  const result = profile && evaluateCadFeatures(joined, profile);
  const problem = result?.diagnostics.find(d => d.severity === 'error');
  if (!result || problem) return { refused: problem?.message ?? `${host.shape.name} can't be joined with its tools.` };
  return { part: { ...result.part, partId: host.shape.partId, name: host.shape.name } };
}

/** Whether every body meets the first, directly or through others, by an area or a shared side. */
function connected(outlines: CadPoint[][], spans: [number, number][], regions: { points: CadPoint[] }[]): boolean {
  const n = outlines.length;
  const meets = (i: number, j: number) => {
    const [a, b] = [spans[i]!, spans[j]!];
    const overlap = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
    if (overlap < -kSame) return false;
    // Over an area: some region both cover, their slabs touching or overlapping.
    const over = regions.some(region => {
      const inside = regionInteriorPoint(region.points);
      return !!inside && pointInPolygon(inside, outlines[i]!) && pointInPolygon(inside, outlines[j]!);
    });
    // Side by side: their outlines share a side, and their slabs overlap in height, so they share a face.
    return over || (overlap >= kMinStep && sharesSide(outlines[i]!, outlines[j]!));
  };
  const reached = new Set([0]);
  for (let grew = true; grew; ) {
    grew = false;
    for (let j = 0; j < n; j++)
      if (!reached.has(j) && [...reached].some(i => meets(i, j))) {
        reached.add(j);
        grew = true;
      }
  }
  return reached.size === n;
}

/** Whether two outlines have collinear sides that overlap along a length, as boards side by side do. */
function sharesSide(a: CadPoint[], b: CadPoint[]): boolean {
  const sides = (points: CadPoint[]) => points.map((p, i) => [p, points[(i + 1) % points.length]!] as const);
  for (const [p, q] of sides(a))
    for (const [r, t] of sides(b)) {
      const dx = q.x - p.x,
        dy = q.y - p.y,
        length = Math.hypot(dx, dy);
      if (length < kSame) continue;
      const off = (point: CadPoint) => Math.abs((point.x - p.x) * dy - (point.y - p.y) * dx) / length;
      if (off(r) > CAD_CHORD_TOLERANCE || off(t) > CAD_CHORD_TOLERANCE) continue;
      const along = (point: CadPoint) => ((point.x - p.x) * dx + (point.y - p.y) * dy) / length;
      const [lo, hi] = [Math.min(along(r), along(t)), Math.max(along(r), along(t))];
      if (Math.min(hi, length) - Math.max(lo, 0) > kMinStep) return true;
    }
  return false;
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
    if (document.parts.some(other => other.addTo === part.id && isJoinedBody(document, other) && !step.tools.includes(other.id)))
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
): { hostId: string; joined: string[]; made: { part: EvaluatedCadPart } | { refused: string }; lost?: string[] } | null {
  if (part.intersect && !part.suppressed && part.extrude !== false) return intersectedWith(document, part);
  if (!part.mergeAll && part.addTo && isJoinedBody(document, part)) return fusedAdd(document, part);
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

/** As the reference says it when an Extrude › Intersect keeps nothing. */
export const kNoIntersection = 'The parts either do not intersect or are totally contained.';

/**
 * What an Extrude › Intersect makes: the part it runs into cut down to what the extrude shares with it, in its place.
 * The other parts before it share nothing, so they're used up too. One that can't be made changes nothing but its own
 * body, which isn't made: the parts before it stay as they were.
 */
function intersectedWith(
  document: CadDocument,
  part: CadPart
): { hostId: string; joined: string[]; made: { part: EvaluatedCadPart } | { refused: string }; lost: string[] } {
  const scope = document.parts
    .slice(0, document.parts.indexOf(part))
    .filter(other => isCadPart(other) && !other.remove && !other.suppressed && !isJoinedBody(document, other))
    .map(other => other.id);
  const lost = [part.id];
  const touched = overlappedParts(document, part.id);
  if (touched.length !== 1) {
    const refused = touched.length ? 'Intersecting more than one part isn’t available yet.' : kNoIntersection;
    return { hostId: scope[0] ?? part.id, joined: [], made: { refused }, lost };
  }
  const step: CadPartCut = { id: `${part.id}:intersect`, targets: [touched[0]!], tools: [part.id], clearance: 0, operation: 'intersect' };
  const made = unionOf(document, step);
  return {
    hostId: touched[0]!,
    joined: [part.id, ...scope].filter(id => id !== touched[0]),
    made: 'refused' in made ? { refused: kNoIntersection } : made,
    lost,
  };
}

/**
 * An Extrude › Add's body fused into the part it joins, as one solid: a stepped part where they differ in height. Only
 * the one body joined to a part, drawn on its plane and extruded the same way, is fused; any other stays a solid of its
 * own beside it, as before.
 */
function fusedAdd(document: CadDocument, part: CadPart): { hostId: string; joined: string[]; made: { part: EvaluatedCadPart } } | null {
  const hostId = part.addTo!;
  if (document.parts.some(other => other.id !== part.id && other.addTo === hostId && isJoinedBody(document, other))) return null;
  const made = unionOf(document, { id: `${part.id}:add`, targets: [hostId], tools: [part.id], clearance: 0, operation: 'union' });
  return 'part' in made ? { hostId, joined: [part.id], made } : null;
}
