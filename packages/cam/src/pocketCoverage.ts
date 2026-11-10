import { geometryTolerances, planAccuracy } from './accuracy';
import { difference, intersect, offset, unionMany, type PathsD } from './geom';
import { sweptCapsule } from './stock';
import type { CamSettings } from './toolpathTypes';

function coverageScope(region: PathsD, diameter: number, settings: CamSettings, material?: PathsD) {
  const budget = planAccuracy(settings.geometryTolerance, settings.sourceTolerance).budget;
  const tolerance = geometryTolerances(settings.geometryTolerance, settings.sourceTolerance).offset;
  const deviation = budget.fitting + budget.outputRounding + budget.controllerRounding;
  // Shrink the proved sweep for fitting, polygon/offset quantization and the capsule approximation.
  const radius = diameter / 2 - deviation - budget.polygonRounding - 2 * tolerance - 0.001;
  const reachable = offset(offset(region, -diameter / 2, tolerance), diameter / 2, tolerance);
  // Boundary error remains bounded by the unchanged job tolerance; inaccessible sharp corners are not invented stock coverage.
  const target = offset(material ? intersect(reachable, material) : reachable, -budget.total, tolerance);
  return { radius, target, tolerance };
}

/** Check actual rounded ring geometry, not only nominal spacing between parallel offsets. */
export function pocketRingsCoverFloor(
  region: PathsD,
  rings: PathsD[],
  diameter: number,
  settings: CamSettings,
  material?: PathsD
): boolean {
  const { radius, target, tolerance } = coverageScope(region, diameter, settings, material);
  if (radius <= 0) return false;
  const bands = rings.flatMap(ring => difference(offset(ring, radius, tolerance), offset(ring, -radius, tolerance)));
  return difference(target, unionMany(bands)).length === 0;
}

export function pocketRowsCoverFloor(region: PathsD, lines: PathsD, diameter: number, settings: CamSettings, material: PathsD): boolean {
  const { radius, target, tolerance } = coverageScope(region, diameter, settings, material);
  if (radius <= 0) return false;
  const capsules = lines.flatMap(line =>
    line.slice(1).map((point, index) => sweptCapsule(line[index]!, point, radius, tolerance, 'inner'))
  );
  return difference(target, unionMany(capsules)).length === 0;
}
