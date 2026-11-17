import { describe, expect, it } from 'vitest';
import { profileFeatures } from './cutFeatures';
import { camPart } from './toolpaths';
import type { Tool } from './toolpathTypes';
import { boardBits, camBoard, splitByBit } from './board';
import { toGcode } from './gcode';
import { freePartsProgram } from './tabPlan';

const circle = (cx: number, cy: number, r: number) =>
  Array.from({ length: 256 }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / 256), y: cy + r * Math.sin((2 * Math.PI * i) / 256) }));

/** A cup: a Ø77.8 × 20 cylinder with a Ø67.2 pocket 16 deep, both edges of its rim rounded over by 1 mm. */
function cup(radius = 1) {
  const outline = circle(0, 0, 38.9),
    opening = circle(0, 0, 33.6);
  const { features, offset } = profileFeatures({
    thickness: 20,
    outline,
    holes: [],
    cuts: [{ id: 'pocket', side: 'top', from: 0, to: 16, through: false, outline: opening, islands: [] }],
  });
  const moved = (points: typeof outline) => points.map(p => ({ x: p.x - offset.x, y: p.y - offset.y }));
  features.rounds = [
    { loop: moved(outline), z: 20, down: true, radius, material: 'inside' },
    { loop: moved(opening), z: 20, down: true, radius, material: 'outside' },
  ];
  return { features, centre: { x: -offset.x, y: -offset.y } };
}
const endMill: Tool = { number: 1, diameter: 6 };
const roundover: Tool = { number: 2, diameter: 6, shape: 'roundover', radius: 1, tipDiameter: 3, name: 'R1 roundover' };

