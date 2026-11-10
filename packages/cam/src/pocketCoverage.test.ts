import { expect, it } from 'vitest';
import type { PathD } from './geom';
import { pocketRingsCoverFloor, pocketRowsCoverFloor } from './pocketCoverage';
import { DEFAULT_SETTINGS } from './toolpaths';

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
  expect(
    pocketRowsCoverFloor(
      region,
      lines.filter((_, index) => index < 8 || index > 9),
      6,
      DEFAULT_SETTINGS,
      region
    )
  ).toBe(false);
});
