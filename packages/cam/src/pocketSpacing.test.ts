import { expect, it } from 'vitest';
import { readGcode } from './analyze';
import { distPointSeg, type PathD } from './geom';
import { toGcode } from './gcode';
import { finalizePlan } from './finalizePlan';
import { pocketRingSpacing } from './pocketSpacing';
import { DEFAULT_SETTINGS, pocketOperation } from './toolpaths';
import { planAccuracy } from './accuracy';

const circle = (radius: number): PathD =>
  Array.from({ length: 96 }, (_, i) => ({
    x: 30 + radius * Math.cos((2 * Math.PI * i) / 96),
    y: 30 + radius * Math.sin((2 * Math.PI * i) / 96),
  }));

it.each([
  { factor: 0.86, corner: 0, point: [6.02, 6.02] },
  { factor: 0.85, corner: 0.3, point: [6.02, 6.02] },
  { factor: 0.99, corner: 0.3, point: [12.7, 12.7] },
])('preserves diagonal corner coverage at stepover $factor with corner radius $corner', ({ factor, corner, point }) => {
  const settings = { ...DEFAULT_SETTINGS, stepoverFactor: factor, maxStepdown: 3, innerCornerRadius: corner };
  const region = [
    [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 40 },
      { x: 0, y: 40 },
    ],
  ];
  const operation = pocketOperation('Corner coverage', region, 6, 3, { number: 1, diameter: 6 }, settings);
  const job = finalizePlan({ stockTop: 6, operations: [operation], warnings: [] }, settings);
  for (const arcs of [false, true]) {
    const moves = readGcode(toGcode(job, { arcs })).filter(move => !move.rapid && move.from[2] === 3 && move.to[2] === 3);
    expect(
      Math.min(...moves.map(move => distPointSeg(point[0]!, point[1]!, move.from[0], move.from[1], move.to[0], move.to[1])))
    ).toBeLessThanOrEqual(3);
  }
});

it('preserves a very small positive coverage margin and rejects an uncertainty wider than the cutter', () => {
  const budget = planAccuracy().budget;
  const uncertainty = budget.fitting + budget.outputRounding + budget.controllerRounding;
  const diameter = 2 * uncertainty + 0.0005;
  const spacing = pocketRingSpacing(DEFAULT_SETTINGS, diameter);
  expect(spacing).toBeGreaterThan(0);
  expect(spacing + 2 * uncertainty).toBeLessThan(diameter);
  expect(() => pocketRingSpacing(DEFAULT_SETTINGS, 2 * uncertainty)).toThrow(/coverage margin/);
});

it.each([0.4, 0.99, 1])('retains whole-path floor coverage around an island at stepover %s with arcs on and off', stepoverFactor => {
  const settings = { ...DEFAULT_SETTINGS, stepoverFactor, maxStepdown: 3, innerCornerRadius: 0 };
  const region = [circle(25), circle(5).reverse()];
  const operation = pocketOperation('Annular floor', region, 6, 3, { number: 1, diameter: 6 }, settings);
  const job = finalizePlan({ stockTop: 6, operations: [operation], warnings: [] }, settings);
  const budget = job.accuracy.budget;
  const fullDeviation = budget.fitting + budget.outputRounding + budget.controllerRounding;
  // Endpoint pinning cannot excuse a gap between fitted ring interiors at a full-diameter stepover.
  expect(pocketRingSpacing(settings, 6) + 2 * fullDeviation).toBeLessThan(6);
  for (const arcs of [false, true]) {
    const moves = readGcode(toGcode(job, { arcs })).filter(move => !move.rapid && move.from[2] === 3 && move.to[2] === 3);
    for (let radius = 5.2; radius <= 24.5; radius += 0.5) {
      for (let angle = 0; angle < 360; angle += 5) {
        const x = 30 + radius * Math.cos((angle * Math.PI) / 180),
          y = 30 + radius * Math.sin((angle * Math.PI) / 180);
        const distance = Math.min(...moves.map(move => distPointSeg(x, y, move.from[0], move.from[1], move.to[0], move.to[1])));
        expect(distance, `uncut floor at r=${radius}, angle=${angle}, arcs=${arcs}`).toBeLessThanOrEqual(3.01);
      }
    }
    for (let angle = 0; angle < 360; angle += 10) {
      const x = 30 + 4.9 * Math.cos((angle * Math.PI) / 180),
        y = 30 + 4.9 * Math.sin((angle * Math.PI) / 180);
      expect(Math.min(...moves.map(move => distPointSeg(x, y, move.from[0], move.from[1], move.to[0], move.to[1])))).toBeGreaterThan(3);
    }
  }
});
