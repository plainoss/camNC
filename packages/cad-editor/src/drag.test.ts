import {
  addArc,
  addLine,
  addEllipse,
  addConstraint,
  addPoint,
  createCadDocument,
  createCadPart,
  solveCadDocument,
  type CadPointEntity,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { dragTargets } from './drag';

describe('sketch drag intent', () => {
  it('keeps a fixed origin out of pointer targets while allowing the other end of its line to move', () => {
    const sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 30, y2: 10 });
    const line = sketch.entities.find(e => e.type === 'line')!;
    expect(dragTargets(sketch, [line.id], { x: 5, y: 7 })).toEqual([{ pointId: line.endId, x: 35, y: 17 }]);
    expect(dragTargets(sketch, [line.startId], { x: 5, y: 7 })).toEqual([]);
  });

  it('moves a selected endpoint independently and includes all arc parameters in a body translation', () => {
    const sketch = addArc(createCadPart().sketch, { cx: 20, cy: 20, radius: 10, startAngle: 0, endAngle: Math.PI / 2 });
    const arc = sketch.entities.find(e => e.type === 'arc')!;
    expect(dragTargets(sketch, [arc.startId], { x: 3, y: 4 })).toEqual([{ pointId: arc.startId, x: 33, y: 24 }]);
    expect(
      dragTargets(sketch, [arc.id], { x: 3, y: 4 })
        .map(t => t.pointId)
        .sort()
    ).toEqual([arc.centerId, arc.startId, arc.endId].sort());
  });
  it('translates a free ellipse by its center while retaining endpoint resize intent', async () => {
    const part = createCadPart();
    part.sketch = addEllipse(part.sketch, { center: { x: 30, y: 40 }, axis: { x: 30, y: 60 }, through: { x: 20, y: 40 } });
    const curve = part.sketch.entities.find(e => e.type === 'ellipse')!;
    const targets = dragTargets(part.sketch, [curve.centerId], { x: 30, y: 30 });
    expect(targets).toHaveLength(6);
    expect(dragTargets(part.sketch, [curve.majorStartId], { x: 3, y: 4 })).toHaveLength(1);
    const result = await solveCadDocument({ ...createCadDocument(), parts: [part] }, { drag: targets });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    for (const p of part.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point' && e.id !== part.sketch.entities[0]!.id)) {
      const next = result.document.parts[0]!.sketch.entities.find(e => e.id === p.id) as CadPointEntity;
      expect(next.x).toBeCloseTo(p.x + 30, 5);
      expect(next.y).toBeCloseTo(p.y + 30, 5);
    }
    expect(result.document.parts[0]!.sketch.entities.find(e => e.type === 'ellipse')!.radius).toBeCloseTo(curve.radius, 6);
  });
  it('recognizes a coincident ellipse-center alias and leaves a fixed center stationary', () => {
    let sketch = addEllipse(createCadPart().sketch, { center: { x: 30, y: 40 }, axis: { x: 50, y: 40 }, through: { x: 30, y: 50 } });
    const curve = sketch.entities.find(e => e.type === 'ellipse')!;
    sketch = addPoint(sketch, { x: 30, y: 40 });
    const alias = sketch.entities.at(-1)!;
    sketch = addConstraint(sketch, { type: 'coincident', pointAId: curve.centerId, pointBId: alias.id });
    expect(dragTargets(sketch, [alias.id], { x: 1, y: 2 })).toHaveLength(7);
    sketch = { ...sketch, entities: sketch.entities.map(e => (e.id === curve.centerId ? { ...e, fixed: true } : e)) };
    expect(dragTargets(sketch, [curve.centerId], { x: 1, y: 2 })).toEqual([]);
    expect(dragTargets(sketch, [alias.id], { x: 1, y: 2 })).toHaveLength(1);
  });
});
