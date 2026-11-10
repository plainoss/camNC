import { differenceD, intersectD, unionD, inflatePathsD, FillRule, JoinType, EndType } from 'clipper2-ts';
import type { PathsD, Pt } from './geom';

// Proof arithmetic needs a finer grid than emitted/source polygons: coarse coincident boundaries
// can produce microscopic reversed contours that no amount of extra machining can remove.
const kQueryPrecision = 6;
export const pocketQueryUnit = (Math.SQRT2 / 2) * 10 ** -kQueryPrecision;
// A JS array has fewer than 2^32 elements. Balanced unions need at most 32 levels;
// target, band and capsule construction keep a boundary below 64 stages. Reserving
// two coordinate-rounding units per stage also covers offset cleanup/Boolean rounding.
export const pocketQueryGuard = 128 * pocketQueryUnit;

export const coverageOffset = (paths: PathsD, delta: number, tolerance: number): PathsD =>
  inflatePathsD(paths, delta, JoinType.Round, EndType.Polygon, 2, kQueryPrecision, tolerance);
export const coverageDifference = (a: PathsD, b: PathsD): PathsD => differenceD(a, b, FillRule.NonZero, kQueryPrecision);
export const coverageIntersection = (a: PathsD, b: PathsD): PathsD => intersectD(a, b, FillRule.NonZero, kQueryPrecision);

export function coverageUnionMany(paths: PathsD): PathsD {
  if (paths.length <= 256) return unionD(paths, [], FillRule.NonZero, kQueryPrecision);
  const middle = paths.length >> 1;
  return unionD(coverageUnionMany(paths.slice(0, middle)), coverageUnionMany(paths.slice(middle)), FillRule.NonZero, kQueryPrecision);
}

/** Round-ended inner capsule on the proof grid; stock's coarser fixed grid guard must not be charged again. */
export function coverageCapsule(from: Pt, to: Pt, radius: number, tolerance: number): PathsD {
  const inner = radius - 2 * pocketQueryUnit;
  return inner > 0 ? inflatePathsD([[from, to]], inner, JoinType.Round, EndType.Round, 2, kQueryPrecision, tolerance) : [];
}
