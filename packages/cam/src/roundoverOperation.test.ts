import { describe, expect, it } from 'vitest';
import { profileFeatures } from './cutFeatures';
import { camPart } from './toolpaths';
import type { Tool } from './toolpathTypes';
import { boardBits, camBoard, splitByBit } from './board';
import { toGcode } from './gcode';

const circle = (cx: number, cy: number, r: number) =>
  Array.from({ length: 256 }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / 256), y: cy + r * Math.sin((2 * Math.PI * i) / 256) }));

/** A cup: a Ø77.8 × 20 cylinder with a Ø67.2 pocket 16 deep, both edges of its rim rounded over by 1 mm. */
function cup() {
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
    { loop: moved(outline), z: 20, down: true, radius: 1, material: 'inside' },
    { loop: moved(opening), z: 20, down: true, radius: 1, material: 'outside' },
  ];
  return { features, centre: { x: -offset.x, y: -offset.y } };
}
const endMill: Tool = { number: 1, diameter: 6 };
const roundover: Tool = { number: 2, diameter: 6, shape: 'roundover', radius: 1, tipDiameter: 3, name: 'R1 roundover' };

describe('rounding over edges', () => {
  it('runs a roundover bit of the round’s radius around each rounded edge, at the round’s foot, after the pocket and before the outline', () => {
    const { features, centre } = cup();
    const cam = camPart(features, { tools: [endMill], roundoverBits: [roundover] });
    const names = cam.operations.map(op => op.name);
    expect(names.slice(-3, -1)).toEqual(['Round over 1', 'Round over 2']);
    expect(cam.operations.at(-1)!.feature).toBe('outline');
    expect(cam.operations.slice(0, -3).every(op => op.feature !== 'outline')).toBe(true);
    const [outer, inner] = cam.operations.slice(-3, -1);
    for (const op of [outer!, inner!]) {
      expect(op.tool).toBe(roundover);
      expect(op.passes).toHaveLength(1);
      expect(new Set(op.passes[0]!.pts.map(p => +p[2].toFixed(6)))).toEqual(new Set([19]));
    }
    // The tip's radius off each wall, in the waste: outside the outline, inside the pocket's opening.
    const reach = (op: typeof outer) => op!.passes[0]!.pts.map(p => Math.hypot(p[0] - centre.x, p[1] - centre.y));
    for (const r of reach(outer)) expect(r).toBeCloseTo(38.9 + 1.5, 1);
    for (const r of reach(inner)) expect(r).toBeCloseTo(33.6 - 1.5, 1);
    // Its own program between the end mill's pocket and outline, naming the bit in its tool table.
    const programs = splitByBit(cam);
    expect(programs.map(program => program.operations[0]!.tool.number)).toEqual([1, 2, 1]);
    expect(toGcode(programs[1]!)).toContain('ROUNDOVER R=1');
  });

  it('leaves an edge sharp, and says so, without a roundover bit of its radius', () => {
    const { features } = cup();
    const cam = camPart(features, { tools: [endMill], roundoverBits: [{ ...roundover, radius: 2, diameter: 8 }] });
    expect(cam.operations.some(op => op.tool.shape === 'roundover')).toBe(false);
    expect(cam.warnings.filter(w => /no 1 mm roundover bit/.test(w))).toHaveLength(2);
  });

  it('finishes a round no roundover bit fits with a ball end, in laps from the face down to the wall', () => {
    const { features, centre } = cup();
    const ball: Tool = { number: 21, diameter: 6, shape: 'ball', name: 'ball end mill ⌀6' };
    const cam = camPart(features, { tools: [endMill], roundBall: ball });
    const rounds = cam.operations.filter(op => op.tool === ball);
    expect(rounds.map(op => op.name)).toEqual(['Round over 1', 'Round over 2']);
    expect(cam.operations.slice(-3, -1)).toEqual(rounds);
    for (const op of rounds) {
      // From the face, each lap deeper, down to beside the wall with the ball's tip 4 mm down (radius 1 plus the ball's 3).
      const tips = op.passes.map(pass => pass.pts[0]![2]);
      expect(tips[0]).toBeCloseTo(20, 6);
      expect(tips.at(-1)).toBeCloseTo(20 - 1 - 3, 6);
      for (let i = 1; i < tips.length; i++) expect(tips[i]!).toBeLessThan(tips[i - 1]!);
      expect(op.passes.length).toBeGreaterThan(4);
    }
    // At the first lap the ball's tip sits where the round meets the face: 1 mm in from each edge.
    const reach = (op: (typeof rounds)[number]) => op.passes[0]!.pts.map(p => Math.hypot(p[0] - centre.x, p[1] - centre.y));
    for (const r of reach(rounds[0]!)) expect(r).toBeCloseTo(38.9 - 1, 1);
    for (const r of reach(rounds[1]!)) expect(r).toBeCloseTo(33.6 + 1, 1);
    expect(cam.warnings.some(w => /roundover bit/.test(w))).toBe(false);
    expect(toGcode(splitByBit(cam).at(-2)!)).toContain('CR=3');
  });

  it('on a board, rounds once every pocket is cut and before the outlines cut the parts loose', () => {
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
    const firstRound = kinds.indexOf('round'),
      lastRound = kinds.lastIndexOf('round');
    expect(firstRound).toBeGreaterThan(0);
    expect(kinds.slice(0, firstRound).every(k => k === 'inner')).toBe(true);
    expect(kinds.slice(firstRound, lastRound + 1).every(k => k === 'round')).toBe(true);
    expect(kinds.slice(lastRound + 1).every(k => k === 'outline')).toBe(true);
    expect(kinds.at(-1)).toBe('outline');
    // The ball has a program of its own, named apart from a flat bit of its size.
    const programs = splitByBit(cam);
    expect(programs.some(program => program.operations[0]!.tool === ball)).toBe(true);
    expect(boardBits(cam).length).toBe(programs.length);
  });

  it('never uses a roundover bit for pockets or outlines', () => {
    const { features } = cup();
    expect(() => camPart(features, { tools: [endMill, roundover] })).toThrow(/roundoverBits/);
  });
});
