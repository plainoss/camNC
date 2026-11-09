import { describe, expect, it } from 'vitest';
import {
  addConstraint,
  addRectangle,
  applyNewDimension,
  createCadDocument,
  createCadPart,
  originId,
  scaleSketchForFirstDimension,
  solveCadDocument,
  type CadLineEntity,
  type CadPart,
  type CadPointEntity,
  type CadSketch,
} from './index';

const points = (sketch: CadSketch) => sketch.entities.filter((e): e is CadPointEntity => e.type === 'point');
const lines = (sketch: CadSketch) => sketch.entities.filter((e): e is CadLineEntity => e.type === 'line');
const bounds = (sketch: CadSketch) => {
  const p = points(sketch).filter(p => p.id !== originId(sketch));
  const xs = p.map(q => q.x),
    ys = p.map(q => q.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

/** A rectangle as the corner tool draws it, then a width dimension on its top edge at the drawn size. */
function rectangleWithTopWidth(x: number, y: number, anchoredAtOrigin: boolean) {
  const part = createCadPart();
  let sketch = addRectangle(part.sketch, { x, y, width: 20, height: 10 });
  const [bottom, , top] = lines(sketch);
  if (anchoredAtOrigin) sketch = addConstraint(sketch, { type: 'coincident', pointAId: bottom!.startId, pointBId: originId(sketch) });
  sketch = addConstraint(sketch, {
    id: 'width',
    type: 'distanceX',
    pointAId: top!.endId,
    pointBId: top!.startId,
    value: 20,
    sourceEntityId: top!.id,
  });
  return { ...part, sketch } as CadPart;
}

describe('first dimension sizes the sketch', () => {
  it('scales a rectangle drawn from the origin and solves it, keeping the corner on the origin', async () => {
    const part = rectangleWithTopWidth(0, 0, true);
    const next = applyNewDimension({ ...createCadDocument(), parts: [part] }, 'width', 100);
    const solved = await solveCadDocument(next);
    expect(solved.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const b = bounds(solved.document.parts[0]!.sketch);
    expect(b.minX).toBeCloseTo(0, 6);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxX).toBeCloseTo(100, 6);
    expect(b.maxY).toBeCloseTo(50, 6);
  });

  it('scales a free rectangle about the sketch origin', () => {
    const part = rectangleWithTopWidth(10, 10, false);
    const scaled = scaleSketchForFirstDimension(part.sketch, 'width', 100)!;
    expect(bounds(scaled)).toEqual({ minX: 50, maxX: 150, minY: 50, maxY: 100 });
    expect(points(scaled).find(p => p.id === originId(scaled))).toMatchObject({ x: 0, y: 0 });
  });

  it('leaves the sketch alone once it has a driving dimension', () => {
    const part = rectangleWithTopWidth(0, 0, false);
    const [, right] = lines(part.sketch);
    const sketch = addConstraint(part.sketch, { type: 'distanceY', pointAId: right!.startId, pointBId: right!.endId, value: 10 });
    expect(scaleSketchForFirstDimension(sketch, 'width', 100)).toBeNull();
  });

  it('leaves a driven reference or an unchanged value alone', () => {
    const part = rectangleWithTopWidth(0, 0, false);
    expect(scaleSketchForFirstDimension(part.sketch, 'width', 20)).toBeNull();
    const driven = { ...part.sketch, constraints: part.sketch.constraints.map(c => (c.id === 'width' ? { ...c, driven: true } : c)) };
    expect(scaleSketchForFirstDimension(driven, 'width', 100)).toBeNull();
  });

  it('leaves a sketch tied to a face edge or a fixed point alone', () => {
    const part = rectangleWithTopWidth(0, 0, false);
    const onFace = { ...part.sketch, entities: part.sketch.entities.map((e, i) => (i === 3 ? { ...e, faceEdge: true } : e)) };
    expect(scaleSketchForFirstDimension(onFace, 'width', 100)).toBeNull();
    const fixed = {
      ...part.sketch,
      entities: part.sketch.entities.map(e =>
        e.type === 'point' && e.id !== originId(part.sketch) && e.x === 20 ? { ...e, fixed: true } : e
      ),
    };
    expect(scaleSketchForFirstDimension(fixed, 'width', 100)).toBeNull();
  });
});
