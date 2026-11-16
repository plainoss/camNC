import { describe, expect, it } from 'vitest';
import { profileFeatures } from './cutFeatures';
import { camPart } from './toolpaths';
import type { Tool } from './toolpathTypes';
import { splitByBit } from './board';
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
  it('runs a roundover bit of the round’s radius around each rounded edge, at the round’s foot, after everything else', () => {
    const { features, centre } = cup();
    const cam = camPart(features, { tools: [endMill], roundoverBits: [roundover] });
    const names = cam.operations.map(op => op.name);
    expect(names.slice(-2)).toEqual(['Round over 1', 'Round over 2']);
    const [outer, inner] = cam.operations.slice(-2);
    for (const op of [outer!, inner!]) {
      expect(op.tool).toBe(roundover);
      expect(op.passes).toHaveLength(1);
      expect(new Set(op.passes[0]!.pts.map(p => +p[2].toFixed(6)))).toEqual(new Set([19]));
    }
    // The tip's radius off each wall, in the waste: outside the outline, inside the pocket's opening.
    const reach = (op: typeof outer) => op!.passes[0]!.pts.map(p => Math.hypot(p[0] - centre.x, p[1] - centre.y));
    for (const r of reach(outer)) expect(r).toBeCloseTo(38.9 + 1.5, 1);
    for (const r of reach(inner)) expect(r).toBeCloseTo(33.6 - 1.5, 1);
    // Its own program, after the end mill's, naming the bit in its tool table.
    const programs = splitByBit(cam);
    expect(programs.map(program => program.operations[0]!.tool.number)).toEqual([1, 2]);
    expect(toGcode(programs[1]!)).toContain('ROUNDOVER R=1');
  });

  it('leaves an edge sharp, and says so, without a roundover bit of its radius', () => {
    const { features } = cup();
    const cam = camPart(features, { tools: [endMill], roundoverBits: [{ ...roundover, radius: 2, diameter: 8 }] });
    expect(cam.operations.some(op => op.tool.shape === 'roundover')).toBe(false);
    expect(cam.warnings.filter(w => /no 1 mm roundover bit/.test(w))).toHaveLength(2);
  });

  it('never uses a roundover bit for pockets or outlines', () => {
    const { features } = cup();
    expect(() => camPart(features, { tools: [endMill, roundover] })).toThrow(/roundoverBits/);
  });
});