describe('rounding over edges', () => {
  it('runs a roundover bit of the round’s radius around each rounded edge, at the round’s foot, first, while the part is whole', () => {
    const { features, centre } = cup();
    const cam = camPart(features, { tools: [endMill], roundoverBits: [roundover] });
    const names = cam.operations.map(op => op.name);
    expect(names.slice(0, 2)).toEqual(['Round over 1', 'Round over 2']);
    expect(cam.operations.at(-1)!.feature).toBe('outline');
    const [outer, inner] = cam.operations.slice(0, 2);
    for (const op of [outer!, inner!]) {
      expect(op.tool).toBe(roundover);
      expect(op.passes).toHaveLength(1);
      expect(new Set(op.passes[0]!.pts.map(p => +p[2].toFixed(6)))).toEqual(new Set([19]));
    }
    // The tip's radius off each wall, in the waste: outside the outline, inside the pocket's opening.
    const reach = (op: typeof outer) => op!.passes[0]!.pts.map(p => Math.hypot(p[0] - centre.x, p[1] - centre.y));
    for (const r of reach(outer)) expect(r).toBeCloseTo(38.9 + 1.5, 1);
    for (const r of reach(inner)) expect(r).toBeCloseTo(33.6 - 1.5, 1);
    // Its own program before the end mill's, naming the bit in its tool table: one bit swap in all.
    const programs = splitByBit(cam);
    expect(programs.map(program => program.operations[0]!.tool.number)).toEqual([2, 1]);
    expect(toGcode(programs[0]!)).toContain('ROUNDOVER R=1');
  });

  it('leaves an edge sharp, and says so, without a roundover bit of its radius', () => {
    const { features } = cup();
    const cam = camPart(features, { tools: [endMill], roundoverBits: [{ ...roundover, radius: 2, diameter: 8 }] });
    expect(cam.operations.some(op => op.tool.shape === 'roundover')).toBe(false);
    expect(cam.warnings.filter(w => /no 1 mm roundover bit/.test(w))).toHaveLength(2);
  });

  it('finishes a round no roundover bit fits with a ball end, in laps from the face down, both sides of the rim together', () => {
    const { features, centre } = cup();
    const ball: Tool = { number: 21, diameter: 6, shape: 'ball', name: 'ball end mill ⌀6' };
    const cam = camPart(features, { tools: [endMill], roundBall: ball });
    const rounds = cam.operations.filter(op => op.tool === ball);
    // One operation, first in the job: the rim's two rounds lap by lap, outside then inside.
    expect(rounds.map(op => op.name)).toEqual(['Round over 1 + Round over 2']);
    expect(cam.operations[0]).toBe(rounds[0]);
    const [op] = rounds;
    expect(op!.title).toBe('R1 round, ball end ⌀6 ×2');
    const outer = op!.passes.filter((_, i) => i % 2 === 0),
      inner = op!.passes.filter((_, i) => i % 2 === 1);
    for (const laps of [outer, inner]) {
      // From the face down to beside the wall, with the ball's tip 4 mm down (radius 1 plus the ball's 3).
      const tips = laps.map(pass => pass.pts[0]![2]);
      expect(tips[0]).toBeCloseTo(20, 6);
      expect(tips.at(-1)).toBeCloseTo(20 - 1 - 3, 6);
      // Each lap deeper, by at most a quarter of the ball's diameter: the first laps cut its full width in solid stock.
      for (let i = 1; i < tips.length; i++) {
        expect(tips[i]!).toBeLessThan(tips[i - 1]!);
        expect(tips[i - 1]! - tips[i]!).toBeLessThanOrEqual(6 / 4 + 1e-9);
      }
      expect(laps.length).toBeGreaterThan(4);
    }
    // At the first laps the ball's tip sits where each round meets the face: 1 mm in from each edge.
    const reach = (pass: (typeof outer)[number]) => pass.pts.map(p => Math.hypot(p[0] - centre.x, p[1] - centre.y));
    for (const r of reach(outer[0]!)) expect(r).toBeCloseTo(38.9 - 1, 1);
    for (const r of reach(inner[0]!)) expect(r).toBeCloseTo(33.6 + 1, 1);
    expect(cam.warnings.some(w => /roundover bit/.test(w))).toBe(false);
    expect(toGcode(splitByBit(cam)[0]!)).toContain('CR=3');
  });

  it('leaves both rims of the cup rounded, within a few hundredths of the round, once every cut is simulated', () => {
    const r = 2,
      ballR = 3;
    const { features, centre } = cup(r);
    const ball: Tool = { number: 21, diameter: 2 * ballR, shape: 'ball', name: 'ball end mill ⌀6' };
    const cam = camPart(features, { tools: [endMill], roundBall: ball });
    // The stock's height along a ray out from the cup's centre: the lowest any tool reaches there, by its shape.
    const segments = cam.operations.flatMap(op =>
      op.passes.flatMap(pass => pass.pts.slice(1).map((b, i) => ({ a: pass.pts[i]!, b, tool: op.tool })))
    );
    const height = (rho: number) => {
      const px = centre.x + rho,
        py = centre.y;
      let z = 20;
      for (const { a, b, tool } of segments) {
        const radius = tool.diameter / 2;
        if (Math.min(a[1], b[1]) - radius > py || Math.max(a[1], b[1]) + radius < py) continue;
        for (let k = 0; k <= 8; k++) {
          const x = a[0] + ((b[0] - a[0]) * k) / 8,
            y = a[1] + ((b[1] - a[1]) * k) / 8,
            tz = a[2] + ((b[2] - a[2]) * k) / 8;
          const d = Math.hypot(x - px, y - py);
          if (d > radius) continue;
          z = Math.min(z, tool.shape === 'ball' ? tz + radius - Math.sqrt(radius * radius - d * d) : tz);
        }
      }
      return z;
    };
    // The round's own surface: flat up to r in from the edge, then a quarter circle down to the edge.
    const ideal = (rho: number, edge: number, inward: 1 | -1) => {
      const into = inward * (edge - rho);
      return into >= r ? 20 : 20 - r + Math.sqrt(Math.max(0, r * r - (r - into) ** 2));
    };
    let worst = 0;
    for (const [edge, inward] of [
      [38.9, 1],
      [33.6, -1],
    ] as const)
      for (let into = 0.05; into <= r + 0.5; into += 0.02) {
        const rho = edge - inward * into;
        const err = Math.abs(height(rho) - ideal(rho, edge, inward));
        worst = Math.max(worst, err);
      }
    expect(worst).toBeLessThan(0.05);
  });

  it('on a board, rounds first, from the face down, so the job swaps bits once less', () => {
    const { features } = cup();
    const ball: Tool = { number: 21, diameter: 6, shape: 'ball', name: 'ball end mill ⌀6' };
    const flat8: Tool = { number: 2, diameter: 8, name: 'flat end mill 8' };
    const cam = camBoard(
      {
        id: 'b',
        name: 'Board',
        w: 140,
        h: 140,
        thickness: 20,
        holdDown: 'fixture-tape',
        parts: [{ id: 'cup', name: 'cup', features, size: [77.8, 77.8, 20], x: 20, y: 20, rotated: false }],
      },
      { tools: [flat8, endMill], roundBall: ball }
    );
    const kinds = cam.operations.map(op => (op.tool === ball ? 'round' : op.feature === 'outline' ? 'outline' : 'inner'));
    expect(kinds[0]).toBe('round');
    expect(kinds.slice(1).includes('round')).toBe(false);
    expect(kinds.at(-1)).toBe('outline');
    // The ball, then the one flat bit: a single swap.
    expect(splitByBit(cam).map(program => program.operations[0]!.tool)).toEqual([ball, flat8]);
    // The ball has a program of its own, named apart from a flat bit of its size.
    const programs = splitByBit(cam);
    expect(programs.some(program => program.operations[0]!.tool === ball)).toBe(true);
    expect(boardBits(cam).length).toBe(programs.length);
  });

  it('with a bottom skin, cuts the parts free with the flat bit only: a round is no outline', () => {
    const { features } = cup();
    const ball: Tool = { number: 21, diameter: 6, shape: 'ball', name: 'ball end mill ⌀6' };
    const cam = camBoard(
      {
        id: 'b',
        name: 'Board',
        w: 140,
        h: 140,
        thickness: 20,
        holdDown: 'skin',
        parts: [{ id: 'cup', name: 'cup', features, size: [77.8, 77.8, 20], x: 20, y: 20, rotated: false }],
      },
      { tools: [endMill], roundBall: ball }
    );
    const free = freePartsProgram(cam, { feed: 1000, plungeFeed: 300, finalZ: -0.3 });
    expect(free.cam.operations.length).toBeGreaterThan(0);
    expect(free.cam.operations.every(op => op.tool === endMill)).toBe(true);
    expect(() => toGcode(free.cam)).not.toThrow();
  });

  it('never uses a roundover bit for pockets or outlines', () => {
    const { features } = cup();
    expect(() => camPart(features, { tools: [endMill, roundover] })).toThrow(/roundoverBits/);
  });
});
