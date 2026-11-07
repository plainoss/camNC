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
  updateDimension,
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
  it.each([0, 0.4])('keeps logical diameter ownership while axes cross at angle %s', async angle => {
    const doc = fixture(30, angle),
      part = doc.parts[0]!;
    const ellipse = part.sketch.entities.find(e => e.type === 'ellipse')!;
    const primary = [ellipse.minorStartId, ellipse.minorEndId] as const;
    const secondary = [ellipse.majorStartId, ellipse.majorEndId] as const;
    part.sketch = addConstraint(part.sketch, { id: 'primary', type: 'distance', pointAId: primary[0], pointBId: primary[1], value: 80 });
    let result = await solveCadDocument(doc);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    const diameter = (d: typeof doc, ids: readonly string[]) => {
      const p = ids.map(id => d.parts[0]!.sketch.entities.find(e => e.id === id) as CadPointEntity);
      return Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y);
    };
    expect(diameter(result.document, primary)).toBeCloseTo(80, 5);
    expect(diameter(result.document, secondary)).toBeCloseTo(60, 5);
    expect(result.document.parts[0]!.sketch.entities.find(e => e.type === 'ellipse')!.primaryAxis).toBe('major');
    result.document.parts[0]!.sketch = addConstraint(result.document.parts[0]!.sketch, {
      id: 'secondary',
      type: 'distance',
      pointAId: secondary[0],
      pointBId: secondary[1],
      value: 60,
    });
    result = await solveCadDocument(result.document);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    result = await solveCadDocument(updateDimension(result.document, 'primary', 30));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(diameter(result.document, primary)).toBeCloseTo(30, 5);
    expect(diameter(result.document, secondary)).toBeCloseTo(60, 5);
    expect(result.document.parts[0]!.sketch.entities.find(e => e.type === 'ellipse')!.primaryAxis).toBe('minor');
    expect(result.document.parts[0]!.sketch.constraints.find(c => c.id === 'primary')).toMatchObject({
      pointAId: primary[0],
      pointBId: primary[1],
      value: 30,
    });
    expect(parseCadDocument(JSON.parse(JSON.stringify(result.document)))).toEqual(result.document);
  });
  it('supports equal driving diameters followed by a crossing edit', async () => {
    const doc = fixture();
    const part = doc.parts[0]!,
      ellipse = part.sketch.entities.find(e => e.type === 'ellipse')!;
    part.sketch = addConstraint(part.sketch, {
      id: 'major',
      type: 'distance',
      pointAId: ellipse.majorStartId,
      pointBId: ellipse.majorEndId,
      value: 40,
    });
    part.sketch = addConstraint(part.sketch, {
      id: 'minor',
      type: 'distance',
      pointAId: ellipse.minorStartId,
      pointBId: ellipse.minorEndId,
      value: 40,
    });
    const equal = await solveCadDocument(doc);
    expect(equal.status, JSON.stringify(equal.diagnostics)).toBe('solved');
    const crossed = await solveCadDocument(updateDimension(equal.document, 'minor', 60));
    expect(crossed.status, JSON.stringify(crossed.diagnostics)).toBe('solved');
    expect(crossed.document.parts[0]!.sketch.entities.find(e => e.type === 'ellipse')!.minorStartId).not.toBe(ellipse.minorStartId);
  });
  it('does not move fixed points to satisfy contradictory axis edits', async () => {
    const doc = fixture();
    const part = doc.parts[0]!,
      ellipse = part.sketch.entities.find(e => e.type === 'ellipse')!;
    part.sketch.entities = part.sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e));
    part.sketch = addConstraint(part.sketch, { type: 'distance', pointAId: ellipse.minorStartId, pointBId: ellipse.minorEndId, value: 60 });
    const result = await solveCadDocument(doc);
    expect(result.status).not.toBe('solved');
    expect(result.document.parts[0]!.sketch.entities.filter(e => e.type === 'point')).toEqual(
      part.sketch.entities.filter(e => e.type === 'point')
    );
  });

  it('recognizes reversed diameter drivers on coincident aliases without rewriting their references', async () => {
    const doc = fixture(),
      part = doc.parts[0]!,
      ellipse = part.sketch.entities.find(e => e.type === 'ellipse')!;
    const point = (id: string) => part.sketch.entities.find(e => e.id === id) as CadPointEntity;
    const a = point(ellipse.minorStartId),
      b = point(ellipse.minorEndId),
      anchor = point(ellipse.majorStartId);
    part.sketch.entities.push(
      { id: 'a-alias', type: 'point', x: a.x, y: a.y },
      { id: 'b-alias', type: 'point', x: b.x, y: b.y },
      { id: 'fixed-alias', type: 'point', x: anchor.x, y: anchor.y, fixed: true }
    );
    for (const [pointAId, pointBId] of [
      ['a-alias', a.id],
      ['b-alias', b.id],
      ['fixed-alias', anchor.id],
    ])
      part.sketch = addConstraint(part.sketch, { type: 'coincident', pointAId: pointAId!, pointBId: pointBId! });
    part.sketch = addConstraint(part.sketch, {
      id: 'aliased-diameter',
      type: 'distance',
      pointAId: 'b-alias',
      pointBId: 'a-alias',
      value: 60,
    });
    const result = await solveCadDocument(doc);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    const sketch = result.document.parts[0]!.sketch;
    expect(sketch.constraints.find(c => c.id === 'aliased-diameter')).toMatchObject({
      pointAId: 'b-alias',
      pointBId: 'a-alias',
      value: 60,
    });
    const p = sketch.entities.find(e => e.id === 'a-alias') as CadPointEntity,
      q = sketch.entities.find(e => e.id === 'b-alias') as CadPointEntity;
    expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(60, 5);
    expect(sketch.entities.find(e => e.id === anchor.id)).toMatchObject({ x: anchor.x, y: anchor.y });
  });
});
