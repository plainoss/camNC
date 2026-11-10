import { geometryTolerances, planAccuracy } from './accuracy';
import type { PathsD } from './geom';
import {
  coverageDifference as difference,
  coverageIntersection as intersect,
  coverageOffset as offset,
  coverageUnionMany as unionMany,
  coverageCapsule,
  pocketQueryGuard,
} from './pocketCoverageQuery';
import type { CamSettings } from './toolpathTypes';

/** Cutter radius remaining after the same full-path uncertainty used to certify the floor sweep. */
export function pocketCoverageRadius(diameter: number, settings: CamSettings): number {
  const budget = planAccuracy(settings.geometryTolerance, settings.sourceTolerance).budget;
  const tolerance = geometryTolerances(settings.geometryTolerance, settings.sourceTolerance).offset;
  const deviation = budget.fitting + budget.outputRounding + budget.controllerRounding;
  // Shrink the proved sweep for fitting, polygon/offset quantization and the capsule approximation.
  return diameter / 2 - budget.import - deviation - budget.polygonRounding - 2 * tolerance - pocketQueryGuard;
}

function coverageScope(region: PathsD, diameter: number, settings: CamSettings, material?: PathsD) {
  const budget = planAccuracy(settings.geometryTolerance, settings.sourceTolerance).budget;
  // At most six target/band offset or capsule chord approximations affect comparison.
  // This third-sized query tolerance therefore fits within the unchanged two-source-offset reserve above.
  const tolerance = geometryTolerances(settings.geometryTolerance, settings.sourceTolerance).offset / 3;
  const guaranteedRadius = pocketCoverageRadius(diameter, settings);
  // Every nominal reachable point must be within the unchanged total tolerance of
  // the conservative physical sweep. Dilating that sweep by total is a distance
  // bound; eroding the target is not equivalent at cusps between retained islands.
  const radius = guaranteedRadius > 0 ? guaranteedRadius + budget.total : guaranteedRadius;
  const reachable = offset(offset(region, -diameter / 2, tolerance), diameter / 2, tolerance);
  const target = material ? intersect(reachable, material) : reachable;
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
  const bands = rings.map(ring => difference(offset(ring, radius, tolerance), offset(ring, -radius, tolerance)));
  return difference(target, unionMany(bands)).length === 0;
}

export function pocketRowsCoverFloor(region: PathsD, lines: PathsD, diameter: number, settings: CamSettings, material: PathsD): boolean {
  const { radius, target, tolerance } = coverageScope(region, diameter, settings, material);
  if (radius <= 0) return false;
  const capsules = lines.flatMap(line => line.slice(1).map((point, index) => coverageCapsule(line[index]!, point, radius, tolerance)));
  return difference(target, unionMany(capsules)).length === 0;
}
