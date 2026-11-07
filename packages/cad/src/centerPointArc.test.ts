import { expect, it } from 'vitest';
import {
  addCenterPointArc,
  centerPointArcFromPoints,
  addConstraint,
  createCadDocument,
  createCadPart,
  parseCadDocument,
  solveCadDocument,
} from './index';
const tau = Math.PI * 2;
it.each([
  [90, 0, 90],
  [-90, 0, 90],
  [-90, 5, 270],
  [90, -5, 270],
])('retains directed sweep end=%s intent=%s', async (degrees, intent, sweep) => {
  const center = { x: 40, y: 50 },
    start = { x: 60, y: 50 },
    radians = (degrees! * Math.PI) / 180;
  const end = { x: center.x + 100 * Math.cos(radians), y: center.y + 100 * Math.sin(radians) };
  const arc = centerPointArcFromPoints(center, start, end, intent)!;
  expect(arc.radius).toBeCloseTo(20);
  expect((((arc.endAngle - arc.startAngle + tau) % tau) * 180) / Math.PI).toBeCloseTo(sweep!);
  const part = createCadPart();
  part.sketch = addCenterPointArc(part.sketch, { center, start, end, sweepIntent: intent });
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [part] }, { sketchOnly: true });
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(5);
  const native = solved.document.parts[0]!.sketch.entities.find(e => e.type === 'arc')!;
  expect((((native.endAngle - native.startAngle + tau) % tau) * 180) / Math.PI).toBeCloseTo(sweep!);
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
});
it('crosses the angle branch cut and allows a true semicircle', () => {
  const point = (a: number) => ({ x: 20 * Math.cos((a * Math.PI) / 180), y: 20 * Math.sin((a * Math.PI) / 180) });
  const arc = centerPointArcFromPoints({ x: 0, y: 0 }, point(170), point(-170))!;
  expect((arc.endAngle - arc.startAngle + tau) % tau).toBeCloseTo((20 * Math.PI) / 180);
  expect(centerPointArcFromPoints({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: -20, y: 0 })).not.toBeNull();
});
it('rejects center/start/end degeneracy and nonfinite input without mutation', () => {
  const sketch = createCadPart().sketch;
  for (const [start, end] of [
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    [
      { x: 2, y: 0 },
      { x: 0, y: 0 },
    ],
    [
      { x: 2, y: 0 },
      { x: 8, y: 0 },
    ],
    [
      { x: NaN, y: 0 },
      { x: 2, y: 3 },
    ],
  ]) {
    expect(() => addCenterPointArc(sketch, { center: { x: 0, y: 0 }, start: start!, end: end! })).toThrow();
  }
  expect(sketch.entities).toHaveLength(1);
});
it('accepts a native radius driver and construction geometry', async () => {
  const part = createCadPart();
  part.sketch = addCenterPointArc(part.sketch, {
    center: { x: 40, y: 50 },
    start: { x: 60, y: 50 },
    end: { x: 40, y: 80 },
    construction: true,
  });
  const arc = part.sketch.entities.find(e => e.type === 'arc')!;
  expect(arc.construction).toBe(true);
  part.sketch = addConstraint(part.sketch, { type: 'radius', entityId: arc.id, value: 35 });
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [part] }, { sketchOnly: true });
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.document.parts[0]!.sketch.entities.find(e => e.type === 'arc')!.radius).toBeCloseTo(35);
});
