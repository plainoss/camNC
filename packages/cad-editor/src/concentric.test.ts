import { expect, it } from 'vitest';
import {
  addCircle,
  addArc,
  addPoint,
  addEllipse,
  addLine,
  addConstraint,
  createCadDocument,
  createCadPart,
  solveCadDocument,
  parseCadDocument,
} from '@wbcnc/cad';
import { buildConstraintForSelection } from './constraintCommands';
function fixture() {
  const part = createCadPart();
  let s = addCircle(part.sketch, { x: 30, y: 40, radius: 10, dimensioned: true });
  s = addArc(s, { cx: 90, cy: 100, radius: 20, startAngle: 0, endAngle: Math.PI });
  s = addEllipse(s, { center: { x: 160, y: 150 }, axis: { x: 190, y: 150 }, through: { x: 160, y: 160 } });
  part.sketch = s;
  return part;
}
it('constrains mixed curve centers in one batch and preserves the document representation', async () => {
  const part = fixture(),
    curves = part.sketch.entities.filter(e => ['circle', 'arc', 'ellipse'].includes(e.type));
  const result = buildConstraintForSelection(
    part.sketch,
    'concentric',
    curves.map(e => e.id)
  );
  expect(result.constraints).toHaveLength(2);
  for (const c of result.constraints!) part.sketch = addConstraint(part.sketch, c);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [part] }, { sketchOnly: true });
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  const sketch = solved.document.parts[0]!.sketch,
    points = new Map(sketch.entities.filter(e => e.type === 'point').map(e => [e.id, e]));
  const centers = sketch.entities
    .filter(e => e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse')
    .map(e => points.get(e.centerId)!);
  for (const center of centers.slice(1)) {
    expect(center.x).toBeCloseTo(centers[0]!.x, 5);
    expect(center.y).toBeCloseTo(centers[0]!.y, 5);
  }
  expect(sketch.entities.find(e => e.type === 'circle')!.radius).toBeCloseTo(10);
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  expect(
    buildConstraintForSelection(
      sketch,
      'concentric',
      curves.map(e => e.id)
    ).alreadyApplied
  ).toBe(true);
});
it('rejects unsupported selections, arms on one curve and adds no redundant shared-center relation', () => {
  const part = fixture(),
    curves = part.sketch.entities.filter(e => e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse');
  expect(buildConstraintForSelection(part.sketch, 'concentric', []).needsMore).toBe(true);
  expect(buildConstraintForSelection(part.sketch, 'concentric', [curves[0]!.id]).needsMore).toBe(true);
  const s = addLine(part.sketch, { x1: 1, y1: 2, x2: 3, y2: 4 }),
    line = s.entities.at(-1)!;
  expect(buildConstraintForSelection(s, 'concentric', [line.id, curves[0]!.id]).constraint).toBeUndefined();
  expect(buildConstraintForSelection(s, 'concentric', [line.id]).needsMore).toBe(false);
  let same = addCircle(createCadPart().sketch, { x: 30, y: 40, radius: 10 });
  same = addCircle(same, { x: 30, y: 40, radius: 20 });
  expect(
    buildConstraintForSelection(
      same,
      'concentric',
      same.entities.filter(e => e.type === 'circle').map(e => e.id)
    ).alreadyApplied
  ).toBe(true);
});

it('allows a reference point at a curve center but rejects its own rim', () => {
  const part = fixture(),
    arc = part.sketch.entities.find(e => e.type === 'arc')!;
  const sketch = addPoint(part.sketch, { x: 10, y: 20 }),
    point = sketch.entities.at(-1)!;
  expect(buildConstraintForSelection(sketch, 'concentric', [point.id]).needsMore).toBe(true);
  expect(buildConstraintForSelection(sketch, 'concentric', [point.id, arc.id]).constraint).toMatchObject({
    type: 'coincident',
    pointAId: arc.centerId,
    pointBId: point.id,
  });
  expect(buildConstraintForSelection(sketch, 'concentric', [arc.startId, arc.id]).constraint).toBeUndefined();
});
