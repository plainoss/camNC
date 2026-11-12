import { describe, expect, it } from 'vitest';
import type { PartFeatures } from './features';
import { difference, polyArea, union } from './geom';
import { describeOutlineNotches } from './outlineNotchNote';
import { camPart } from './toolpaths';

type Pt = { x: number; y: number };

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const circle = (cx: number, cy: number, r: number): Pt[] =>
  Array.from({ length: 64 }, (_, i) => ({ x: cx + r * Math.cos((i / 64) * 2 * Math.PI), y: cy + r * Math.sin((i / 64) * 2 * Math.PI) }));
/** The board's outline with these regions cut away from it, CCW. */
const cutAway = (outline: Pt[], ...cuts: Pt[][]) => {
  const [loop] = difference([outline], union(cuts, []));
  return polyArea([loop!]) < 0 ? [...loop!].reverse() : loop!;
};

/** A 200 x 60 board whose right end has `count` fingers along its 60 mm, 12 mm deep: every other one cut away. */
function fingerBoard(count: number): Pt[] {
  const w = 60 / count;
  const end: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const x = i % 2 ? 188 : 200;
    end.push({ x, y: i * w }, { x, y: (i + 1) * w });
  }
  return [{ x: 0, y: 0 }, ...end, { x: 0, y: 60 }];
}

function part(outline: Pt[], holes: Pt[][] = []): PartFeatures {
  const area = Math.abs(polyArea([outline])) - holes.reduce((sum, h) => sum + Math.abs(polyArea([h])), 0);
  const footprint = [outline, ...holes.map(h => [...h].reverse())];
  return {
    thickness: 12,
    footprint,
    outlines: [outline],
    throughHoles: holes,
    levels: [{ z: 12, region: footprint, area }],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
}

const bit = (diameter: number) => ({ tools: [{ number: 1, diameter, name: 'flat end mill' }] });
const notches = (features: PartFeatures, diameter = 6) => camPart(features, bit(diameter)).outlineNotches ?? [];

describe('outline notches the bit can’t reach', () => {
  it('a finger joint with 4 mm fingers and a 6 mm bit is a plan problem: its slots would stay uncut', () => {
    // 15 fingers of 4 mm: 7 slots.
    const [found, ...more] = notches(part(fingerBoard(15)));
    expect(more).toEqual([]);
    expect(found).toMatchObject({ outline: 0, count: 7, diameter: 6, spans: true });
    expect(found!.width).toBeCloseTo(4, 1);
    expect(found!.at).toHaveLength(7);
    expect(describeOutlineNotches(found!)).toMatch(
      /^7 notches about 4 mm wide, such as a finger joint’s fingers, are narrower than the ⌀6 bit and won’t be cut: the outline runs straight across/
    );
  });

  it('a slot far narrower than the bit counts too', () => {
    // 1 mm wide, 10 mm deep, into the right edge.
    const [found, ...more] = notches(part(cutAway(rect(0, 0, 200, 60), rect(190, 30, 201, 31))));
    expect(more).toEqual([]);
    expect(found).toMatchObject({ count: 1, spans: true });
    expect(found!.width).toBeCloseTo(1, 1);
  });

  it('a slot about as wide as the bit: the bit gets partway in, and what it leaves is said as corners', () => {
    // 5.97 mm: the bit dips almost its radius into the mouth, so the piece left doesn't reach it.
    const [found, ...more] = notches(part(cutAway(rect(0, 0, 200, 60), rect(190, 27.015, 201, 32.985))));
    expect(more).toEqual([]);
    expect(found).toMatchObject({ count: 1, spans: false });
    // A slot the path does run across, as wide as the bit: not "narrower".
    expect(describeOutlineNotches({ ...found!, spans: true, width: 6 })).toMatch(
      /^A notch about 6 mm wide, .* is no wider than the ⌀6 bit/
    );
  });

  it('fingers wider than the bit, a smaller bit, and plain inside corners are no problem', () => {
    // 5 fingers of 12 mm: the bit enters each slot.
    expect(notches(part(fingerBoard(5)))).toEqual([]);
    expect(notches(part(fingerBoard(15)), 3.175)).toEqual([]);
    // An L-shaped part: its inside corner stays rounded, as any inside corner does.
    expect(notches(part(cutAway(rect(0, 0, 100, 100), rect(40, 40, 101, 101))))).toEqual([]);
  });

  it('a sharp V is a corner the bit can’t reach, not one it runs across', () => {
    // A 30° V, 20 mm deep, into the top edge.
    const depth = 20,
      half = depth * Math.tan((15 * Math.PI) / 180);
    const v = [
      { x: 100 - half, y: 61 + half / depth },
      { x: 100, y: 60 - depth },
      { x: 100 + half, y: 61 + half / depth },
    ];
    const found = notches(part(cutAway(rect(0, 0, 200, 60), v)));
    expect(found.map(n => n.spans)).toEqual([false]);
    expect(describeOutlineNotches(found[0]!)).toMatch(/^Material is left in a notch or sharp corner the ⌀6 bit can’t reach/);
  });

  it('T-bones relieved for a smaller bit are corners left, not a notch run across', () => {
    // A 20 mm housing into the top edge, its corners relieved for a ⌀3 bit.
    const outline = cutAway(rect(0, 0, 200, 60), rect(90, 50, 110, 61), circle(90, 51.5, 1.5), circle(110, 51.5, 1.5));
    const found = notches(part(outline));
    expect(found.map(n => ({ count: n.count, spans: n.spans }))).toEqual([{ count: 2, spans: false }]);
    expect(describeOutlineNotches(found[0]!)).toMatch(/^Material is left in 2 notches or sharp corners/);
  });

  it('a narrow mouth closes off what is behind it, for an outline and for a hole', () => {
    // A C: a 20 x 20 hollow behind a 2 mm mouth in the top edge.
    const c = cutAway(rect(0, 0, 200, 60), rect(90, 20, 110, 40), rect(99, 39, 101, 61));
    const [outer] = notches(part(c));
    expect(outer).toMatchObject({ outline: 0, count: 1, spans: true });
    expect(outer!.area).toBeGreaterThan(400);
    // A 30 mm hole with a 20 x 20 chamber behind a 2 mm neck: the hole's one loop never reaches the chamber.
    const hole = union([rect(20, 15, 50, 45)], union([rect(49, 29, 62, 31)], [rect(60, 20, 80, 40)]))[0]!;
    const [inside, ...more] = notches(part(rect(0, 0, 200, 60), [polyArea([hole]) < 0 ? [...hole].reverse() : hole]));
    expect(more).toEqual([]);
    expect(inside).toMatchObject({ outline: 0, inside: true, count: 1, spans: true });
    expect(inside!.area).toBeGreaterThan(400);
    expect(describeOutlineNotches(inside!)).toMatch(/the hole’s path runs straight across/);
  });
});
