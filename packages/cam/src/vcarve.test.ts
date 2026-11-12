import { describe, expect, it } from 'vitest';
import { camBoard, splitByBit, type BoardSpec } from './board';
import { distPointSeg, type PathsD } from './geom';
import { toGcode } from './gcode';
import { planBoard } from './plan';
import { toolIdentityKey } from './toolIdentity';
import type { Tool } from './toolpaths';
import { CamInputError } from './validation';
import { carvingOperations, carvingWork, vConeDepth, vSlope, type BoardCarving } from './vcarve';

const V90: Tool = { number: 3, diameter: 6, name: '90° V-bit', shape: 'v', angle: 90 };
const V60: Tool = { number: 4, diameter: 8, name: '60° V-bit', shape: 'v', angle: 60 };
const FLAT: Tool = { number: 1, diameter: 3.175, name: 'flat end mill 1/8"' };

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A bar `w` wide and 60 long, at (20, 20) on the board. */
const bar = (w: number): PathsD => [rect(20, 20, 80, 20 + w)];

/** Distance from a point to the artwork's outline. */
function toOutline(region: PathsD, x: number, y: number): number {
  let d = Infinity;
  for (const loop of region)
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length];
      d = Math.min(d, distPointSeg(x, y, a.x, a.y, b.x, b.y));
    });
  return d;
}

const carving = (region: PathsD, more: Partial<BoardCarving> = {}): BoardCarving => ({
  id: 'c1',
  name: 'Sign',
  region,
  tool: V90,
  maxDepth: 6,
  ...more,
});

describe('V-bits', () => {
  it('cut a stroke thinner than two ring steps along its centre line, as deep as it is wide', () => {
    // 0.3 mm wide: it closes up before the first ring, 0.2 mm in.
    const operations = carvingOperations(carving(bar(0.3)), 18);
    const points = operations.flatMap(op => op.passes.flatMap(pass => pass.pts));
    expect(points.length).toBeGreaterThan(0);
    // On the centre line, 0.15 mm in from each side, and a 90° bit there is 0.15 mm deep.
    for (const [x, y, z] of points) {
      expect(toOutline(bar(0.3), x, y)).toBeGreaterThan(0.13);
      expect(18 - z).toBeLessThanOrEqual(0.15 + 1e-6);
    }
    expect(Math.min(...points.map(p => p[2]))).toBeCloseTo(18 - 0.15, 1);
  });

  it('leave the hole of a thin island alone when the island sits in another outline’s hole', () => {
    // A ring with a 0.3 mm square inside its hole, and a 0.2 mm square hole in that.
    const square = (cx: number, cy: number, half: number) => rect(cx - half, cy - half, cx + half, cy + half);
    const region: PathsD = [
      square(50, 50, 20),
      [...square(50, 50, 10)].reverse(),
      square(50, 50, 0.15),
      [...square(50, 50, 0.1)].reverse(),
    ];
    const points = carvingOperations(carving(region), 18).flatMap(op => op.passes.flatMap(pass => pass.pts));
    // Nothing inside the small hole.
    expect(points.filter(([x, y]) => Math.abs(x - 50) < 0.1 && Math.abs(y - 50) < 0.1)).toEqual([]);
  });

  it('cut deeper by 1 / tan(half the angle) per mm wider, down to the top of the cone', () => {
    expect(vSlope(V90)).toBeCloseTo(1);
    expect(vSlope(V60)).toBeCloseTo(Math.sqrt(3));
    expect(vConeDepth(V90)).toBeCloseTo(3);
    expect(vConeDepth(V60)).toBeCloseTo(4 * Math.sqrt(3));
    expect(vConeDepth({ ...V90, tipDiameter: 0.2 })).toBeCloseTo(2.9);
  });

  it('are another tool than a flat bit of the same diameter, and flat bits keep their saved identity', () => {
    const flat6: Tool = { number: 3, diameter: 6 };
    expect(toolIdentityKey(flat6)).toBe(JSON.stringify([null, 3, 6, null, null, null]));
    expect(toolIdentityKey(V90)).not.toBe(toolIdentityKey(flat6));
    expect(toolIdentityKey(V90)).not.toBe(toolIdentityKey({ ...V90, angle: 60 }));
  });

  it("name their taper (half the angle) in the program's tool table", () => {
    const gcode = toGcode({ stockTop: 18, operations: carvingOperations(carving(bar(4)), 18), warnings: [] });
    expect(gcode.split('\n').find(line => line.includes('T3 D='))).toMatch(/T3 D=6 CR=0 TAPER=45deg - ZMIN=\S+ - 90° V-bit/);
  });

  it('need an angle', () => {
    expect(() => carvingOperations(carving(bar(4), { tool: { ...V90, angle: undefined } }), 18)).toThrow(CamInputError);
    expect(() => carvingOperations(carving(bar(4), { tool: FLAT }), 18)).toThrow(/V-bit/);
    expect(() => carvingOperations(carving(bar(4), { maxDepth: 18 }), 18)).toThrow(/less than the board/);
  });
});

