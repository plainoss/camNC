import { describe, expect, it } from 'vitest';
import { addCircle, addLine, addRectangle, createCadDocument, createCadPart } from './document';
import { regionGroups } from './regionProfile';
import { evaluateCadDocument } from './features';
import { evaluateCadPart, polygonArea, CAD_CHORD_TOLERANCE } from './geometry';
import { sketchRegions } from './sketchRegions';

/** A 100 × 50 rectangle split by a line across it at x = 30, with a stray line sticking out. */
function splitSketch() {
  const part = createCadPart('Board', 18);
  let sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 50 });
  sketch = addLine(sketch, { x1: 30, y1: 0, x2: 30, y2: 50 });
  sketch = addLine(sketch, { x1: 100, y1: 25, x2: 140, y2: 25 });
  return { ...part, sketch };
}

describe('a part extruded from picked regions', () => {
  it('is the picked region alone, though the whole sketch couldn’t be a part', () => {
    const part = splitSketch();
    expect(evaluateCadPart(part).diagnostics.some(d => d.severity === 'error')).toBe(true);
    const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
    const wide = regions.find(region => Math.abs(Math.abs(polygonArea(region.points)) - 70 * 50) < 1)!;
    const evaluated = evaluateCadPart({ ...part, regions: [wide.id] });
    expect(evaluated.diagnostics).toEqual([]);
    expect(Math.abs(polygonArea(evaluated.part!.outline))).toBeCloseTo(3500, 3);
    const document = { ...createCadDocument(), parts: [{ ...part, regions: [wide.id] }] };
    expect(evaluateCadDocument(document).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  });

  it('says when a picked region is gone, or none is picked', () => {
    const part = splitSketch();
    expect(evaluateCadPart({ ...part, regions: ['gone'] }).diagnostics[0]!.code).toBe('region-missing');
    expect(evaluateCadPart({ ...part, regions: [] }).diagnostics[0]!.code).toBe('region-count');
  });

  it('is both regions as one, when they’re picked side by side', () => {
    const part = splitSketch();
    const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
    const evaluated = evaluateCadPart({ ...part, regions: regions.map(region => region.id) });
    expect(evaluated.diagnostics).toEqual([]);
    expect(Math.abs(polygonArea(evaluated.part!.outline))).toBeCloseTo(5000, 3);
  });

  it('joins two rectangles drawn side by side, over the edge they share', () => {
    const part = createCadPart('Board', 18);
    let sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 30, height: 50 });
    sketch = addRectangle(sketch, { x: 30, y: 0, width: 70, height: 50 });
    const regions = sketchRegions(sketch, CAD_CHORD_TOLERANCE);
    expect(regions).toHaveLength(2);
    const evaluated = evaluateCadPart({ ...part, sketch, regions: regions.map(region => region.id) });
    expect(evaluated.diagnostics).toEqual([]);
    expect(Math.abs(polygonArea(evaluated.part!.outline))).toBeCloseTo(5000, 3);
  });
});

describe('the holes of a region', () => {
  it('are named by the curves around them, as the whole sketch’s loops are', () => {
    const part = createCadPart('Board', 18);
    let sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 50 });
    sketch = addRectangle(sketch, { x: 20, y: 10, width: 20, height: 20 });
    sketch = addLine(sketch, { x1: 100, y1: 25, x2: 140, y2: 25 });
    const regions = sketchRegions(sketch, CAD_CHORD_TOLERANCE);
    const outer = regions.find(region => region.holes.length === 1)!;
    const island = regions.find(region => region !== outer)!;
    const evaluated = evaluateCadPart({ ...part, sketch, regions: [outer.id] }).part!;
    const hole = evaluated.loops.find(loop => loop.kind === 'hole')!;
    expect([...hole.entityIds].sort()).toEqual([...island.curveIds].sort());
  });
});

describe('regions put together', () => {
  const sketch = (circle: { x: number; radius: number }) => {
    const part = createCadPart('A', 18);
    part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 80, height: 40 });
    part.sketch = addCircle(part.sketch, { x: circle.x, y: 20, radius: circle.radius });
    return part;
  };

  it('makes one part of overlapping shapes, all their regions picked', () => {
    const part = sketch({ x: 80, radius: 20 });
    const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
    expect(regions).toHaveLength(3);
    expect(regionGroups(regions)).toHaveLength(1);
    const made = evaluateCadPart({ ...part, regions: regions.map(region => region.id) });
    expect(made.diagnostics).toEqual([]);
    // The rectangle and the circle's half outside it.
    expect(Math.abs(polygonArea(made.part!.outline))).toBeCloseTo(80 * 40 + (Math.PI * 400) / 2, 0);
  });

  it('keeps outlines apart as groups of their own, and fills an island picked with what’s around it', () => {
    const apart = sketchRegions(sketch({ x: 150, radius: 20 }).sketch, CAD_CHORD_TOLERANCE);
    expect(regionGroups(apart).map(group => group.regionIds.length)).toEqual([1, 1]);
    const island = sketchRegions(sketch({ x: 40, radius: 10 }).sketch, CAD_CHORD_TOLERANCE);
    const [filled] = regionGroups(island);
    expect(filled!.holes).toEqual([]);
    expect(Math.abs(polygonArea(filled!.outline))).toBeCloseTo(3200, 3);
  });

  it('keeps a ring and a region inside its hole apart, each in a group of its own', () => {
    const part = createCadPart('Rings', 18);
    for (const [at, size] of [
      [0, 100],
      [10, 80],
      [30, 40],
    ] as const)
      part.sketch = addRectangle(part.sketch, { x: at, y: at, width: size, height: size });
    const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
    const area = (region: (typeof regions)[number]) =>
      Math.abs(polygonArea(region.points)) - region.holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0);
    const outer = regions.find(region => Math.abs(area(region) - (100 * 100 - 80 * 80)) < 1e-6)!;
    const inner = regions.find(region => Math.abs(area(region) - 40 * 40) < 1e-6)!;
    const groups = regionGroups([outer, inner]);
    expect(groups.map(group => group.regionIds)).toEqual([[outer.id], [inner.id]]);
    expect(groups[0]!.holes).toHaveLength(1);
  });

  it('puts a narrow ring together with the region beside it', () => {
    const part = createCadPart('Frame', 18);
    part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 100 });
    part.sketch = addRectangle(part.sketch, { x: 1, y: 1, width: 98, height: 98 });
    part.sketch = addRectangle(part.sketch, { x: 100, y: 0, width: 50, height: 100 });
    const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
    const ring = regions.find(region => region.holes.length === 1)!;
    const beside = regions.find(region => Math.abs(Math.abs(polygonArea(region.points)) - 5000) < 1e-6)!;
    expect(regionGroups([ring, beside]).map(group => group.regionIds.length)).toEqual([2]);
  });
});
