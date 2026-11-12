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

/**
 * The regions an extrude can pick, as the 3D view shows them while it's open: a Remove's on the face it cuts, among
 * those the board's outline closes off too; any other's on the face it ends at, so the part's own body doesn't hide
 * them. None when there's nothing to choose between.
 */
export function extrudeRegionViews(document: CadDocument, target: CadPart): ViewRegion[] {
  if (target.thin) return [];
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
 * none is its whole sketch again.
 */
export function withRegionToggled(document: CadDocument, partId: string, regionId: string): CadDocument {
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
      const regions = current.includes(regionId) ? current.filter(id => id !== regionId) : [...current, regionId];
      if (regions.length || p.sketchOf || p.addTo || p.remove) return { ...p, regions };
      const whole = { ...p };
      delete whole.regions;
      return whole;
    }),
  };
}
