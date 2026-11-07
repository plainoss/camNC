import { expect, it } from 'vitest';
import {
  addThreePointCircle,
  circleThroughThreePoints,
  createCadDocument,
  createCadPart,
  evaluateCadDocument,
  parseCadDocument,
  solveCadDocument,
} from './index';

it.each([false, true])('fits three rim points in either winding (%s), including large translations', reverse => {
  const points = [
    { x: 1e9 + 3, y: 1e9 },
    { x: 1e9, y: 1e9 + 3 },
    { x: 1e9 - 3, y: 1e9 },
  ];
  if (reverse) points.reverse();
  expect(circleThroughThreePoints(points[0]!, points[1]!, points[2]!)).toEqual({ x: 1e9, y: 1e9, radius: 3 });
});
it('rejects duplicate, collinear, nearly collinear and nonfinite points without changing source', () => {
  const sketch = createCadPart().sketch;
  for (const third of [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 1e-9 },
    { x: NaN, y: 2 },
  ]) {
    expect(circleThroughThreePoints({ x: 0, y: 0 }, { x: 10, y: 0 }, third)).toBeNull();
    expect(() => addThreePointCircle(sketch, { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, third] })).toThrow();
  }
  expect(sketch.entities).toHaveLength(1);
});
it('keeps native circle freedom, construction state, persistence and closed-profile output', async () => {
  const part = createCadPart();
  const points = [
    { x: 30, y: 20 },
    { x: 20, y: 30 },
    { x: 10, y: 20 },
  ] as const;
  part.sketch = addThreePointCircle(part.sketch, { points });
  const doc = { ...createCadDocument(), parts: [part] };
  const solved = await solveCadDocument(doc);
  expect(solved.status).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(3);
  expect(solved.document.parts[0]!.sketch.entities.find(e => e.type === 'circle')!.radius).toBeCloseTo(10);
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  expect(evaluateCadDocument(solved.document).parts).toHaveLength(1);
  expect(addThreePointCircle(createCadPart().sketch, { points, construction: true }).entities.at(-1)!.construction).toBe(true);
});
