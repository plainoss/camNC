import { CAD_CHORD_TOLERANCE, polygonArea } from './geometry';
import { sketchRegions } from './sketchRegions';
import type { CadDiagnostic, CadPart, EvaluatedCadPart } from './types';

/**
 * A part extruded from the regions picked in its sketch, as the reference's Extrude takes them: the sketch can hold
 * other lines, crossing or open, and only the picked region is the part. One region makes one part; its islands are
 * holes. A picked region that's gone, as when the lines around it were redrawn, says so.
 */
export function regionProfile(part: CadPart & { regions: string[] }): { part?: EvaluatedCadPart; diagnostics: CadDiagnostic[] } {
  const problem = (code: string, message: string) => ({ diagnostics: [{ code, message, severity: 'error' as const, partId: part.id }] });
  const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
  const picked = regions.filter(region => part.regions.includes(region.id));
  if (picked.length < part.regions.length)
    return problem('region-missing', `A region picked for ${part.name} is no longer in its sketch. Pick its regions again.`);
  if (picked.length !== 1) return problem('region-count', 'Pick one region of the sketch for the part.');
  const region = picked[0]!;
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
