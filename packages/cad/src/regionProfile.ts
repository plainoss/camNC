import { CAD_CHORD_TOLERANCE, pointInPolygon, polygonArea } from './geometry';
import { regionInteriorPoint, sketchRegions } from './sketchRegions';
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

/** The curves with picked regions on both sides: a region's ID lists the side of each curve it lies on. */
function curvesBetween(regions: CadSketchRegion[]): Set<string> {
  const sides = new Map<string, Set<string>>();
  for (const region of regions)
    for (const side of region.id
      .slice(region.id.indexOf(':region:') + ':region:'.length)
      .replace(/#\d+$/, '')
      .split('|')) {
      const curve = side.slice(0, side.lastIndexOf(':'));
      sides.set(curve, (sides.get(curve) ?? new Set()).add(side));
    }
  return new Set([...sides].filter(([, on]) => on.size > 1).map(([id]) => id));
}

/**
 * Regions side by side as one: the region the sketch has where the curves between them are left out. Curves drawn over
 * each other are left out in turn. Regions that don't touch, or whose curves between them also bound others, have none.
 */
export function joinedRegions(sketch: CadSketch, picked: CadSketchRegion[]): CadSketchRegion | null {
  const area = picked.reduce((sum, region) => sum + regionArea(region), 0);
  const inside = picked.map(region => regionInteriorPoint(region.points));
  if (inside.some(point => !point)) return null;
  let entities = sketch.entities,
    current = picked;
  for (let round = 0; round < 8; round++) {
    const between = curvesBetween(current);
    if (!between.size) return null;
    entities = entities.filter(entity => !between.has(entity.id));
    const regions = sketchRegions({ ...sketch, entities }, CAD_CHORD_TOLERANCE);
    // Each picked region is now in the smallest region around a point inside it.
    const holding = inside.map(point =>
      regions
        .filter(region => pointInPolygon(point!, region.points))
        .reduce<CadSketchRegion | null>((best, region) => (!best || regionArea(region) < regionArea(best) ? region : best), null)
    );
    if (holding.some(region => !region)) return null;
    current = [...new Set(holding as CadSketchRegion[])];
    // One region, and nothing more than the picked ones, as the area says.
    if (current.length === 1) return Math.abs(regionArea(current[0]!) - area) < 1e-3 * Math.max(1, area) ? current[0]! : null;
  }
  return null;
}
