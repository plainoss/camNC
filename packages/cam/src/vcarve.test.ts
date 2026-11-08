import { describe, expect, it } from 'vitest';
import { camBoard, splitByBit, type BoardSpec } from './board';
import { distPointSeg, type PathsD } from './geom';
import { toGcode } from './gcode';
import { planBoard } from './plan';
import { toolIdentityKey } from './toolIdentity';
import type { Tool } from './toolpaths';
import { CamInputError } from './validation';
import { carvingOperations, vConeDepth, vSlope, type BoardCarving } from './vcarve';

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

  it('works from the outline inwards: the shallowest ring first', () => {
    const [op] = carvingOperations(carving(bar(4)), 18);
    const zs = op.passes.map(p => p.pts[0][2]);
    expect(zs).toEqual([...zs].sort((a, b) => b - a));
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
    const floor = ops[0].passes.filter(p => p.pts[0][2] === 16);
    // Rings right across the 8 mm flat bottom, a tenth of a mm apart.
    expect(floor.length).toBeGreaterThan(30);
  });

  it('uses the V-bit where the flat bottom is too narrow for the flat bit', () => {
    const ops = carvingOperations(carving(bar(6), { maxDepth: 2, clearTool: { ...FLAT, diameter: 6 } }), 18);
    expect(ops.map(o => o.kind)).toEqual(['vcarve']);
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
