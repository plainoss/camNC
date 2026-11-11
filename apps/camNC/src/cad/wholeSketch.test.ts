import { addCircle, addRectangle, CAD_CHORD_TOLERANCE, createCadPart, evaluateCadPart, pointInPolygon, sketchRegions } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { wholeSketch } from './editorHelpers';

it('keeps a hole a hole when it picks the solid shapes of a sketch apart', () => {
  const part = createCadPart('Panel', 18);
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 60 });
  part.sketch = addCircle(part.sketch, { x: 50, y: 30, radius: 10 });
  part.sketch = addRectangle(part.sketch, { x: 150, y: 0, width: 20, height: 20 });
  expect(evaluateCadPart(part).part).toBeUndefined();
  const picked = wholeSketch(part).regions!;
  const regions = sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
  expect(regions).toHaveLength(3);
  // The panel with its hole and the square apart, not the circle's disc.
  expect(picked).toHaveLength(2);
  const disc = regions.find(region => !picked.includes(region.id))!;
  expect(pointInPolygon({ x: 50, y: 30 }, disc.points)).toBe(true);
  // One outline, or a Remove, stays the whole sketch.
  const one = createCadPart('Plate', 18);
  one.sketch = addRectangle(one.sketch, { x: 0, y: 0, width: 100, height: 60 });
  expect(wholeSketch({ ...one, regions: [] }).regions).toBeUndefined();
  expect(wholeSketch({ ...part, remove: { depth: 6 } }).regions).toBeUndefined();
});