describe('carvingOperations', () => {
  it('cuts a stroke to half its width deep with a 90° bit, never past the outline', () => {
    const region = bar(4);
    const ops = carvingOperations(carving(region), 18);
    expect(ops.map(o => o.kind)).toEqual(['vcarve']);
    const pts = ops[0].passes.flatMap(p => p.pts);
    expect(Math.min(...pts.map(q => q[2]))).toBeCloseTo(18 - 2, 1);
    for (const [x, y, z] of pts) {
      // The cone is (18 - z) wide each side at the surface: it reaches the outline and no further.
      expect(toOutline(region, x, y) + 1e-3).toBeGreaterThanOrEqual((18 - z) / vSlope(V90));
      expect(z).toBeLessThan(18);
    }
    expect(ops[0].warnings).toBeUndefined();
  });

  it('cuts a straight wall with its deepest ring alone, deep grooves in steps', () => {
    const passes = carvingOperations(carving(bar(6), { tool: V60, maxDepth: 6 }), 18)[0].passes;
    // The bar's centre line, 3 × √3 = 5.2 deep, in four steps no deeper than 1.5 mm.
    const depths = new Set(passes.flatMap(p => p.pts.map(q => +(18 - q[2]).toFixed(1))));
    for (const step of [1.3, 2.6, 3.9, 5.2]) expect(depths).toContain(step);
    expect(Math.max(...depths)).toBe(5.2);
    // Shallower rings only where the bar's ends round off: the whole job is a few times the centre line's length.
    const length = passes.reduce(
      (s, p) => s + p.pts.slice(1).reduce((t, q, i) => t + Math.hypot(q[0] - p.pts[i][0], q[1] - p.pts[i][1]), 0),
      0
    );
    expect(length).toBeLessThan(5 * 2 * 60);
    // Joined up: the bit lifts out only a few times.
    expect(passes.length).toBeLessThan(6);
  });

  it('leaves the hole of an "o" uncut', () => {
    const ring: PathsD = [rect(20, 20, 40, 40), rect(24, 24, 36, 36).reverse()];
    const [op] = carvingOperations(carving(ring), 18);
    for (const [x, y] of op.passes.flatMap(p => p.pts)) expect(x > 24 && x < 36 && y > 24 && y < 36).toBe(false);
    // The stroke is 4 wide along the sides; the corners, where the widest circle touches the hole's corner, go deepest.
    const corner = (20 + 24 * Math.SQRT2) / (1 + Math.SQRT2) - 20;
    expect(Math.min(...op.passes.flatMap(p => p.pts.map(q => q[2])))).toBeCloseTo(18 - corner, 1);
  });

  it('gives wider strokes a flat bottom at the depth limit, cleared first by the flat bit', () => {
    const ops = carvingOperations(carving(bar(12), { maxDepth: 2, clearTool: FLAT }), 18);
    expect(ops.map(o => [o.kind, o.tool.name])).toEqual([
      ['pocket', FLAT.name],
      ['vcarve', V90.name],
    ]);
    const [clear, v] = ops;
    expect(Math.min(...clear.passes.flatMap(p => p.pts.map(q => q[2])))).toBeCloseTo(16);
    expect(Math.min(...v.passes.flatMap(p => p.pts.map(q => q[2])))).toBeCloseTo(16);
    expect(v.warnings?.[0]).toMatch(/flat bottom at 2\.0 mm/);
    // The flat bit stays inside the flat bottom (2 in from the outline, at 2 deep with a 90° bit).
    for (const [x, y] of clear.passes.flatMap(p => p.pts))
      expect(toOutline(bar(12), x, y)).toBeGreaterThanOrEqual(2 + FLAT.diameter / 2 - 0.01);
  });

  it('stops at the top of the cone when the depth limit is deeper than the bit can cut', () => {
    const [v] = carvingOperations(carving(bar(12)), 18);
    expect(Math.min(...v.passes.flatMap(p => p.pts.map(q => q[2])))).toBeCloseTo(15);
    expect(v.warnings?.[0]).toMatch(/cone is only 3\.0 mm deep/);
  });

  it('clears a flat bottom with the V-bit alone when there is no flat bit', () => {
    const ops = carvingOperations(carving(bar(12), { maxDepth: 2 }), 18);
    expect(ops.map(o => o.kind)).toEqual(['vcarve']);
    const floor = ops[0].passes.flatMap(p => p.pts.filter(q => q[2] === 16));
    const length = floor.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - floor[i][0], q[1] - floor[i][1]), 0);
    // Rings right across the 8 mm flat bottom, a tenth of a mm apart, joined at the floor without lifting.
    expect(length).toBeGreaterThan(40 * 2 * 52);
    // Without lifting between the rings at the floor.
    expect(ops[0].passes.length).toBeLessThanOrEqual(4);
  });

  it('uses the V-bit where the flat bottom is too narrow for the flat bit', () => {
    const ops = carvingOperations(carving(bar(6), { maxDepth: 2, clearTool: { ...FLAT, diameter: 6 } }), 18);
    expect(ops.map(o => o.kind)).toEqual(['vcarve']);
  });
});

