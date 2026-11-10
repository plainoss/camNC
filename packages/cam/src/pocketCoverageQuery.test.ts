import { expect, it } from 'vitest';
import { machiningPart, rectangle } from '../test/machining-fixtures';
import { geometryTolerances, planAccuracy } from './accuracy';
import { openPocketRegion } from './features';
import { pocketRingsCoverFloor } from './pocketCoverage';
import { createPocketRings } from './pocketRings';
import { pocketRingSpacing } from './pocketSpacing';
import { camPart, DEFAULT_SETTINGS } from './toolpaths';
import { toGcode } from './gcode';
import { postedFloorDistance } from '../test/postedFloorDistance';
import { coverageDifference, coverageUnionMany } from './pocketCoverageQuery';
import cuspRegion from '../test/pocketFloorCusp.json';

it('bounds distance to the complete reachable floor at retained-sliver cusps without endless refinement', () => {
  // Exact supplied region captured from cad-script's report-holes fixture; tiny retained
  // source contours remain intact. Target erosion incorrectly left fixed cusp residuals.
  const settings = { ...DEFAULT_SETTINGS };
  const diameter = 3.175;
  const rings = createPocketRings(cuspRegion, diameter / 2, 0, settings, pocketRingSpacing(settings, diameter));
  const before = structuredClone({ cuspRegion, rings });
  expect(rings).toHaveLength(7);
  expect(pocketRingsCoverFloor(cuspRegion, rings, diameter, settings)).toBe(true);
  expect({ cuspRegion, rings }).toEqual(before);
  // A genuine missing interior sweep still exceeds the same total distance budget.
  expect(pocketRingsCoverFloor(cuspRegion, rings.slice(0, 1), diameter, settings)).toBe(false);
});

it('preserves a ring hole when its signed contours straddle a union chunk boundary', () => {
  const fillers = Array.from({ length: 255 }, (_, i) => rectangle(100 + i * 3, 0, 101 + i * 3, 1));
  const outer = rectangle(0, 0, 20, 20);
  const hole = rectangle(5, 5, 15, 15).reverse();
  const groups = [...fillers.slice(0, 127).map(path => [path]), [outer, hole], ...fillers.slice(127).map(path => [path])];
  const union = coverageUnionMany(groups);
  expect(coverageDifference([rectangle(7, 7, 13, 13)], union)).toHaveLength(1);
  expect(coverageDifference([rectangle(1, 1, 4, 4)], union)).toHaveLength(0);
});

it('unions overlapping complete ring groups without filling their remaining holes', () => {
  const fillers = Array.from({ length: 511 }, (_, i) => [rectangle(100 + i * 3, 0, 101 + i * 3, 1)]);
  const ring = [rectangle(0, 0, 20, 20), rectangle(5, 5, 15, 15).reverse()];
  const overlap = [rectangle(10, 10, 25, 25), rectangle(17, 17, 23, 23).reverse()];
  const union = coverageUnionMany([...fillers.slice(0, 255), ring, overlap, ...fillers.slice(255)]);
  expect(coverageDifference([rectangle(6, 6, 9, 9)], union)).toHaveLength(1);
  expect(coverageDifference([rectangle(11, 11, 14, 14)], union)).toHaveLength(0);
  expect(coverageDifference([rectangle(18, 18, 19, 19)], union)).toHaveLength(0);
  expect(coverageDifference([rectangle(21, 21, 22, 22)], union)).toHaveLength(1);
});

it('proves the existing tight-tolerance small-island layout without inventing boundary residuals', () => {
  const settings = { ...DEFAULT_SETTINGS, geometryTolerance: 0.01 };
  const features = machiningPart([[rectangle(20, 20, 70, 50), rectangle(44.7, 34.7, 45.3, 35.3).reverse()]], 10.5);
  const diameter = 3.175;
  const region = openPocketRegion(
    features.outlines,
    features.pockets[0]!,
    diameter / 2 + 1,
    geometryTolerances(settings.geometryTolerance)
  );
  const rings = createPocketRings(region, diameter / 2, 0, settings, pocketRingSpacing(settings, diameter));
  const before = structuredClone({ region, rings });
  // Coarse query arithmetic previously returned four isolated negative-area contours here and triggered repeated refinement.
  expect(pocketRingsCoverFloor(region, rings, diameter, settings, features.outlines)).toBe(true);
  expect({ region, rings }).toEqual(before);
});

it.each([0.007, 0.01, 0.05])('keeps actual posted coverage and retained islands within a %s mm total budget', geometryTolerance => {
  const budget = planAccuracy(geometryTolerance).budget;
  // Leave only 0.0014 mm for offset/smoothing/fitting in the declared-source variants: a valid near-minimum allocation.
  const declared = geometryTolerance - budget.outputRounding - budget.controllerRounding - budget.polygonRounding - 0.0014;
  for (const diameter of [3.175, 6])
    for (const sourceTolerance of [0, declared]) {
      const features = machiningPart([[rectangle(20, 20, 70, 50), rectangle(44.7, 34.7, 45.3, 35.3).reverse()]], 10.5);
      const before = structuredClone(features);
      const plan = camPart(features, {
        cutThrough: false,
        geometryTolerance,
        sourceTolerance,
        maxStepdown: 1.5,
        tools: [{ number: 1, diameter }],
      });
      expect(features).toEqual(before);
      const radius = diameter / 2;
      for (const arcs of [false, true]) {
        const distance = postedFloorDistance(toGcode(plan, { arcs }), 10.5);
        for (const [x, y] of [
          [25, 25],
          [65, 25],
          [25, 45],
          [65, 45],
          [45 - radius - 1, 35],
          [45 + radius + 1, 35],
          [45, 35 - radius - 1],
          [45, 35 + radius + 1],
        ])
          expect(distance(x!, y!), `floor at ${x},${y}; D${diameter}; source ${sourceTolerance}; arcs ${arcs}`).toBeLessThanOrEqual(
            radius + geometryTolerance
          );
        expect(distance(45, 35)).toBeGreaterThanOrEqual(radius + 0.2);
      }
      const settings = { ...DEFAULT_SETTINGS, geometryTolerance, sourceTolerance };
      const region = openPocketRegion(
        features.outlines,
        features.pockets[0]!,
        radius + 1,
        geometryTolerances(geometryTolerance, sourceTolerance)
      );
      const wallOnly = createPocketRings(region, radius, 0, settings, 100);
      expect(pocketRingsCoverFloor(region, wallOnly.slice(0, 1), diameter, settings, features.outlines)).toBe(false);
    }
});
