import { describe, expect, it } from 'vitest';
import { addCircle, addLine, createCadPart } from './document';
import { dimensionAnnotationAngleWitness, resolveDimensionPlacement, withDimensionPlacement } from './dimensionPlacement';
import { dimensionAngleWitness } from './dimensions';
import type { CadDimension, CadPoint } from './types';

const closePoint = (actual: CadPoint | null, expected: CadPoint) => {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected.x, 7);
  expect(actual!.y).toBeCloseTo(expected.y, 7);
};

describe('bounded annotation placement through large geometry changes', () => {
  it.each([
    { span: 1, label: 30, grown: 100, expected: 129 },
    { span: 0.001, label: 20, grown: 50, expected: 69.999 },
    { span: 1, label: -20, grown: 50, expected: -20 },
  ])('retains a fixed outside-span overshoot for span $span and label $label', ({ span, label, grown, expected }) => {
    const sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: span, y2: 0 });
    const line = sketch.entities.find(entity => entity.type === 'line')!;
    const dimension: CadDimension = { id: 'length', type: 'distanceX', pointAId: line.startId, pointBId: line.endId, value: span };
    const placed = withDimensionPlacement(sketch, dimension, { x: label, y: 10 });
    closePoint(resolveDimensionPlacement(sketch, placed), { x: label, y: 10 });
    const changed = { ...sketch, entities: sketch.entities.map(entity => (entity.id === line.endId ? { ...entity, x: grown } : entity)) };
    closePoint(resolveDimensionPlacement(changed, placed), { x: expected, y: 10 });
  });

  it.each([1, 0.00001])('retains bounded radial gain and a fixed residual for radius %s with a distant manual label', radius => {
    const sketch = addCircle(createCadPart().sketch, { x: 0, y: 0, radius });
    const circle = sketch.entities.find(entity => entity.type === 'circle')!;
    const dimension: CadDimension = { id: 'diameter', type: 'diameter', entityId: circle.id, value: radius * 2 };
    const placed = withDimensionPlacement(sketch, dimension, { x: 30, y: 0 });
    closePoint(resolveDimensionPlacement(sketch, placed), { x: 30, y: 0 });
    const changed = { ...sketch, entities: sketch.entities.map(entity => (entity.id === circle.id ? { ...entity, radius: 50 } : entity)) };
    closePoint(resolveDimensionPlacement(changed, placed), { x: 200 + 30 - 4 * radius, y: 0 });
  });

  it('places an almost-parallel angle without a distant virtual-vertex excursion', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    sketch = addLine(sketch, { x1: 0, y1: 10, x2: 100, y2: 10.001 });
    const [first, second] = sketch.entities.filter(entity => entity.type === 'line');
    const dimension: Extract<CadDimension, { type: 'angle' }> = {
      id: 'angle',
      type: 'angle',
      entityAId: first!.id,
      entityBId: second!.id,
      value: (Math.atan2(0.001, 100) * 180) / Math.PI,
      orientation: 1,
    };
    const placed = withDimensionPlacement(sketch, dimension, { x: 50, y: 20 });
    closePoint(resolveDimensionPlacement(sketch, placed), { x: 50, y: 20 });
    const annotation = dimensionAnnotationAngleWitness(sketch, placed)!;
    closePoint(annotation.center, { x: 50, y: 5.00025 });
    expect(Math.hypot(annotation.center.x - 50, annotation.center.y - 20)).toBeLessThan(20);
    const changed = {
      ...sketch,
      entities: sketch.entities.map(entity => (entity.id === second!.endId ? { ...entity, y: 110 } : entity)),
    };
    closePoint(resolveDimensionPlacement(changed, placed), { x: -10, y: 14.99975 });
    const ordinary = withDimensionPlacement(changed, { ...dimension, value: 45 }, { x: 50, y: 20 });
    const approaching = resolveDimensionPlacement(sketch, ordinary)!;
    expect(Math.hypot(approaching.x, approaching.y)).toBeLessThan(200);
  });

  it('keeps a tiny angle at its nearby shared joint rather than treating the angle value alone as ill-conditioned', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    sketch = addLine(sketch, { x1: 0, y1: 0, x2: 100, y2: 0.001 });
    const [first, second] = sketch.entities.filter(entity => entity.type === 'line');
    const dimension: Extract<CadDimension, { type: 'angle' }> = {
      id: 'tiny-angle',
      type: 'angle',
      entityAId: first!.id,
      entityBId: second!.id,
      value: (Math.atan2(0.001, 100) * 180) / Math.PI,
      orientation: 1,
    };
    const placed = withDimensionPlacement(sketch, dimension, { x: 50, y: 20 });
    expect(placed.labelPlacement?.kind).toBe('angle');
    closePoint(resolveDimensionPlacement(sketch, placed), { x: 50, y: 20 });
    expect(dimensionAnnotationAngleWitness(sketch, dimension)).toEqual(dimensionAngleWitness(sketch, dimension));
  });

  it('preserves ordinary inside-span fractions and ordinary circular scaling', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    const line = sketch.entities.find(entity => entity.type === 'line')!;
    const linear = withDimensionPlacement(
      sketch,
      { id: 'line', type: 'distanceX', pointAId: line.startId, pointBId: line.endId, value: 100 },
      { x: 25, y: 10 }
    );
    const longer = { ...sketch, entities: sketch.entities.map(entity => (entity.id === line.endId ? { ...entity, x: 200 } : entity)) };
    closePoint(resolveDimensionPlacement(longer, linear), { x: 50, y: 10 });
    sketch = addCircle(sketch, { x: 0, y: 40, radius: 10 });
    const circle = sketch.entities.find(entity => entity.type === 'circle')!;
    const radial = withDimensionPlacement(sketch, { id: 'circle', type: 'diameter', entityId: circle.id, value: 20 }, { x: 30, y: 60 });
    const larger = { ...sketch, entities: sketch.entities.map(entity => (entity.id === circle.id ? { ...entity, radius: 20 } : entity)) };
    closePoint(resolveDimensionPlacement(larger, radial), { x: 60, y: 80 });
  });
});
