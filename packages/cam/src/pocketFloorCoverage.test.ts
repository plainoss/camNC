import { expect, it } from 'vitest';
import { postedFloorDistance } from '../test/postedFloorDistance';
import { finalizePlan } from './finalizePlan';
import { toGcode } from './gcode';
import { distPointSeg, type PathD, type PathsD } from './geom';
import { DEFAULT_SETTINGS, pocketOperation } from './toolpaths';

const polygon = (points: number[][]): PathD => points.map(([x, y]) => ({ x: x!, y: y! }));
const rect = (x0: number, y0: number, x1: number, y1: number) =>
  polygon([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);
const inside = (x: number, y: number, path: PathD) => {
  let odd = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const a = path[i]!,
      b = path[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
  }
  return odd;
};
function centerFits(x: number, y: number, region: PathsD, radius: number) {
  return (
    region.reduce((count, path) => count + Number(inside(x, y, path)), 0) % 2 === 1 &&
    region.every(path =>
      path.every(
        (point, i) => distPointSeg(x, y, point.x, point.y, path[(i + 1) % path.length]!.x, path[(i + 1) % path.length]!.y) >= radius
      )
    )
  );
}

it('clears the four reachable diagonal floor points from issue #516 with a D6 full-diameter stepover', () => {
  const settings = { ...DEFAULT_SETTINGS, maxStepdown: 3, stepoverFactor: 1 };
  const operation = pocketOperation('Reported rectangle', [rect(0, 0, 60, 40)], 6, 3, { number: 1, diameter: 6 }, settings);
  const plan = finalizePlan({ stockTop: 6, operations: [operation], warnings: [] }, settings);
  for (const arcs of [false, true]) {
    const distance = postedFloorDistance(toGcode(plan, { arcs }), 3);
    for (const [x, y] of [
      [6.5, 6.5],
      [53.5, 6.5],
      [6.5, 33.5],
      [53.5, 33.5],
    ])
      expect(distance(x!, y!)).toBeLessThanOrEqual(3);
  }
});

it.each([
  {
    name: 'acute wedge',
    region: [
      polygon([
        [0, 0],
        [100, 0],
        [12, 32],
      ]),
    ],
  },
  {
    name: 'very acute wedge',
    region: [
      polygon([
        [0, 0],
        [120, 0],
        [120, 10],
      ]),
    ],
  },
  {
    name: 'concave L',
    region: [
      polygon([
        [0, 0],
        [80, 0],
        [80, 25],
        [25, 25],
        [25, 70],
        [0, 70],
      ]),
    ],
  },
  { name: 'protected island', region: [rect(0, 0, 75, 55), rect(24, 18, 50, 36).reverse()] },
  {
    name: 'narrow strip',
    region: [rect(0, 0, 60, 6.5)],
    probes: [
      [8, 3.25],
      [28, 3.25],
      [52, 3.25],
    ],
  },
  { name: 'edge-open cavity', region: [rect(10, -4, 70, 15)], solid: [rect(0, 0, 80, 50)] },
])(
  'covers feasible cutter-center floor points in a $name through a partial last step and wall finish',
  ({ name, region, probes, solid }) => {
    const settings = { ...DEFAULT_SETTINGS, stepoverFactor: 1, maxStepdown: 2, pocketWallAllowance: 0.2, pocketFinishStepdown: 1.1 };
    const operation = pocketOperation(name, region, 8, 2.3, { number: 1, diameter: 6 }, settings, solid);
    const plan = finalizePlan({ stockTop: 8, operations: [operation], warnings: [] }, settings, solid);
    const samples =
      probes ??
      Array.from({ length: 77 }, (_, i) => i * 1.3 + 0.4).flatMap(x =>
        Array.from({ length: 55 }, (_, i) => i * 1.3 + 0.4).flatMap(y => (centerFits(x, y, region, 3) ? [[x, y]] : []))
      );
    expect(samples.length).toBeGreaterThan(0);
    expect(Math.min(...plan.operations[0]!.passes.flatMap(pass => pass.pts.map(point => point[2])))).toBe(2.3);
    for (const arcs of [false, true]) {
      const distance = postedFloorDistance(toGcode(plan, { arcs }), 2.3);
      for (const [x, y] of samples) expect(distance(x!, y!), `${name} floor gap at ${x},${y}, arcs=${arcs}`).toBeLessThanOrEqual(3.01);
      if (name === 'protected island')
        for (const [x, y] of [
          [24.1, 27],
          [49.9, 27],
          [37, 18.1],
          [37, 35.9],
        ])
          expect(distance(x!, y!), `retained island at ${x},${y}, arcs=${arcs}`).toBeGreaterThanOrEqual(3);
    }
  }
);

it('keeps the already-proved ordinary-default review pocket at 184 passes', () => {
  const operation = pocketOperation(
    'Ordinary review pocket',
    [rect(0, 0, 150, 120)],
    18,
    12,
    { number: 1, diameter: 3.175 },
    DEFAULT_SETTINGS
  );
  expect(operation.passes).toHaveLength(184);
});
