import {
  cadCuts,
  cadFaceSketches,
  cadSketchRegions,
  evaluateCadFeatures,
  evaluateCadPart,
  pointInPolygon,
  polygonArea,
  setCutDepth,
  removeCadFeature,
  type CadCut,
  type CadCutDepth,
  type CadFaceRef,
  type CadDocument,
  type CadPart,
  type CadPoint,
  type CadSketchRegion,
} from '@wbcnc/cad';

export interface CutRegion {
  sketchId: string;
  region: CadSketchRegion;
  cut?: CadCut;
  /** What the region is cut to now. A cut that's switched off counts for nothing. */
  depth: CadCutDepth;
  /** mm below the top where a cut here starts: 0, or the depth of the pocket floor its sketch sits on. */
  from: number;
  /** The face its sketch sits on. */
  on: CadFaceRef;
  /** Inner loops of the profile are through-holes unless their cut says otherwise. */
  inProfile: boolean;
}
const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/** Everything on a part that can take a depth: the profile's inner loops, and the regions of its face sketches. */
export function cutRegions(part: CadPart): CutRegion[] {
  const profile = evaluateCadPart(part).part;
  if (!profile) return [];
  const cuts = cadCuts(part),
    made = evaluateCadFeatures(part, profile).part.cuts ?? [],
    outer = profile.loops.find(loop => loop.kind === 'outer')!,
    outlineId = `${part.id}:outline`,
    entry = (sketchId: string, inProfile: boolean, on: CadFaceRef, from: number) => (region: CadSketchRegion) => {
      const cut = cuts.find(candidate => candidate.sketchId === sketchId && candidate.regionId === region.id);
      return {
        sketchId,
        region,
        inProfile,
        cut,
        on,
        from,
        depth: cut && !cut.suppressed ? cut.depth : inProfile ? 'through' : 0,
      } as CutRegion;
    };
  return [
    ...cadSketchRegions(part, part.sketch.id, profile.outline)
      .filter(region => !sameIds(region.curveIds, outer.entityIds))
      .map(entry(part.sketch.id, true, 'top', 0)),
    ...cadFaceSketches(part).flatMap(face => {
      const from = typeof face.on === 'object' ? made.find(cut => cut.id === (face.on as { floorOf: string }).floorOf)?.to : 0;
      // A sketch that lost its floor has nowhere to cut until it's moved.
      if (from === undefined) return [];
      return cadSketchRegions(part, face.sketch.id, profile.outline)
        .filter(region => !(region.curveIds.length === 1 && region.curveIds[0] === outlineId))
        .map(entry(face.sketch.id, false, face.on, from));
    }),
  ];
}

/** The smallest region under a point, so a region drawn inside another can be picked. */
export function cutRegionAt(regions: CutRegion[], point: CadPoint): CutRegion | null {
  const under = regions.filter(
    ({ region }) => pointInPolygon(point, region.points) && !region.holes.some(hole => pointInPolygon(point, hole))
  );
  return under.reduce<CutRegion | null>(
    (best, entry) => (!best || Math.abs(polygonArea(entry.region.points)) < Math.abs(polygonArea(best.region.points)) ? entry : best),
    null
  );
}

export const cutRegionPath = (region: CadSketchRegion) =>
  [region.points, ...region.holes].map(loop => loop.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${-p.y}`).join(' ') + ' Z').join(' ');

export const depthLabel = ({ depth }: CutRegion) => (depth === 'through' ? 'Through' : depth === 0 ? 'No cut' : `${depth} mm`);

/** A loop that's cut through, or a face region left uncut, needs no feature: it's the default. */
export function withRegionDepth(document: CadDocument, partId: string, entry: CutRegion, depth: CadCutDepth): CadDocument {
  if (depth !== (entry.inProfile ? 'through' : 0)) return setCutDepth(document, partId, entry.sketchId, entry.region.id, depth);
  return entry.cut ? removeCadFeature(document, partId, entry.cut.id) : document;
}

/** How high a region's visible surface sits above the part's underside. */
export const regionSurfaceZ = ({ depth, from }: Pick<CutRegion, 'depth' | 'from'>, thickness: number) =>
  depth === 'through' ? 0 : thickness - from - depth;

const under = ({ region }: CutRegion, point: CadPoint) =>
  pointInPolygon(point, region.points) && !region.holes.some(hole => pointInPolygon(point, hole));

/**
 * How high the part really is at a point. Regions from separate sketches overlap, so this applies their cuts in order,
 * as CAM does: a cut only removes what's under its start, and an uncut region removes nothing.
 */
export function exposedHeightAt(regions: CutRegion[], thickness: number, point: CadPoint) {
  return regions.reduce((height, entry) => {
    if (!entry.depth || !under(entry, point) || height > thickness - entry.from + 0.005) return height;
    return Math.min(height, regionSurfaceZ(entry, thickness));
  }, thickness);
}

/** The face a click on this region means: a pocket's floor, or the face its uncut region lies on. */
export function regionFace(entry: CutRegion): CadFaceRef | null {
  if (entry.depth === 'through') return null;
  return entry.depth && entry.cut ? { floorOf: entry.cut.id } : entry.on;
}
