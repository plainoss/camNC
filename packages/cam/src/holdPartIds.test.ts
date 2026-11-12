import { describe, expect, it } from 'vitest';
import { camBoardParts, type BoardSpec } from './board';
import type { PartFeatures } from './features';
import { holdCheck, holdTimeline } from './hold';
import { DEFAULT_TABS } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const features = (outlines: { x: number; y: number }[][], holes: { x: number; y: number }[][] = []): PartFeatures => ({
  thickness: 8,
  footprint: outlines,
  outlines,
  throughHoles: holes,
  levels: [],
  pockets: [],
  bottomFaces: [],
  slopedArea: 0,
});
const spec = (parts: BoardSpec['parts'], w: number, h: number): BoardSpec => ({
  id: 'a',
  name: 'A',
  w,
  h,
  thickness: 8,
  holdDown: 'tabs',
  tabs: DEFAULT_TABS,
  parts,
});
/** The hold check of the board's program, with the board part each operation cuts. */
const holdsOf = (board: BoardSpec) => {
  const { cam, partIds } = camBoardParts(board, {});
  return { cam, partIds, holds: holdCheck(cam, { ...board, partIds }) };
};
/** Every tab lies on this part's own outline: within its rectangle on the board, give or take the bit. */
const within = (tabs: { at: { x: number; y: number } }[], r: { x: number; y: number; w: number; h: number }) =>
  tabs.every(({ at }) => at.x >= r.x - 5 && at.x <= r.x + r.w + 5 && at.y >= r.y - 5 && at.y <= r.y + r.h + 5);

describe('which board part each tab hold is for, when names repeat', () => {
  it('a part in the hole of another of the same name, both centred on one spot', () => {
    const big = features([rect(0, 0, 300, 300)], [rect(50, 50, 250, 250)]);
    const small = features([rect(0, 0, 100, 100)]);
    const board = spec(
      [
        { id: 'small', name: 'Part', features: small, size: [100, 100, 8], x: 150, y: 150, rotated: false },
        { id: 'big', name: 'Part', features: big, size: [300, 300, 8], x: 50, y: 50, rotated: false },
      ],
      400,
      400
    );
    const { cam, partIds, holds } = holdsOf(board);
    // One outline each, each with its own id.
    expect(holds.map(h => h.id).sort()).toEqual(['big', 'small']);
    const small_ = holds.find(h => h.id === 'small')!;
    expect(within(small_.tabs, { x: 150, y: 150, w: 100, h: 100 })).toBe(true);
    // The outer part's tabs are on its outer edge, not on the hole the small part sits in.
    const big_ = holds.find(h => h.id === 'big')!;
    expect(big_.tabs.every(({ at }) => at.x < 100 || at.x > 300 || at.y < 100 || at.y > 300)).toBe(true);
    const loose = holdTimeline(cam, { ...board, partIds }).filter(e => e.kind === 'loose');
    expect(loose.every(e => e.id === 'small' || e.id === 'big')).toBe(true);
  });

  it('copies of a part of two islands, close together: each island stays with its own copy', () => {
    // A long bar along the bottom and a small block at the top right.
    const two = features([rect(0, 0, 200, 30), rect(180, 180, 200, 200)]);
    const board = spec(
      [
        { id: 'p1', name: 'Pair', features: two, size: [200, 200, 8], x: 20, y: 20, rotated: false },
        { id: 'p2', name: 'Pair', features: two, size: [200, 200, 8], x: 230, y: 110, rotated: false },
      ],
      470,
      360
    );
    const { holds } = holdsOf(board);
    expect(holds.map(h => h.id).sort()).toEqual(['p1', 'p1', 'p2', 'p2']);
    for (const h of holds.filter(x => x.id === 'p1')) expect(within(h.tabs, { x: 20, y: 20, w: 200, h: 200 })).toBe(true);
    for (const h of holds.filter(x => x.id === 'p2')) expect(within(h.tabs, { x: 230, y: 110, w: 200, h: 200 })).toBe(true);
  });

  it('turned and unturned copies side by side', () => {
    const p = features([rect(0, 0, 200, 100)]);
    const board = spec(
      [
        { id: 'r1', name: 'Side', features: p, size: [200, 100, 8], x: 30, y: 30, rotated: true },
        { id: 'r2', name: 'Side', features: p, size: [200, 100, 8], x: 160, y: 30, rotated: true },
        { id: 'u1', name: 'Side', features: p, size: [200, 100, 8], x: 290, y: 30, rotated: false },
      ],
      530,
      260
    );
    const { holds } = holdsOf(board);
    expect(holds.map(h => h.id).sort()).toEqual(['r1', 'r2', 'u1']);
    const at = { r1: { x: 30, y: 30, w: 100, h: 200 }, r2: { x: 160, y: 30, w: 100, h: 200 }, u1: { x: 290, y: 30, w: 200, h: 100 } };
    for (const h of holds) expect(within(h.tabs, at[h.id as keyof typeof at])).toBe(true);
  });

  it('without the ids, only names: no guess', () => {
    const p = features([rect(0, 0, 200, 100)]);
    const board = spec(
      [
        { id: 'a', name: 'Side', features: p, size: [200, 100, 8], x: 30, y: 30, rotated: false },
        { id: 'b', name: 'Side', features: p, size: [200, 100, 8], x: 30, y: 150, rotated: false },
      ],
      260,
      280
    );
    const { cam } = camBoardParts(board, {});
    expect(holdCheck(cam, board).map(h => h.id)).toEqual([undefined, undefined]);
  });
});
