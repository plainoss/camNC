import { CAD_CHORD_TOLERANCE } from './geometry';
import { sketchRegions } from './sketchRegions';
import type { CadDocument, CadSketch } from './types';

/** Replace a filleted profile and retain the regions used by its extrudes and cuts in the same edit. */
export function replaceFilletedSketch(document: CadDocument, sketch: CadSketch, arcIds: readonly string[]): CadDocument {
  const source = document.parts.find(part => part.sketch.id === sketch.id)?.sketch;
  if (!source) return document;
  const before = sketchRegions(source, CAD_CHORD_TOLERANCE);
  const after = sketchRegions(sketch, CAD_CHORD_TOLERANCE);
  const inserted = new Set(arcIds);
  const lineage = (ids: string[]) => JSON.stringify(ids.filter(id => !inserted.has(id)).sort());
  const mapping = new Map<string, string>();
  for (const region of before) {
    if (after.some(candidate => candidate.id === region.id)) continue;
    // A fillet retains its incident lines and only inserts arcs. Require a unique boundary lineage;
    // a point sample can fall in a different face or in material removed by a large fillet.
    const matches = after.filter(candidate => lineage(candidate.curveIds) === lineage(region.curveIds));
    if (before.filter(candidate => lineage(candidate.curveIds) === lineage(region.curveIds)).length !== 1) continue;
    if (matches.length === 1) mapping.set(region.id, matches[0]!.id);
  }
  const remap = (id: string) => mapping.get(id) ?? id;
  return {
    ...document,
    parts: document.parts.map(part => ({
      ...part,
      ...(part.sketch.id === sketch.id && {
        sketch,
        ...(part.regions && { regions: part.regions.map(remap) }),
        ...(part.addedRegions && { addedRegions: part.addedRegions.map(remap) }),
      }),
      ...(part.features && {
        features: part.features.map(feature =>
          feature.type === 'cut' && feature.sketchId === sketch.id ? { ...feature, regionId: remap(feature.regionId) } : feature
        ),
      }),
    })),
  };
}
