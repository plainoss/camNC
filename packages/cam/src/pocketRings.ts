import { simplifyPathsD } from 'clipper2-ts';
import { geometryTolerances } from './accuracy';
import { offset, type PathsD } from './geom';
import { offsetToleranceFor } from './passPlanning';
import type { CamSettings } from './toolpathTypes';
import { CamInputError } from './validation';

/** Outside-in roughing rings, retaining the established smoothing and central-remainder policy. */
export function createPocketRings(
  region: PathsD,
  radius: number,
  allowance: number,
  settings: CamSettings,
  spacing: number,
  stopRadius = radius
): PathsD[] {
  const offsetPaths = (paths: PathsD, delta: number) => offset(paths, delta, offsetToleranceFor(settings));
  const rings: PathsD[] = [];
  const corner = settings.innerCornerRadius;
  const smoothing = geometryTolerances(settings.geometryTolerance, settings.sourceTolerance).opening;
  let inset = radius + allowance;
  for (let cur = offsetPaths(region, -inset); cur.length; ) {
    if (rings.length >= 10_000)
      throw new CamInputError([{ field: 'stepoverFactor', message: 'would require more than 10000 pocket rings' }]);
    // Inner rings are opened to round their corners; the wall ring keeps its shape.
    const rounded =
      rings.length && corner > 0 ? simplifyPathsD(offset(offset(cur, -corner, smoothing), corner, smoothing), smoothing, true) : cur;
    rings.push(rounded.length ? rounded : cur);
    // A nominal-radius stop can leave a central strip when the boundary sweeps need uncertainty reserved.
    if (!offsetPaths(cur, -stopRadius).length) break;
    const next = offsetPaths(region, -inset - spacing);
    // Retain the closer ring when a central strip is wider than the cutter but narrower than two stepovers.
    inset += next.length ? spacing : spacing / 2;
    cur = next.length ? next : offsetPaths(region, -inset);
  }
  return rings;
}
