import { expect, it } from 'vitest';
import {
  addLine,
  addArc,
  addBezier,
  addCircle,
  addConic,
  addEllipse,
  addSpline,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCurvePoint,
  parseCadDocument,
  rationalCurveData,
  evaluateRationalCurve,
  rationalCurveInterval,
  solveCadDocument,
  splitSketchCurve,
  validateCadDocument,
  type CadEntity,
  type CadPointEntity,
} from './index';
const points = (entities: CadEntity[]) => new Map(entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
it('splits a dimensioned line without changing the whole-span driver and retains a detachable joint', async () => {
  const doc = createPlateDocument({ width: 120, height: 80 });
  const sketch = doc.parts[0]!.sketch;
  const edge = sketch.entities.find(e => e.type === 'line')!;
  const before = structuredClone(sketch);
  const result = splitSketchCurve(sketch, edge.id, [0.4]);
  if (!result.ok) throw new Error(result.message);
  expect(sketch).toEqual(before);
  doc.parts[0]!.sketch = result.sketch;
  expect(result.entityIds[0]).toBe(edge.id);
  expect(result.sketch.entities.find(e => e.id === edge.id)).toMatchObject({ startId: edge.startId });
  expect(result.sketch.entities.find(e => e.id === result.entityIds[1])).toMatchObject({ endId: edge.endId });
  const solved = await solveCadDocument(doc);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.parts[0]!.loops[0]!.entityIds).toHaveLength(5);
  expect(solved.sketches[0]!.dof).toBe(1);
  const pieces = result.entityIds.map(id => result.sketch.entities.find(e => e.id === id)!);
  expect('endId' in pieces[0]! && 'startId' in pieces[1]! && pieces[0].endId).not.toBe('startId' in pieces[1]! && pieces[1].startId);
  expect(validateCadDocument(doc)).toEqual([]);
});
it.each(['circle', 'arc', 'bezier', 'spline', 'conic', 'ellipse', 'closedSpline'] as const)(
  'preserves exact %s geometry through split, solve and persistence',
  async type => {
    const part = createCadPart();
    const input = part.sketch;
    part.sketch =
      type === 'circle'
        ? addCircle(input, { x: 50, y: 50, radius: 20 })
        : type === 'arc'
          ? addArc(input, { cx: 50, cy: 50, radius: 20, startAngle: 5.5, endAngle: 2.2 })
          : type === 'ellipse'
            ? addEllipse(input, { center: { x: 50, y: 50 }, axis: { x: 80, y: 65 }, through: { x: 44, y: 62 } })
            : type === 'conic'
              ? addConic(input, { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, control: { x: 40, y: 70 }, rho: 0.7 })
              : type === 'bezier'
                ? addBezier(input, {
                    points: [
                      { x: 0, y: 0 },
                      { x: 20, y: 80 },
                      { x: 70, y: -10 },
                      { x: 100, y: 20 },
                    ],
                  })
                : addSpline(input, {
                    points: [
                      { x: 0, y: 0 },
                      { x: 20, y: 80 },
                      { x: 70, y: -10 },
                      { x: 100, y: 20 },
                    ],
                    closed: type === 'closedSpline',
                  });
    const curve = part.sketch.entities.find(e => e.type === (type === 'closedSpline' ? 'spline' : type))!;
    if (curve.type === 'point') throw new Error('missing curve');
    const closed = ['circle', 'ellipse', 'closedSpline'].includes(type);
    const cuts = closed ? [0.17, 0.63] : [0.37];
    const result = splitSketchCurve(part.sketch, curve.id, cuts);
    if (!result.ok) throw new Error(result.message);
    const doc = { ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] };
    expect(validateCadDocument(doc)).toEqual([]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const solved = await solveCadDocument(doc, { sketchOnly: true });
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    const map = points(solved.document.parts[0]!.sketch.entities);
    const source = points(part.sketch.entities);
    const intervals = closed
      ? [
          [0.17, 0.63],
          [0.63, 1.17],
        ]
      : [
          [0, 0.37],
          [0.37, 1],
        ];
    result.entityIds.forEach((id, i) => {
      const piece = solved.document.parts[0]!.sketch.entities.find(e => e.id === id)!;
      if (piece.type === 'point') throw new Error('missing piece');
      for (let j = 0; j <= 30; j++) {
        const t = j / 30,
          u = intervals[i]![0]! + t * (intervals[i]![1]! - intervals[i]![0]!);
        const expected = evaluateCurvePoint(curve, source, u > 1 ? u - 1 : u),
          actual = evaluateCurvePoint(piece, map, t);
        expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(1e-6);
      }
    });
  }
);
it('rejects endpoint/duplicate cuts without mutation, and requires two points for a closed curve', () => {
  const part = createCadPart();
  part.sketch = addCircle(part.sketch, { x: 0, y: 0, radius: 20 });
  const circle = part.sketch.entities.find(e => e.type === 'circle')!;
  const before = structuredClone(part.sketch);
  for (const cuts of [[0.3], [0.3, 0.3], [0, 1], [0.4, NaN]]) expect(splitSketchCurve(part.sketch, circle.id, cuts).ok).toBe(false);
  expect(part.sketch).toEqual(before);
});
it('restricts a rational span in homogeneous coordinates without changing its weights or locus', () => {
  const part = createCadPart();
  part.sketch = addConic(part.sketch, { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, control: { x: 40, y: 70 }, rho: 0.8 });
  const curve = part.sketch.entities.find(e => e.type === 'conic')!;
  const data = rationalCurveData(curve, points(part.sketch.entities));
  const piece = rationalCurveInterval(data, 0.23, 0.81);
  for (let i = 0; i <= 30; i++) {
    const a = evaluateRationalCurve(data, 0.23 + (0.58 * i) / 30),
      b = evaluateRationalCurve(piece, i / 30);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-8);
  }
});
it('retains fixed Bezier geometry and reports released partially fixed poles', async () => {
  const part = createCadPart();
  part.sketch = addBezier(part.sketch, {
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 80 },
      { x: 70, y: -10 },
      { x: 100, y: 20 },
    ],
  });
  const curve = part.sketch.entities.find(e => e.type === 'bezier')!;
  const ids = new Set(curve.controlPointIds);
  const fixed = {
    ...part.sketch,
    entities: part.sketch.entities.map(e => (e.type === 'point' && ids.has(e.id) ? { ...e, fixed: true } : e)),
  };
  const result = splitSketchCurve(fixed, curve.id, [0.4]);
  if (!result.ok) throw new Error(result.message);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0]!.dof).toBe(0);
  expect(result.releasedFixedPointIds).toEqual([]);
  const partial = {
    ...part.sketch,
    entities: part.sketch.entities.map(e => (e.id === curve.controlPointIds[1] ? { ...e, fixed: true } : e)),
  };
  const released = splitSketchCurve(partial, curve.id, [0.4]);
  if (!released.ok) throw new Error(released.message);
  expect(released.releasedFixedPointIds).toEqual([curve.controlPointIds[1]]);
});
it('reuses a cut spline fit point as one joint endpoint and keeps its attached dimension', async () => {
  const part = createCadPart();
  part.sketch = addSpline(part.sketch, {
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 80 },
      { x: 70, y: -10 },
      { x: 100, y: 20 },
    ],
  });
  const curve = part.sketch.entities.find(e => e.type === 'spline')!;
  const fitId = curve.fitPointIds[1]!;
  part.sketch.constraints.push({ id: 'fit-position', type: 'positionX', pointId: fitId, value: 20 });
  const result = splitSketchCurve(part.sketch, curve.id, [curve.fitParameters[1]!]);
  if (!result.ok) throw new Error(result.message);
  expect(result.sketch.entities.some(e => e.id === fitId)).toBe(true);
  expect(result.sketch.constraints.some(c => c.id === 'fit-position')).toBe(true);
  expect(result.releasedConstraintIds).not.toContain('fit-position');
  const piece = result.sketch.entities.find(e => e.id === result.entityIds[0]);
  expect(piece && 'endId' in piece && piece.endId).toBe(fitId);
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
});
it('keeps a near-cut contact parameter in its serialized domain', () => {
  const part = createCadPart();
  part.sketch = addBezier(part.sketch, {
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 80 },
      { x: 70, y: -10 },
      { x: 100, y: 20 },
    ],
  });
  const curve = part.sketch.entities.find(e => e.type === 'bezier')!;
  const contact = evaluateCurvePoint(curve, points(part.sketch.entities), 0.4 + 5e-9);
  part.sketch.entities.push({ id: 'contact-point', type: 'point', ...contact, standalone: true });
  part.sketch.constraints.push({
    id: 'contact',
    type: 'pointOnCurve',
    pointId: 'contact-point',
    entityId: curve.id,
    parameter: 0.4 + 5e-9,
  });
  const result = splitSketchCurve(part.sketch, curve.id, [0.4]);
  if (!result.ok) throw new Error(result.message);
  const relation = result.sketch.constraints.find(c => c.id === 'contact');
  expect(relation && 'parameter' in relation && relation.parameter).toBe(1);
  expect(validateCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] })).toEqual([]);
});
it('retains every fit point when an exact closed-spline interval crosses the old seam at the creation limit', async () => {
  const part = createCadPart();
  part.sketch = addSpline(part.sketch, {
    closed: true,
    points: Array.from({ length: 64 }, (_, i) => ({
      x: 100 + 50 * Math.cos((i * Math.PI) / 32),
      y: 100 + 50 * Math.sin((i * Math.PI) / 32),
    })),
  });
  const curve = part.sketch.entities.find(e => e.type === 'spline')!;
  const result = splitSketchCurve(part.sketch, curve.id, [0.001, 0.002]);
  if (!result.ok) throw new Error(result.message);
  const doc = { ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] };
  expect(validateCadDocument(doc)).toEqual([]);
  for (const id of curve.fitPointIds) expect(result.sketch.entities.some(e => e.id === id)).toBe(true);
  const major = result.sketch.entities.find(e => e.id === result.entityIds[1]);
  if (major?.type !== 'spline') throw new Error('missing major segment');
  expect(major.fitPointIds).toHaveLength(66);
  const source = points(part.sketch.entities),
    target = points(result.sketch.entities);
  for (let i = 0; i <= 40; i++) {
    const u = 0.002 + (i / 40) * 0.999,
      a = evaluateCurvePoint(curve, source, u > 1 ? u - 1 : u),
      b = evaluateCurvePoint(major, target, i / 40);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-7);
  }
  expect(parseCadDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
});
it('retains a whole-line midpoint relation instead of moving it to the first half', async () => {
  const doc = createPlateDocument({ width: 120, height: 80 });
  const sketch = doc.parts[0]!.sketch;
  const line = sketch.entities.find(e => e.type === 'line')!;
  sketch.entities.push({ id: 'midpoint', type: 'point', x: 60, y: 0, standalone: true });
  sketch.constraints.push({ id: 'whole-midpoint', type: 'midpoint', pointId: 'midpoint', entityId: line.id });
  const result = splitSketchCurve(sketch, line.id, [0.3]);
  if (!result.ok) throw new Error(result.message);
  const relation = result.sketch.constraints.find(c => c.id === 'whole-midpoint');
  expect(relation && 'entityId' in relation && relation.entityId).not.toBe(line.id);
  doc.parts[0]!.sketch = result.sketch;
  const solved = await solveCadDocument(doc);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  const midpoint = solved.document.parts[0]!.sketch.entities.find(e => e.id === 'midpoint');
  expect(midpoint).toMatchObject({ x: 60, y: 0 });
});
it('rebinds endpoint tangency to the rational piece that retains the original endpoint', async () => {
  const part = createCadPart();
  part.sketch = addBezier(part.sketch, {
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 40 },
      { x: 70, y: 60 },
      { x: 100, y: 0 },
    ],
  });
  const curve = part.sketch.entities.find(e => e.type === 'bezier')!;
  part.sketch = addLine(part.sketch, { x1: 100, y1: 0, x2: 110, y2: -20 });
  const line = part.sketch.entities.at(-1)!;
  part.sketch.constraints.push({ id: 'end-tangent', type: 'tangent', entityAId: curve.id, entityBId: line.id });
  const result = splitSketchCurve(part.sketch, curve.id, [0.4]);
  if (!result.ok) throw new Error(result.message);
  expect(result.sketch.constraints.find(c => c.id === 'end-tangent')).toMatchObject({ entityAId: result.entityIds[1], entityBId: line.id });
  const solved = await solveCadDocument({ ...createCadDocument(), parts: [{ ...part, sketch: result.sketch }] }, { sketchOnly: true });
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
});