/** Deepest the passes cut at (x, y), with the V-bit's cone; ramps between depths followed in 0.02 mm steps. */
function cutDepth(passes: { pts: number[][] }[], x: number, y: number, top: number, slope: number): number {
  let best = 0;
  for (const { pts } of passes)
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i],
        b = pts[Math.min(i + 1, pts.length - 1)];
      if (a[2] === b[2]) {
        best = Math.max(best, top - a[2] - distPointSeg(x, y, a[0], a[1], b[0], b[1]) * slope);
        continue;
      }
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const d = top - (a[2] + (b[2] - a[2]) * t) - Math.hypot(x - a[0] - (b[0] - a[0]) * t, y - a[1] - (b[1] - a[1]) * t) * slope;
        if (d > best) best = d;
      }
    }
  return best;
}

describe('the carved surface', () => {
  const L: PathsD = [
    [
      { x: 0, y: 0 },
      { x: 14, y: 0 },
      { x: 14, y: 4 },
      { x: 5, y: 4 },
      { x: 5, y: 20 },
      { x: 0, y: 20 },
    ],
  ];
  const O: PathsD = [rect(0, 0, 16, 16), rect(4, 4, 12, 12).reverse()];
  for (const [name, region] of [
    ['an L with strokes 4 and 5 wide', L],
    ['an O', O],
  ] as const)
    it(`is cut to depth everywhere in ${name}, never past it`, () => {
      const [op] = carvingOperations(carving(region), 18);
      let worst = 0;
      for (let x = 0.1; x < 16; x += 0.25)
        for (let y = 0.1; y < 20; y += 0.25) {
          const target = Math.min(3, toOutline(region, x, y) * vSlope(V90));
          const cut = cutDepth(op.passes, x, y, 18, vSlope(V90));
          if (toOutline(region, x, y) < 0.05) continue;
          // Points outside the artwork are not cut at all.
          const isInside = name === 'an O' ? !(x > 4 && x < 12 && y > 4 && y < 12) && x < 16 && y < 16 : x < 5 || y < 4;
          if (!isInside || (name !== 'an O' && x > 14) || (name === 'an O' && y > 16)) {
            expect(cut).toBeLessThan(0.02);
            continue;
          }
          expect(cut).toBeLessThan(target + 0.02);
          worst = Math.max(worst, target - cut);
        }
      // Ridges where the strokes narrow: no higher than a ring step.
      expect(worst).toBeLessThan(0.25);
    });
});

