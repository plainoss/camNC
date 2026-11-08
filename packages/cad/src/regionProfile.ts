import { CAD_CHORD_TOLERANCE } from './geometry';
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
        ...region.holes.map((points, index) => ({ id: `${part.id}:profile:hole${index}`, entityIds: [], points, kind: 'hole' as const })),
      ],
    },
    diagnostics: [],
  };
}
