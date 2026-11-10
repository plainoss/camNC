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
