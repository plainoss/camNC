import { describe, expect, it } from 'vitest';
import {
  addEllipse,
  addConstraint,
  createCadDocument,
  createCadPart,
  evaluateCadDocument,
  evaluateCurvePoint,
  parseCadDocument,
  removeEntity,
  solveCadDocument,
  tessellateCurve,
  type CadPointEntity,
} from './index';

const fixture = (secondary = 10, angle = 0) => {
  const c = { x: 30, y: 40 },
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const part = createCadPart();
  part.sketch = addEllipse(part.sketch, {
    center: c,
    axis: { x: c.x + 20 * cos, y: c.y + 20 * sin },
    through: { x: c.x - secondary * sin, y: c.y + secondary * cos },
  });
  return { ...createCadDocument(), parts: [part] };
};
describe('native editable ellipses', () => {
  it.each([10, 30, 20])('solves a closed ellipse with second radius %s and exports a profile', async secondary => {
    const doc = fixture(secondary, 0.4);
    const solved = await solveCadDocument(doc);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(5);
    const evaluation = evaluateCadDocument(solved.document);
    expect(evaluation.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    expect(evaluation.parts).toHaveLength(1);
    const sketch = solved.document.parts[0]!.sketch;
    const ellipse = sketch.entities.find(e => e.type === 'ellipse')!;
    const points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
    const path = tessellateCurve(ellipse, points);
    expect(path.length).toBeGreaterThan(20);
    expect(path[0]!.x).toBeCloseTo(path.at(-1)!.x, 8);
    expect(path[0]!.y).toBeCloseTo(path.at(-1)!.y, 8);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
    expect(removeEntity(sketch, ellipse.id).entities).toHaveLength(1);
  });
  it('keeps two diameter dimensions and the center through solving and dragging', async () => {
    const doc = fixture();
    const part = doc.parts[0]!;
    const ellipse = part.sketch.entities.find(e => e.type === 'ellipse')!;
    part.sketch = addConstraint(part.sketch, { type: 'distance', pointAId: ellipse.majorStartId, pointBId: ellipse.majorEndId, value: 50 });
    part.sketch = addConstraint(part.sketch, { type: 'distance', pointAId: ellipse.minorStartId, pointBId: ellipse.minorEndId, value: 16 });
    const solved = await solveCadDocument(doc);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(3);
    const moved = await solveCadDocument(solved.document, { drag: { pointId: ellipse.centerId, x: 60, y: 70 } });
    expect(moved.status, JSON.stringify(moved.diagnostics)).toBe('solved');
    const sketch = moved.document.parts[0]!.sketch;
    const curve = sketch.entities.find(e => e.type === 'ellipse')!;
    expect(curve.radius).toBeCloseTo(8, 5);
    const points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
    expect(points.get(curve.centerId)!.x).toBeCloseTo(60, 5);
    expect(Math.hypot(evaluateCurvePoint(curve, points, 0).x - 60, evaluateCurvePoint(curve, points, 0).y - 70)).toBeCloseTo(25, 5);
  });
  it('retains a fully fixed ellipse without reporting a conflict', async () => {
    const doc = fixture();
    const part = doc.parts[0]!;
    part.sketch.entities = part.sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e));
    const solved = await solveCadDocument(doc);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(0);
  });
  it('solves a point constrained onto the exact ellipse', async () => {
    const doc = fixture();
    const part = doc.parts[0]!;
    const ellipse = part.sketch.entities.find(e => e.type === 'ellipse')!;
    part.sketch.entities.push({ id: 'contact', type: 'point', x: 50, y: 40, standalone: true });
    part.sketch = addConstraint(part.sketch, { type: 'pointOnCurve', pointId: 'contact', entityId: ellipse.id, parameter: 0 });
    const solved = await solveCadDocument(doc);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  });
});