describe('carvings on a board', () => {
  const board = (carvings: BoardCarving[]): BoardSpec => ({
    id: 'b',
    name: 'A',
    w: 100,
    h: 60,
    thickness: 18,
    holdDown: 'none',
    taped: true,
    parts: [],
    carvings,
  });

  it('make one program per bit: the flat bit, then the V-bit', () => {
    const cam = camBoard(board([carving(bar(12), { maxDepth: 2, clearTool: FLAT })]), {});
    const programs = splitByBit(cam);
    expect(programs.map(p => p.operations[0].tool.name)).toEqual([FLAT.name, V90.name]);
    expect(cam.warnings[0]).toMatch(/^Sign: Strokes wider/);
  });

  it('plan without parts, safely, and say what each step cuts', () => {
    const plan = planBoard(
      {
        id: 'b',
        name: 'A',
        w: 100,
        h: 60,
        thickness: 18,
        stockTop: 18,
        holdDown: 'none',
        taped: true,
        tabs: { width: 6, height: 3, minCount: 2 },
        parts: [],
        carvings: [carving(bar(12), { maxDepth: 2, clearTool: FLAT })],
      },
      {},
      {
        part: () => {
          throw new Error('no parts');
        },
        underside: () => {
          throw new Error('no parts');
        },
      }
    );
    expect(plan.safety).toEqual([]);
    expect(plan.programs.map(p => p.tool)).toEqual([FLAT.number, V90.number]);
    expect(plan.ops.map(o => o.kind)).toEqual(['pocket', 'vcarve']);
    expect(plan.ops.find(o => o.kind === 'vcarve')?.tool).toMatchObject({ shape: 'v', angle: 90 });
    expect(plan.timeMin).toBeGreaterThan(0);
  });
});

describe('carvingWork', () => {
  // A 90° bit to 2 mm deep: 11 wall rings out to 2 mm, then floor rings 0.1 mm apart out to where the artwork closes up.
  const floorRings = (region: PathsD) => {
    const points = region.reduce((sum, loop) => sum + loop.length, 0);
    return (carvingWork(carving(region, { maxDepth: 2 })) - 1) / (0.07 * points) - 11;
  };
  it('counts the floor rings out to where the widest stroke closes up, found by searching outward from the walls', () => {
    expect(floorRings(bar(1))).toBe(0);
    // A 10 mm bar closes up 5 mm in: 30 floor rings, found to within four of them.
    expect(floorRings(bar(10))).toBeGreaterThanOrEqual(26);
    expect(floorRings(bar(10))).toBeLessThanOrEqual(31);
    // A 40 mm wide panel closes up 20 mm in, as far as half the artwork's size: 180 rings.
    expect(floorRings([rect(0, 0, 60, 40)])).toBeGreaterThanOrEqual(176);
    expect(floorRings([rect(0, 0, 60, 40)])).toBeLessThanOrEqual(181);
  });
});
