import { describe, expect, it } from 'vitest';
import { addLine, addRectangle, createCadDocument, createCadPart } from './document';
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
