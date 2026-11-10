import { expect, it } from 'vitest';
import { distPointSeg, type PathD } from './geom';
import { pocketCoverageRadius, pocketRingsCoverFloor, pocketRowsCoverFloor } from './pocketCoverage';
import { DEFAULT_SETTINGS } from './toolpaths';
import { planAccuracy } from './accuracy';

const rect = (inset: number): PathD => [
  { x: inset, y: inset },
  { x: 60 - inset, y: inset },
  { x: 60 - inset, y: 40 - inset },
  { x: inset, y: 40 - inset },
];
const region = [rect(0)];

it('requires the actual closed paths to cover the reachable floor, including the central remainder', () => {
  const rings = Array.from({ length: 9 }, (_, index) => [rect(3 + index * 2)]);
  expect(pocketRingsCoverFloor(region, rings, 6, DEFAULT_SETTINGS)).toBe(true);
  expect(pocketRingsCoverFloor(region, [], 6, DEFAULT_SETTINGS)).toBe(false);
  expect(pocketRingsCoverFloor(region, rings.slice(0, 2), 6, DEFAULT_SETTINGS)).toBe(false);
});

it('requires open rows to cover the floor rather than trusting their nominal spacing', () => {
  // These open rows extend into removable exterior waste; clipped row ends alone leave scallops at the material edge.
  const lines = Array.from({ length: 18 }, (_, index) => [
    { x: -3, y: 3 + index * 2 },
    { x: 63, y: 3 + index * 2 },
  ]);
  expect(pocketRowsCoverFloor(region, lines, 6, DEFAULT_SETTINGS, region)).toBe(true);
  // A 6 mm centerline separation leaves only the reserved uncertainty between
  // conservative D6 sweeps, within the unchanged 0.05 mm total distance budget.
  const touching = lines.filter((_, index) => index < 8 || index > 9);
  const total = planAccuracy(DEFAULT_SETTINGS.geometryTolerance).budget.total;
  const touchingDistance = Math.min(...touching.map(([a, b]) => distPointSeg(30, 20, a.x, a.y, b.x, b.y)));
  expect(touchingDistance).toBe(3);
  expect(touchingDistance - pocketCoverageRadius(6, DEFAULT_SETTINGS)).toBeLessThanOrEqual(total);
  expect(pocketRowsCoverFloor(region, touching, 6, DEFAULT_SETTINGS, region)).toBe(true);
  const missing = lines.filter((_, index) => index < 8 || index > 10);
  const centerDistance = Math.min(...missing.map(([a, b]) => distPointSeg(30, 21, a.x, a.y, b.x, b.y)));
  // Three removed rows leave an actual 1 mm nominal floor gap, well beyond total.
  expect(centerDistance - 3).toBe(1);
  expect(centerDistance - pocketCoverageRadius(6, DEFAULT_SETTINGS)).toBeGreaterThan(total);
  expect(pocketRowsCoverFloor(region, missing, 6, DEFAULT_SETTINGS, region)).toBe(false);
});
