import { describe, expect, it } from 'vitest';
import { editCad } from './index';

describe('report sizes', () => {
  it.each(['top', 'underside'] as const)('measures circles and arcs exactly on %s', async side => {
    const { report } = await editCad(null, d => {
      const part = d.part('Panel', { thickness: 18 });
      part.profile.rect({ at: [0, 0], w: 200, h: 150 });
      const sketch = part.sketchOn(side);
      const x = side === 'underside' ? -100 : 100;
      sketch.circle({ at: [x, 40], d: 35 });
      part.cut(sketch.regionAt(x, 40), { depth: 12 });
      sketch
        .path([x - 20, 80])
        .lineTo([x + 20, 80])
        .arcTo([x + 20, 90], { tangent: true })
        .lineTo([x - 20, 90])
        .arcTo([x - 20, 80], { tangent: true })
        .close();
      part.cut(sketch.regionAt(x, 85), { depth: 5 });
    });
    expect(report.errors).toEqual([]);
    expect(report.parts[0]!.cuts).toMatchObject([
      { side, at: [82.5, 22.5], size: [35, 35] },
      { side, at: [75, 80], size: [50, 10] },
    ]);
  });
});

describe('report pieces', () => {
  it('lists copies a tool reaches differently with the rest of the part', async () => {
    const { report } = await editCad(null, d => {
      const panel = d.part('Panel', { thickness: 18 });
      panel.profile.rect({ at: [0, 0], w: 200, h: 100 });
      panel.place({ at: [0, 0, 0] });
      panel.copy({ at: [0, 0, 100] });
      panel.copy({ at: [1000, 0, 0] });
      const pin = d.part('Pin', { thickness: 18 });
      pin.profile.rect({ at: [0, 0], w: 20, h: 20 });
      pin.place({ at: [90, 40, 10] });
      d.cutParts(panel, { with: [pin], clearance: 0 });
    });
    expect(report.errors).toEqual([]);
    expect(report.parts[0]!.pieces).toEqual({ names: ['Panel', 'Panel 2', 'Panel 3'], mirrored: [] });
  });
});

describe('report holes', () => {
  it('counts profile holes and through cuts, including pattern copies and floor cuts, once each', async () => {
    const { report } = await editCad(null, d => {
      const part = d.part('Panel', { thickness: 18 });
      part.profile.rect({ at: [0, 0], w: 200, h: 150 });
      part.profile.circle({ at: [15, 15], d: 8 });
      part.profile.circle({ at: [35, 15], d: 8 });
      part.cut(part.profile.regionAt(35, 15), { depth: 'through' });
      part.profile.circle({ at: [55, 15], d: 8 });
      part.cut(part.profile.regionAt(55, 15), { depth: 5 });
      const top = part.sketchOn('top');
      top.pattern([top.rect({ at: [20, 40], w: 10, h: 10 })], { count: 3, step: [30, 0] });
      part.cut(top.regionAt(25, 45), { depth: 'through' });
      const under = part.sketchOn('underside');
      under.circle({ at: [-140, 40], d: 10 });
      part.cut(under.regionAt(-140, 40), { depth: 'through' });
      top.rect({ at: [20, 80], w: 40, h: 40 });
      const pocket = part.cut(top.regionAt(40, 100), { depth: 5 });
      const floor = part.sketchOn({ floorOf: pocket });
      floor.circle({ at: [40, 100], d: 10 });
      part.cut(floor.regionAt(40, 100), { depth: 'through' });
      top.circle({ at: [170, 100], d: 10 });
      part.expect({ holes: 7, pockets: 2 });
    });
    expect(report.parts[0]!.holes).toBe(7);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
