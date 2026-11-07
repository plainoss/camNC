import {
  cadCuts,
  cadFaceSketches,
  cadSketchRegions,
  evaluateCadPart,
  pointInPolygon,
  polygonArea,
  setCutDepth,
  removeCadFeature,
  type CadCut,
  type CadCutDepth,
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
  /** Inner loops of the profile are through-holes unless their cut says otherwise. */
  inProfile: boolean;
}
const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/** Everything on a part that can take a depth: the profile's inner loops, and the regions of its face sketches. */
export function cutRegions(part: CadPart): CutRegion[] {
  const profile = evaluateCadPart(part).part;
  if (!profile) return [];
  const cuts = cadCuts(part),
    outer = profile.loops.find(loop => loop.kind === 'outer')!,
    outlineId = `${part.id}:outline`,
    entry = (sketchId: string, inProfile: boolean) => (region: CadSketchRegion) => {
      const cut = cuts.find(candidate => candidate.sketchId === sketchId && candidate.regionId === region.id);
      return { sketchId, region, inProfile, cut, depth: cut && !cut.suppressed ? cut.depth : inProfile ? 'through' : 0 };
    };
  return [
    ...cadSketchRegions(part, part.sketch.id, profile.outline)
      .filter(region => !sameIds(region.curveIds, outer.entityIds))
      .map(entry(part.sketch.id, true)),
    ...cadFaceSketches(part).flatMap(face =>
      cadSketchRegions(part, face.sketch.id, profile.outline)
        .filter(region => !(region.curveIds.length === 1 && region.curveIds[0] === outlineId))
        .map(entry(face.sketch.id, false))
    ),
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
export const regionSurfaceZ = (depth: CadCutDepth, thickness: number) => (depth === 'through' ? 0 : thickness - depth);
