import { describe, expect, it } from 'vitest';
import { evaluateCurvePoint, parseCadDocument, type CadPointEntity } from '@wbcnc/cad';
import { editCad } from './edit';

const fast = { toolpaths: false };
const points = (sketch: { entities: readonly unknown[] }) =>
  new Map((sketch.entities as CadPointEntity[]).filter(e => e.type === 'point').map(p => [p.id, p]));
describe('native scripted curves', () => {
  it('keeps a cubic path native, shares endpoint identity and follows expressions after reload', async () => {
    const first = await editCad(
      null,
      d => {
        d.variable('width', '100mm');
        d.variable('rise', '40mm');
        const part = d.newPart('Curved rail', { thickness: 18 });
        part.profile
          .path([0, 0])
          .cubicTo(['width', 0], { control1: [0, 'rise'], control2: ['width', 'rise'] })
          .lineTo(['width', -10])
          .lineTo([0, -10])
          .close({ straight: true });
      },
      fast
    );
    expect(first.ok, JSON.stringify(first.report)).toBe(true);
    const sketch = first.document.parts[0]!.sketch,
      curve = sketch.entities.find(e => e.type === 'bezier')!;
    expect(curve.controlPointIds).toHaveLength(4);
    expect(sketch.entities.find(e => e.type === 'line' && e.startId === curve.endId)).toBeDefined();
    const initial = evaluateCurvePoint(curve, points(sketch), 0.5);
    expect(initial).toEqual({ x: 50, y: 30 });
    const second = await editCad(
      parseCadDocument(JSON.parse(JSON.stringify(first.document))),
      d => {
        d.variable('width', '140mm');
        d.variable('rise', '80mm');
      },
      fast
    );
    expect(second.ok, JSON.stringify(second.report)).toBe(true);
    const resized = second.document.parts[0]!.sketch,
      next = resized.entities.find(e => e.id === curve.id)!;
    if (next.type !== 'bezier') throw Error('Missing native curve');
    expect(next.controlPointIds).toEqual(curve.controlPointIds);
    expect(evaluateCurvePoint(next, points(resized), 0.5)).toEqual({ x: 70, y: 60 });
    expect(second.report.parts[0]!.sketches[0]!.freedom).toBe(0);
  });
  it('uses an editable quadratic curve rather than sampled chords', async () => {
    const result = await editCad(
      null,
      d => {
        d.newPart('Arch')
          .profile.path([0, 0])
          .quadTo([100, 0], { control: [50, 60] })
          .close({ straight: true });
      },
      fast
    );
    expect(result.ok, JSON.stringify(result.report)).toBe(true);
    const sketch = result.document.parts[0]!.sketch;
    expect(sketch.entities.filter(e => e.type === 'bezier')).toHaveLength(1);
    expect(sketch.entities.filter(e => e.type === 'line')).toHaveLength(1);
    expect(result.report.parts[0]!.sketches[0]!.freedom).toBe(0);
  });
  it('retains fit-point and tangent handle identities with variable-driven coordinates', async () => {
    const first = await editCad(
      null,
      d => {
        d.variable('height', '50mm');
        const part = d.newPart('Spline panel');
        part.profile.spline({
          points: [
            [0, 0],
            [25, 'height'],
            [75, 'height'],
            [100, 0],
          ],
        });
        part.profile.line([100, 0], [0, 0]);
      },
      fast
    );
    expect(first.ok, JSON.stringify(first.report)).toBe(true);
    const curve = first.document.parts[0]!.sketch.entities.find(e => e.type === 'spline')!;
    const second = await editCad(first.document, d => d.variable('height', '80mm'), fast);
    expect(second.ok, JSON.stringify(second.report)).toBe(true);
    const sketch = second.document.parts[0]!.sketch,
      next = sketch.entities.find(e => e.type === 'spline')!;
    expect(next.fitPointIds).toEqual(curve.fitPointIds);
    expect(next.controlPointIds).toEqual(curve.controlPointIds);
    next.fitParameters.forEach((t, i) => {
      const actual = evaluateCurvePoint(next, points(sketch), t);
      expect(actual.y).toBeCloseTo(i === 0 || i === 3 ? 0 : 80, 6);
    });
    expect(second.report.parts[0]!.sketches[0]!.freedom).toBe(0);
  });
  it('constrains an ellipse with persistent radii and an angle expression', async () => {
    const first = await editCad(
      null,
      d => {
        d.variable('rx', '40mm');
        d.variable('ry', '20mm');
        d.variable('tilt', '20deg');
        d.newPart('Oval').profile.ellipse({ at: [50, 50], rx: 'rx', ry: 'ry', angle: 'tilt' });
      },
      fast
    );
    expect(first.ok, JSON.stringify(first.report)).toBe(true);
    const ids = first.document.parts[0]!.sketch.entities.map(e => e.id);
    const second = await editCad(
      first.document,
      d => {
        d.variable('rx', '15mm');
        d.variable('ry', '30mm');
        d.variable('tilt', '35deg');
      },
      fast
    );
    expect(second.ok, JSON.stringify(second.report)).toBe(true);
    expect(second.document.parts[0]!.sketch.entities.map(e => e.id)).toEqual(ids);
    expect(second.report.parts[0]!.sketches[0]!.freedom).toBe(0);
  });
  it('supports native closed fit splines with expression-driven fit points', async () => {
    const first = await editCad(
      null,
      d => {
        d.variable('size', '50mm');
        d.newPart('Seat').profile.spline({
          points: [
            [0, 25],
            [25, 'size'],
            ['size', 25],
            [25, 0],
          ],
          closed: true,
        });
      },
      fast
    );
    expect(first.ok, JSON.stringify(first.report)).toBe(true);
    expect(first.report.parts[0]!.sketches[0]!.freedom).toBe(0);
    const next = await editCad(first.document, d => d.variable('size', '60mm'), fast);
    expect(next.ok, JSON.stringify(next.report)).toBe(true);
  });
  it('skips planning only when requested, while still validating expectations and geometry', async () => {
    const result = await editCad(
      null,
      d => {
        const part = d.newPart('Plate');
        part.profile.rect({ at: [0, 0], w: 80, h: 60 });
        part.expect({ size: [90, 60] });
      },
      fast
    );
    expect(result.ok).toBe(false);
    expect(result.report.errors.some(e => e.code === 'expect-failed')).toBe(true);
    expect(result.report.parts[0]!.toolpaths).toBeUndefined();
    const full = await editCad(null, d => d.newPart('Plate').profile.rect({ at: [0, 0], w: 80, h: 60 }));
    expect(full.ok).toBe(true);
    expect(full.report.parts[0]!.toolpaths).toBeDefined();
  });
});

it('keeps spline handle coordinates linked when fit coordinates mix number and length variables', async () => {
  const first = await editCad(
    null,
    d => {
      d.variable('rise', '45');
      d.variable('width', '100mm');
      const p = d.newPart('Rail');
      p.profile.spline({
        points: [
          [0, 0],
          [23, 'rise'],
          ['width-24mm', 'rise'],
          ['width', 0],
        ],
      });
      p.profile.line([100, 0], [0, 0]);
    },
    fast
  );
  expect(first.ok, JSON.stringify(first.report)).toBe(true);
  const next = await editCad(first.document, d => d.variable('rise', '60'), fast);
  expect(next.ok, JSON.stringify(next.report)).toBe(true);
  expect(next.report.parts[0]!.sketches[0]!.freedom).toBe(0);
});
