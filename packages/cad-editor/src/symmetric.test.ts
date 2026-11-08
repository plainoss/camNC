import { expect, it } from 'vitest';
import {
  addLine,
  addPoint,
  addCircle,
  addArc,
  addEllipse,
  addConstraint,
  createCadDocument,
  createCadPart,
  entityPointIds,
  reflectAcrossLine,
  solveCadDocument,
  parseCadDocument,
  type CadSketch,
  type CadPointEntity,
} from '@wbcnc/cad';
import { buildConstraintForSelection } from './constraintCommands';
function fixture() {
  const part = createCadPart();
  part.sketch = addLine(part.sketch, { x1: 0, y1: -100, x2: 0, y2: 100, construction: true });
  const axis = part.sketch.entities.at(-1)!;
  fix(part.sketch, entityPointIds(axis));
  return { part, axis };
}
function fix(sketch: CadSketch, ids: string[]) {
  sketch.entities = sketch.entities.map(e => (e.type === 'point' && ids.includes(e.id) ? { ...e, fixed: true } : e));
}
async function solve(sketch: CadSketch) {
  const part = { ...createCadPart(), sketch };
  return solveCadDocument({ ...createCadDocument(), parts: [part] }, { sketchOnly: true });
}
const points = (s: CadSketch) => new Map(s.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
it('constrains two selected points relative to the first-selected line', async () => {
  const { part, axis } = fixture();
  let s = addPoint(part.sketch, { x: 20, y: 40 });
  const a = s.entities.at(-1)!;
  s = addPoint(s, { x: -35, y: 60 });
  const b = s.entities.at(-1)!;
  const result = buildConstraintForSelection(s, 'symmetric', [axis.id, a.id, b.id]);
  expect(result.constraint?.type).toBe('symmetricPoints');
  s = addConstraint(s, result.constraint!);
  const solved = await solve(s);
  expect(solved.status).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(2);
  const p = points(solved.document.parts[0]!.sketch);
  expect(p.get(a.id)!.x).toBeCloseTo(-p.get(b.id)!.x);
  expect(p.get(a.id)!.y).toBeCloseTo(p.get(b.id)!.y);
  expect(buildConstraintForSelection(s, 'symmetric', [axis.id, b.id, a.id]).alreadyApplied).toBe(true);
});
it('constrains reflected line supports while leaving segment endpoints and lengths independent', async () => {
  const { part, axis } = fixture();
  let s = addLine(part.sketch, { x1: 20, y1: 10, x2: 40, y2: 30 });
  const a = s.entities.at(-1)!;
  fix(s, entityPointIds(a));
  s = addLine(s, { x1: -80, y1: 70, x2: -20, y2: 10 });
  const b = s.entities.at(-1)!;
  const result = buildConstraintForSelection(s, 'symmetric', [axis.id, a.id, b.id]);
  s = addConstraint(s, result.constraint!);
  const solved = await solve(s);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(2);
  const output = solved.document.parts[0]!.sketch,
    p = points(output);
  if (a.type !== 'line' || b.type !== 'line') throw Error();
  expect(p.get(b.startId)!.x).toBeCloseTo(-80);
  expect(p.get(b.endId)!.x).toBeCloseTo(-20);
  expect(output.entities).toHaveLength(s.entities.length);
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  expect(buildConstraintForSelection(output, 'symmetric', [axis.id, b.id, a.id]).alreadyApplied).toBe(true);
});
it('shares reflected centers and radii for circular curves', async () => {
  const { part, axis } = fixture();
  let s = addCircle(part.sketch, { x: 30, y: 40, radius: 10, dimensioned: true });
  const a = s.entities.at(-1)!;
  if (a.type !== 'circle') throw Error();
  fix(s, [a.centerId]);
  s = addCircle(s, { x: -40, y: 60, radius: 15 });
  const b = s.entities.at(-1)!;
  s = addConstraint(s, buildConstraintForSelection(s, 'symmetric', [axis.id, a.id, b.id]).constraint!);
  const solved = await solve(s);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(0);
  const output = solved.document.parts[0]!.sketch,
    second = output.entities.find(e => e.id === b.id)!;
  if (second.type !== 'circle') throw Error();
  const center = points(output).get(second.centerId)!;
  expect(center.x).toBeCloseTo(-30);
  expect(center.y).toBeCloseTo(40);
  expect(second.radius).toBeCloseTo(10);
});
it('keeps circular arc endpoints independent of underlying-circle symmetry', async () => {
  const { part, axis } = fixture();
  let s = addArc(part.sketch, { cx: 30, cy: 40, radius: 10, startAngle: 0, endAngle: Math.PI / 2 });
  const a = s.entities.at(-1)!;
  fix(s, entityPointIds(a));
  s = addArc(s, { cx: -30, cy: 40, radius: 10, startAngle: Math.PI, endAngle: (3 * Math.PI) / 2 });
  const b = s.entities.at(-1)!;
  if (b.type !== 'arc') throw Error();
  fix(s, [b.centerId]);
  s = addConstraint(s, buildConstraintForSelection(s, 'symmetric', [axis.id, a.id, b.id]).constraint!);
  const solved = await solve(s);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(2);
  const moved = await solveCadDocument(solved.document, { sketchOnly: true, drag: { pointId: b.endId, x: -20, y: 40 } });
  expect(moved.status).toBe('solved');
  expect(points(moved.document.parts[0]!.sketch).get(b.endId)!.x).toBeCloseTo(-20, 5);
  if (a.type !== 'arc') throw Error();
  expect(points(moved.document.parts[0]!.sketch).get(a.endId)!.y).toBeCloseTo(50);
});
it.each([1, -1])('retains ellipse reflection with focus branch %s', async direction => {
  const { part, axis } = fixture();
  let s = addEllipse(part.sketch, { center: { x: 30, y: 40 }, axis: { x: 50, y: 40 }, through: { x: 30, y: 50 } });
  const a = s.entities.at(-1)!;
  fix(s, entityPointIds(a));
  s = addEllipse(s, { center: { x: -40, y: 60 }, axis: { x: -40 + direction * 20, y: 60 }, through: { x: -40, y: 70 } });
  const b = s.entities.at(-1)!;
  const result = buildConstraintForSelection(s, 'symmetric', [axis.id, a.id, b.id]);
  expect(result.constraint?.type).toBe('symmetricCurves');
  s = addConstraint(s, result.constraint!);
  const solved = await solve(s);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(0);
  const output = solved.document.parts[0]!.sketch,
    ellipse = output.entities.find(e => e.id === b.id)!;
  if (ellipse.type !== 'ellipse') throw Error();
  const center = points(output).get(ellipse.centerId)!;
  expect(center.x).toBeCloseTo(-30, 5);
  expect(center.y).toBeCloseTo(40, 5);
  expect(ellipse.radius).toBeCloseTo(10, 5);
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
});
it('reports incompatible fixed geometry instead of omitting constant symmetry equations', async () => {
  const { part, axis } = fixture();
  let s = addCircle(part.sketch, { x: 30, y: 40, radius: 10 });
  const a = s.entities.at(-1)!;
  s = addCircle(s, { x: -30, y: 80, radius: 10 });
  const b = s.entities.at(-1)!;
  fix(s, [...entityPointIds(a), ...entityPointIds(b)]);
  s = addConstraint(s, buildConstraintForSelection(s, 'symmetric', [axis.id, a.id, b.id]).constraint!);
  const relation = s.constraints.at(-1)!;
  const result = await solve(s);
  expect(result.status).toBe('conflict');
  expect(result.diagnostics.some(d => d.constraintIds?.includes(relation.id))).toBe(true);
});
it('arms in axis-first order, rejects incompatible/self/degenerate selections and reflects a rotated line', () => {
  const { part, axis } = fixture();
  let s = addPoint(part.sketch, { x: 20, y: 40 });
  const p = s.entities.at(-1)!;
  s = addCircle(s, { x: 20, y: 40, radius: 10 });
  const c = s.entities.at(-1)!;
  expect(buildConstraintForSelection(s, 'symmetric', []).needsMore).toBe(true);
  expect(buildConstraintForSelection(s, 'symmetric', [axis.id]).needsMore).toBe(true);
  expect(buildConstraintForSelection(s, 'symmetric', [p.id, axis.id, c.id]).constraint).toBeUndefined();
  expect(buildConstraintForSelection(s, 'symmetric', [axis.id, p.id, c.id]).constraint).toBeUndefined();
  const reflected = reflectAcrossLine({ x: 20, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 })!;
  expect(reflected.x).toBeCloseTo(10);
  expect(reflected.y).toBeCloseTo(10);
  expect(reflectAcrossLine({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
});

it.each([false, true])('supports mixed circle/arc symmetry in either selection order (%s)', async reverse => {
  const { part, axis } = fixture();
  let s = addCircle(part.sketch, { x: 30, y: 40, radius: 10, dimensioned: true });
  const circle = s.entities.at(-1)!;
  if (circle.type !== 'circle') throw Error();
  fix(s, [circle.centerId]);
  s = addArc(s, { cx: -35, cy: 50, radius: 12, startAngle: Math.PI, endAngle: (3 * Math.PI) / 2 });
  const arc = s.entities.at(-1)!;
  const pair = reverse ? [arc.id, circle.id] : [circle.id, arc.id];
  s = addConstraint(s, buildConstraintForSelection(s, 'symmetric', [axis.id, ...pair]).constraint!);
  const solved = await solve(s);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(2);
  const output = solved.document.parts[0]!.sketch,
    c = output.entities.find(e => e.id === arc.id)!;
  if (c.type !== 'arc') throw Error();
  const center = points(output).get(c.centerId)!;
  expect(center.x).toBeCloseTo(-30, 5);
  expect(center.y).toBeCloseTo(40, 5);
  expect(c.radius).toBeCloseTo(10, 5);
});
it('rejects a symmetry contradiction enforced through fixed coincidence aliases', async () => {
  const { part, axis } = fixture();
  let s = addCircle(part.sketch, { x: 30, y: 40, radius: 10 });
  const a = s.entities.at(-1)!;
  s = addCircle(s, { x: -30, y: 80, radius: 10 });
  const b = s.entities.at(-1)!;
  for (const curve of [a, b]) {
    if (curve.type !== 'circle') throw Error();
    const center = points(s).get(curve.centerId)!;
    s = addPoint(s, { x: center.x, y: center.y, fixed: true });
    const alias = s.entities.at(-1)!;
    s = addConstraint(s, { type: 'coincident', pointAId: curve.centerId, pointBId: alias.id });
  }
  s = addConstraint(s, buildConstraintForSelection(s, 'symmetric', [axis.id, a.id, b.id]).constraint!);
  const solved = await solve(s);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('conflict');
});
