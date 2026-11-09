import { CAD_CHORD_TOLERANCE, polygonArea } from './geometry';
import { sketchRegions } from './sketchRegions';
import type { CadSketchRegion } from './sketchRegions';
import type { CadDiagnostic, CadPart, CadSketch, EvaluatedCadPart } from './types';

/**
 * A part extruded from the regions picked in its sketch, as the reference's Extrude takes them: the sketch can hold
 * other lines, crossing or open, and only the picked regions are the part, with those Extrude → Add steps join to it.
 * Regions side by side make one part; their islands are holes. Nothing picked, regions that don't touch, or a region
 * that's gone, as when the lines around it were redrawn, say so.
 */
export function regionProfile(part: CadPart & { regions: string[] }): { part?: EvaluatedCadPart; diagnostics: CadDiagnostic[] } {
  const problem = (code: string, message: string) => ({ diagnostics: [{ code, message, severity: 'error' as const, partId: part.id }] });
  const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
  const wanted = [...new Set([...part.regions, ...(part.addedRegions ?? [])])];
  if (!wanted.length) return problem('region-count', 'Pick the regions of the sketch to extrude in the view.');
  const picked = regions.filter(region => wanted.includes(region.id));
  if (picked.length < wanted.length)
    return problem('region-missing', `A region picked for ${part.name} is no longer in its sketch. Pick its regions again.`);
  const region = picked.length === 1 ? picked[0]! : joinedRegions(part.sketch, picked);
  if (!region) return problem('region-count', 'The picked regions don’t touch. Extrude each into a part of its own.');
  // Each island is another region's outline: its curves name the hole, as a whole sketch's loops do, so a pocket set on
  // that loop still finds it.
  const box = (points: { x: number; y: number }[]) =>
    [
      Math.min(...points.map(p => p.x)),
      Math.min(...points.map(p => p.y)),
      Math.max(...points.map(p => p.x)),
      Math.max(...points.map(p => p.y)),
    ]
      .map(value => Math.round(value * 1000))
      .join();
  const holeCurves = (hole: { x: number; y: number }[]) =>
    regions.find(
      candidate =>
        candidate !== region &&
        box(candidate.points) === box(hole) &&
        Math.abs(Math.abs(polygonArea(candidate.points)) - Math.abs(polygonArea(hole))) < 1e-3
    )?.curveIds ?? [];
  return {
    part: {
      partId: part.id,
      name: part.name,
      thickness: part.thickness,
      outline: region.points,
      holes: region.holes,
      loops: [
        {
          id: `${part.id}:profile:${[...region.curveIds].sort().join(':')}`,
          entityIds: region.curveIds,
          points: region.points,
          kind: 'outer',
        },
        ...region.holes.map((points, index) => {
          const entityIds = holeCurves(points);
          return {
            id: entityIds.length ? `${part.id}:profile:${[...entityIds].sort().join(':')}` : `${part.id}:profile:hole${index}`,
            entityIds,
            points,
            kind: 'hole' as const,
          };
        }),
      ],
    },
    diagnostics: [],
  };
}

const regionArea = (region: Pick<CadSketchRegion, 'points' | 'holes'>) =>
  Math.abs(polygonArea(region.points)) - region.holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0);

/**
 * Regions side by side as one: the region the sketch has where the curves between them are left out. Regions that
 * don't touch, or whose curves between them also bound others, have none.
 */
export function joinedRegions(sketch: CadSketch, picked: CadSketchRegion[]): CadSketchRegion | null {
  // A region's ID lists the side of each curve it lies on: a curve with picked regions on both sides is between them.
  const sides = new Map<string, Set<string>>();
  for (const region of picked)
    for (const side of region.id
      .slice(region.id.indexOf(':region:') + ':region:'.length)
      .replace(/#\d+$/, '')
      .split('|')) {
      const curve = side.slice(0, side.lastIndexOf(':'));
      sides.set(curve, (sides.get(curve) ?? new Set()).add(side));
    }
  const between = new Set([...sides].filter(([, on]) => on.size > 1).map(([id]) => id));
  if (!between.size) return null;
  const joined = sketchRegions({ ...sketch, entities: sketch.entities.filter(entity => !between.has(entity.id)) }, CAD_CHORD_TOLERANCE);
  const area = picked.reduce((sum, region) => sum + regionArea(region), 0);
  const match = joined.find(candidate => Math.abs(regionArea(candidate) - area) < 1e-3 * Math.max(1, area));
  // Every picked region lies in it, and nothing else does, as the area says.
  return match && picked.every(region => region.curveIds.some(id => !between.has(id) && match.curveIds.includes(id))) ? match : null;
}
