import { describe, expect, it } from 'vitest';
import { areaD } from 'clipper2-ts';
import { cutoutSilhouette } from './cutout';
import type { PathD } from './geom';
import { planBoard, type BoardRequest } from './plan';
import { DEFAULT_TABS } from './settings';
import type { BoardCarving } from './vcarve';

const rect = (x: number, y: number, w: number, h: number): PathD => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const V60 = { number: 14, diameter: 6, shape: 'v' as const, angle: 60 };
// Two letters 8 mm apart, the first with a hole.
const letters = [rect(40, 40, 30, 40), [...rect(50, 50, 10, 20)].reverse(), rect(78, 40, 30, 40)];
const carving: BoardCarving = { id: 'c', name: 'Sign', region: letters, tool: V60, maxDepth: 2 };
const board = (extra: Partial<BoardRequest> = {}): BoardRequest => ({
  id: 'b',
  name: 'A',
  w: 160,
  h: 120,
  thickness: 18,
  stockTop: 18,
  holdDown: 'tabs',
  tabs: DEFAULT_TABS,
  parts: [],
  carvings: [carving],
  ...extra,
});

describe('cutoutSilhouette', () => {
  it('joins nearby pieces into one outline round the artwork, holes filled', () => {
    const [loop, ...rest] = cutoutSilhouette(letters, 'outline', 5);
    expect(rest).toEqual([]);
    const xs = loop.map(p => p.x);
    expect(Math.min(...xs)).toBeCloseTo(35, 0);
    expect(Math.max(...xs)).toBeCloseTo(113, 0);
  });

  it('draws a rounded plaque round the artwork', () => {
    const [plaque, ...rest] = cutoutSilhouette(letters, 'plaque', 5);
    expect(rest).toEqual([]);
    expect(Math.max(...plaque.map(p => p.x))).toBeCloseTo(113, 3);
    // The corners are rounded off.
    expect(areaD(plaque)).toBeLessThan(78 * 50);
    expect(areaD(plaque)).toBeGreaterThan(78 * 50 - 40);
  });

  it('keeps pieces too far apart to join as separate outlines', () => {
    expect(cutoutSilhouette([rect(0, 0, 20, 20), rect(100, 0, 20, 20)], 'outline', 3)).toHaveLength(2);
  });
});

describe('a carving cut out of its board', () => {
  const outline = cutoutSilhouette(letters, 'outline', 6)[0];
  const none = {
    part: () => {
      throw new Error('no parts');
    },
    underside: () => {
      throw new Error('no parts');
    },
  };

  it('is cut after the carving and held by tabs', () => {
    const plan = planBoard(board({ cutouts: [{ id: 'cut', name: 'Cutout', outline }] }), {}, none);
    expect(plan.holding).toEqual([expect.objectContaining({ name: 'Cutout', how: 'placed' })]);
    expect(plan.holding![0].tabs).toBeGreaterThanOrEqual(3);
    const names = plan.ops.map(o => o.name);
    expect(names.findIndex(n => n.startsWith('Cutout'))).toBeGreaterThan(names.findIndex(n => /sign/i.test(n)));
  });

  it('keeps tabs where the user placed them', () => {
    const tabsAt = [
      { x: 34, y: 60 },
      { x: 114, y: 60 },
    ];
    const plan = planBoard(board({ cutouts: [{ id: 'cut', name: 'Cutout', outline, tabsAt }] }), {}, none);
    expect(plan.holding).toEqual([expect.objectContaining({ name: 'Cutout', how: 'placed', tabs: 2 })]);
  });

  it('is held by a skin on tape, cut free at the end', () => {
    const plan = planBoard(board({ holdDown: 'fixture-tape', taped: true, cutouts: [{ id: 'cut', name: 'Cutout', outline }] }), {}, none);
    expect(plan.holding).toEqual([expect.objectContaining({ name: 'Cutout', how: 'skin' })]);
    expect(plan.release?.map(r => r.kind)).toEqual(['free']);
  });
});
