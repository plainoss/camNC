import { expect, it } from 'vitest';
import { addRectangle, createCadPart, evaluateCadPart, polygonArea, sketchRegions } from './index';
import { missingRegionProblem } from './regionProfile';

const tray = (wall: { thickness1: number; thickness2: number; midPlane?: true }) => {
  const part = { ...createCadPart('Part 1', 10), drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 50 });
  return { ...part, regions: sketchRegions(part.sketch).map(region => region.id), thinWall: wall };
};
const box = (points: { x: number; y: number }[]) => [
  Math.min(...points.map(p => p.x)),
  Math.min(...points.map(p => p.y)),
  Math.max(...points.map(p => p.x)),
  Math.max(...points.map(p => p.y)),
];

it('makes a ring around the picked shape, Thickness 1 outside its outline', () => {
  const made = evaluateCadPart(tray({ thickness1: 3, thickness2: 0 })).part!;
  expect(box(made.outline).map(v => Math.round(v * 1e6) / 1e6)).toEqual([-3, -3, 103, 53]);
  expect(box(made.holes[0]!)).toEqual([0, 0, 100, 50]);
  expect(Math.abs(polygonArea(made.outline)) - Math.abs(polygonArea(made.holes[0]!))).toBeCloseTo(106 * 56 - 100 * 50, 6);
});

it('puts Thickness 2 inside, and centres Thickness 1 on the outline with Mid plane', () => {
  const both = evaluateCadPart(tray({ thickness1: 2, thickness2: 4 })).part!;
  expect(box(both.holes[0]!).map(v => Math.round(v * 1e6) / 1e6)).toEqual([4, 4, 96, 46]);
  const centred = evaluateCadPart(tray({ thickness1: 4, thickness2: 0, midPlane: true })).part!;
  expect(box(centred.outline).map(v => Math.round(v * 1e6) / 1e6)).toEqual([-2, -2, 102, 52]);
  expect(box(centred.holes[0]!).map(v => Math.round(v * 1e6) / 1e6)).toEqual([2, 2, 98, 48]);
});

it('marks the extrude as missing its shape while a thin one waits for its pick', () => {
  const part = { ...tray({ thickness1: 5, thickness2: 0 }), regions: [] };
  expect(missingRegionProblem(part)).toBe('Select face or sketch region to extrude. 1 missing selection');
});

it('refuses a wall too thick for the shape, rather than folding the hole inside out', () => {
  const made = evaluateCadPart(tray({ thickness1: 0, thickness2: 30 }));
  expect(made.part).toBeUndefined();
  expect(made.diagnostics.map(d => d.code)).toContain('thin-wall');
});
