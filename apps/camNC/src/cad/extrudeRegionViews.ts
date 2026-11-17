import {
  cadFaceFrame,
  cadSketchFrame,
  CAD_CHORD_TOLERANCE,
  evaluateCadPart,
  removalRegions,
  sketchRegions,
  type CadDocument,
  type CadPart,
} from '@wbcnc/cad';
import type { ViewRegion } from '@/cam/model/ModelViewport';
import { enclosedUsedRegions } from './enclosedRegions';

/**
 * The regions an extrude can pick, as the 3D view shows them while it's open: a Remove's on the face it cuts, among
 * those the board's outline closes off too; any other's on the face it ends at, so the part's own body doesn't hide
 * them. None when there's nothing to choose between.
 */
/** A picked sketch line's id among the regions the view shows, as a thin extrude picks lines rather than faces. */
export const edgePickId = (lineId: string) => `edge:${lineId}`;
const edgeOf = (id: string) => (id.startsWith('edge:') ? id.slice(5) : null);

/** How wide, in mm, a sketch line shows to be picked: enough to hit, narrow enough to leave the faces beside it. */
const kEdgePickWidth = 1.5;

/** A thin extrude's open lines, each a narrow strip on the sketch's plane to pick it by, as the reference's edges are. */
function edgeViews(document: CadDocument, target: CadPart): ViewRegion[] {
  const lines = target.sketch.entities.filter(entity => entity.type === 'line' && !entity.construction);
  const points = new Map(target.sketch.entities.flatMap(entity => (entity.type === 'point' ? [[entity.id, entity] as const] : [])));
  const frame = target.remove ? cadSketchFrame(document, target) : cadFaceFrame(document, target.drawnOn?.on ?? { plane: 'top' });
  if (!frame || 'error' in frame) return [];
  const origin = frame.origin.map((value, axis) => value + frame.normal[axis]! * 0.2) as [number, number, number];
  return lines.flatMap(line => {
    if (line.type !== 'line') return [];
    const a = points.get(line.startId),
      b = points.get(line.endId);
    const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    if (!a || !b || !length) return [];
    const n = { x: (-(b.y - a.y) / length) * (kEdgePickWidth / 2), y: ((b.x - a.x) / length) * (kEdgePickWidth / 2) };
    return [
      {
        id: edgePickId(line.id),
        frame: { origin, x: frame.x, y: frame.y, normal: frame.normal },
        outline: [
          { x: a.x - n.x, y: a.y - n.y },
          { x: b.x - n.x, y: b.y - n.y },
          { x: b.x + n.x, y: b.y + n.y },
          { x: a.x + n.x, y: a.y + n.y },
        ],
        holes: [],
        picked: !!target.thinEdges?.includes(line.id),
      },
    ];
  });
}

export function extrudeRegionViews(document: CadDocument, target: CadPart): ViewRegion[] {
  if (target.thin) return [];
  // Thin of a sketch of open lines picks the lines themselves.
  if (
    target.thinWall &&
    target.sketch.entities.some(entity => entity.type === 'line' && !entity.construction) &&
    !sketchRegions(target.sketch, CAD_CHORD_TOLERANCE).length
  )
    return edgeViews(document, target);
  if (target.remove) {
    const found = removalRegions(document, target);
    if ('error' in found) return [];
    const frame = cadSketchFrame(document, target);
    if (!frame) return [];
    const origin = frame.origin.map((value, axis) => value + frame.normal[axis]! * 0.1) as [number, number, number];
    const picked = target.regions ?? found.cut;
    return found.regions.map(region => ({
      id: region.id,
      frame: { origin, x: frame.x, y: frame.y, normal: frame.normal },
      outline: region.points,
      holes: region.holes,
      picked: picked.includes(region.id),
    }));
  }
  const regions = sketchRegions(target.sketch, CAD_CHORD_TOLERANCE);
  const alsoMade = new Set(document.parts.flatMap(p => (p.extrudedWith === target.id ? (p.regions ?? []) : [])));
  // One region is worth showing too when the sketch as a whole can't be the part, as with a stray line beside it, or
  // when the regions are another extrude's to share.
  const wholeFails = !target.regions && evaluateCadPart(target).diagnostics.some(diagnostic => diagnostic.severity === 'error');
  if (!regions.length || (regions.length < 2 && !target.regions && !wholeFails)) return [];
  const frame = cadFaceFrame(document, target.drawnOn?.on ?? { plane: 'top' });
  if ('error' in frame) return [];
  const along = (target.drawnOn?.offset ?? 0) + (target.drawnOn?.inward ? 0.1 : target.thickness + 0.1);
  const origin = frame.origin.map((value, axis) => value + frame.normal[axis]! * along) as [number, number, number];
  return regions.map(region => ({
    id: region.id,
    frame: { origin, x: frame.x, y: frame.y, normal: frame.normal },
    outline: region.points,
    holes: region.holes,
    picked: !!target.regions?.includes(region.id) || alsoMade.has(region.id),
  }));
}

/**
 * A region picked for an extrude, or taken off it, or off a part it made too, when it's picked again. A part left with
 * none picks none, rather than its whole sketch.
 */
export function withRegionToggled(document: CadDocument, partId: string, regionId: string): CadDocument {
  // A line picked for a thin extrude, or taken off it.
  const line = edgeOf(regionId);
  if (line)
    return {
      ...document,
      parts: document.parts.map(p => {
        if (p.id !== partId) return p;
        const edges = p.thinEdges?.includes(line) ? p.thinEdges.filter(id => id !== line) : [...(p.thinEdges ?? []), line];
        const { thinEdges: _edges, ...rest } = p;
        return edges.length ? { ...rest, thinEdges: edges } : rest;
      }),
    };
  // A region of a part the extrude made too is taken off that part; a part left with none is no longer made.
  const made = document.parts.find(p => p.extrudedWith === partId && p.regions?.includes(regionId));
  if (made) {
    const regions = made.regions!.filter(id => id !== regionId);
    return {
      ...document,
      parts: document.parts.flatMap(p => (p.id !== made.id ? [p] : regions.length ? [{ ...p, regions }] : [])),
    };
  }
  return {
    ...document,
    parts: document.parts.map(p => {
      if (p.id !== partId) return p;
      const removing = p.remove && removalRegions(document, p);
      const current = p.regions ?? (removing && !('error' in removing) ? removing.cut : []);
      // A region picked in takes with it the rest of its circle that an earlier extrude of the sketch used.
      const regions = current.includes(regionId)
        ? current.filter(id => id !== regionId)
        : [...new Set([...current, regionId, ...enclosedUsedRegions(document, p, regionId)])];
      // Its last region unpicked, it picks none rather than all of the sketch; one that made other parts too keeps
      // making them with none of its own, and OK hands its feature to the first.
      return { ...p, regions };
    }),
  };
}
