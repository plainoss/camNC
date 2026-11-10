import { expect, it } from 'vitest';
import {
  addBezier,
  addConic,
  addEllipse,
  addSpline,
  createCadPart,
  evaluateCurvePoint,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';
import { measuredSketchBounds } from './curveBounds';

const sources: [string, (sketch: CadSketch) => CadSketch][] = [
  [
    'cubic',
    sketch =>
      addBezier(sketch, {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 100 },
          { x: 100, y: 100 },
          { x: 100, y: 0 },
        ],
      }),
  ],
  [
    'degree15',
    sketch =>
      addBezier(sketch, { points: Array.from({ length: 16 }, (_, i) => ({ x: i * 8, y: i === 0 || i === 15 ? 0 : i % 2 ? 60 : -60 })) }),
  ],
  [
    'open spline',
    sketch =>
      addSpline(sketch, {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 40 },
          { x: 60, y: -10 },
          { x: 100, y: 0 },
          { x: 130, y: 35 },
        ],
      }),
  ],
  [
    'closed spline',
    sketch =>
      addSpline(sketch, {
        points: [
          { x: 0, y: 30 },
          { x: 30, y: 0 },
          { x: 60, y: 30 },
          { x: 30, y: 60 },
        ],
        closed: true,
      }),
  ],
  ['rotated ellipse', sketch => addEllipse(sketch, { center: { x: 40, y: 50 }, axis: { x: 70, y: 70 }, through: { x: 20, y: 80 } })],
  ['rational conic', sketch => addConic(sketch, { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, control: { x: 35, y: 80 }, rho: 0.3 })],
];
it.each(sources)('measures %s extrema against independent dense curve samples', (_name, make) => {
  const sketch = make(createCadPart().sketch),
    curve = sketch.entities.filter(e => e.type !== 'point').at(-1)!;
  const points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
  const bounds = measuredSketchBounds(sketch, new Set([curve.id]));
  const samples = Array.from({ length: 10_001 }, (_, i) => evaluateCurvePoint(curve, points, i / 10_000));
  for (const [axis, component] of [
    ['x', 0],
    ['y', 1],
  ] as const) {
    const low = Math.min(...samples.map(p => p[axis])),
      high = Math.max(...samples.map(p => p[axis]));
    expect(bounds.at[component]).toBeLessThanOrEqual(low + 1e-6);
    expect(bounds.at[component] + bounds.size[component]).toBeGreaterThanOrEqual(high - 1e-6);
    expect(bounds.at[component]).toBeCloseTo(low, 3);
    expect(bounds.at[component] + bounds.size[component]).toBeCloseTo(high, 3);
  }
});

it('uses both one-sided polynomial spans at a repeated cubic knot', () => {
  const values = [0, 100, 0, 0, -1000, 0, 0];
  const sketch = createCadPart().sketch;
  const controls = values.map((y, index) => ({ id: `pole${index}`, type: 'point' as const, x: index * 10, y }));
  const curve = {
    id: 'repeated-knot',
    type: 'spline' as const,
    startId: controls[0]!.id,
    endId: controls[6]!.id,
    controlPointIds: controls.map(p => p.id),
    fitPointIds: [controls[0]!.id, controls[3]!.id, controls[6]!.id],
    fitParameters: [0, 0.5, 1],
    degree: 3,
    knots: [0, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1, 1],
    weights: Array(7).fill(1),
    closed: false,
  };
  sketch.entities.push(...controls, curve);
  const bounds = measuredSketchBounds(sketch, new Set([curve.id]));
  // Each span is an independent cubic Bézier: its lone y control contributes 3*t*(1-t)^2, peaking at t=1/3.
  expect(bounds.at[1]).toBeCloseTo(-4000 / 9, 8);
  expect(bounds.at[1] + bounds.size[1]).toBeCloseTo(400 / 9, 8);
  const points = new Map(controls.map(p => [p.id, p]));
  expect(evaluateCurvePoint(curve, points, 1 / 6).y).toBeCloseTo(bounds.at[1] + bounds.size[1], 8);
});
