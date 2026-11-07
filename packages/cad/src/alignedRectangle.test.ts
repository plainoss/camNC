import { expect, it } from 'vitest';
import {
  addAlignedRectangle,
  alignedRectangleFromPoints,
  addConstraint,
  createCadDocument,
  createCadPart,
  evaluateCadDocument,
  parseCadDocument,
  solveCadDocument,
  type CadPointEntity,
} from './index';
it.each([20, -20])('creates a rotated native rectangle with signed height %s and free orientation', async height => {
  const start = { x: 30, y: 40 },
    end = { x: 60, y: 80 },
    through = { x: 60 - height * 0.8, y: 80 + height * 0.6 };
  const shape = alignedRectangleFromPoints(start, end, through)!;
  expect(shape.width).toBeCloseTo(50);
  expect(shape.height).toBeCloseTo(20);
  const part = createCadPart();
  part.sketch = addAlignedRectangle(part.sketch, { start, end, through });
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [part] });
  expect(solved.status).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(5);
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  expect(evaluateCadDocument(solved.document).parts).toHaveLength(1);
  expect(part.sketch.constraints.filter(c => c.type === 'horizontal' || c.type === 'vertical')).toHaveLength(0);
});
it('retains rectangular topology while driving both side lengths', async () => {
  const part = createCadPart();
  part.sketch = addAlignedRectangle(part.sketch, { start: { x: 30, y: 40 }, end: { x: 60, y: 80 }, through: { x: 44, y: 92 } });
  const lines = part.sketch.entities.filter(e => e.type === 'line');
  for (const [line, value] of [
    [lines[0]!, 80],
    [lines[1]!, 30],
  ] as const)
    part.sketch = addConstraint(part.sketch, { type: 'distance', pointAId: line.startId, pointBId: line.endId, value });
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [part] });
  expect(solved.status).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(3);
  const points = new Map(
    solved.document.parts[0]!.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p])
  );
  const vectors = lines.map(l => ({
    x: points.get(l.endId)!.x - points.get(l.startId)!.x,
    y: points.get(l.endId)!.y - points.get(l.startId)!.y,
  }));
  expect(vectors.map(v => Math.round(Math.hypot(v.x, v.y)))).toEqual([80, 30, 80, 30]);
  expect(vectors[0]!.x * vectors[1]!.x + vectors[0]!.y * vectors[1]!.y).toBeCloseTo(0, 5);
  expect(evaluateCadDocument(solved.document).parts).toHaveLength(1);
});
it('rejects zero first edges, collinear extents, and nonfinite values without mutation', () => {
  const sketch = createCadPart().sketch;
  for (const [start, end, through] of [
    [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 3 },
    ],
    [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 6, y: 8 },
    ],
    [
      { x: NaN, y: 0 },
      { x: 3, y: 4 },
      { x: 6, y: 9 },
    ],
  ]) {
    expect(alignedRectangleFromPoints(start!, end!, through!)).toBeNull();
    expect(() => addAlignedRectangle(sketch, { start: start!, end: end!, through: through! })).toThrow();
  }
  expect(sketch.entities).toHaveLength(1);
  const construction = addAlignedRectangle(sketch, {
    start: { x: 10, y: 10 },
    end: { x: 20, y: 20 },
    through: { x: 10, y: 30 },
    construction: true,
  });
  expect(construction.entities.filter(e => e.type === 'line').every(e => e.construction)).toBe(true);
});
