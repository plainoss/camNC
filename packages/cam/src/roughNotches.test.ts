import { describe, expect, it } from 'vitest';
import type { PathD } from 'clipper2-ts';
import { profileOperation, DEFAULT_SETTINGS, type Pass } from './toolpaths';

const tool = { number: 1, diameter: 6 };
const settings = { ...DEFAULT_SETTINGS, leaveStock: 0.1, finalZ: -0.3 };

/** A 100×50 outline with a notch `width` wide and 10 deep in its top edge, centred at x = 50. */
function notched(width: number): PathD {
  const [a, b] = [50 - width / 2, 50 + width / 2];
  return [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: b, y: 50 },
    { x: b, y: 40 },
    { x: a, y: 40 },
    { x: a, y: 50 },
    { x: 0, y: 50 },
  ];
}

/** How deep into the notch (below its mouth at y = 50) the bit's middle gets in these passes. */
const reach = (passes: Pass[]) =>
  50 - Math.min(...passes.flatMap(p => p.pts.filter(q => Math.abs(q[0] - 50) < 1 && q[1] > 25).map(q => q[1])));
const phase = (passes: Pass[], which: Pass['phase']) => passes.filter(p => p.phase === which);

describe('roughing a notch just wider than the bit (#910)', () => {
  it('roughs a 6.1 mm slot with a ⌀6 bit and 0.1 mm allowance, so the finish pass no longer slots it', () => {
    const op = profileOperation('outline', notched(6.1), 8, tool, settings);
    const [rough, finish] = [phase(op.passes, 'rough'), phase(op.passes, 'finish')];
    expect(rough.length).toBeGreaterThan(1);
    expect(finish.length).toBeGreaterThan(0);
    // Both reach the notch's floor less the bit's radius: 10 − 3 = 7 mm in.
    expect(reach(finish)).toBeCloseTo(7, 1);
    expect(reach(rough)).toBeCloseTo(7, 1);
    // Every roughing lap enters it, not just one.
    for (const p of rough.filter(p => p.entry === undefined)) expect(reach([p])).toBeGreaterThan(6.9);
    // Roughing never cuts past the final wall: no point is nearer the notch floor than the bit's radius.
    for (const p of rough) for (const q of p.pts) if (Math.abs(q[0] - 50) < 1 && q[1] > 25) expect(q[1]).toBeGreaterThanOrEqual(43 - 1e-3);
  });

  it('keeps the allowance along the walls and in an ordinary notch', () => {
    // A notch wide enough for the allowance: roughing stays the allowance off its floor.
    const wide = profileOperation('outline', notched(10), 8, tool, settings);
    expect(reach(phase(wide.passes, 'rough'))).toBeCloseTo(6.9, 1);
    // Away from the notch, roughing runs the allowance off the outline (bottom edge at y = 0).
    const op = profileOperation('outline', notched(6.1), 8, tool, settings);
    const bottom = phase(op.passes, 'rough').flatMap(p => p.pts.filter(q => q[0] > 10 && q[0] < 90 && q[1] < 25).map(q => q[1]));
    expect(Math.max(...bottom)).toBeCloseTo(-3.1, 2);
  });

  it('roughs a hole’s notch just wider than the bit the same way', () => {
    // A 30×30 hole with a 6.1 mm notch 10 deep in its top wall.
    const hole: PathD = [
      { x: 35, y: 10 },
      { x: 65, y: 10 },
      { x: 65, y: 40 },
      { x: 53.05, y: 40 },
      { x: 53.05, y: 50 },
      { x: 46.95, y: 50 },
      { x: 46.95, y: 40 },
      { x: 35, y: 40 },
    ];
    const op = profileOperation('hole', hole, 8, tool, settings, true);
    const top = (passes: Pass[]) =>
      Math.max(...passes.flatMap(p => p.pts.filter(q => Math.abs(q[0] - 50) < 1 && q[1] > 25).map(q => q[1])));
    expect(top(phase(op.passes, 'finish'))).toBeCloseTo(47, 1);
    expect(top(phase(op.passes, 'rough'))).toBeCloseTo(47, 1);
  });
});
