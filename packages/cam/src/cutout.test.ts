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

/** An ellipse traced off a 0.1 mm raster, as text and artwork are outlined: a staircase of tiny steps. */
function traced(cx: number, cy: number, rx: number, ry: number): PathD {
  const loop: PathD = [];
  const n = Math.round((2 * Math.PI * Math.max(rx, ry)) / 0.1);
  const snap = (v: number) => Math.round(v * 10) / 10;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI;
    const p = { x: snap(cx + rx * Math.cos(a)), y: snap(cy + ry * Math.sin(a)) };
    const last = loop.at(-1);
    if (last && last.x !== p.x && last.y !== p.y) loop.push({ x: p.x, y: last.y });
    if (!last || last.x !== p.x || last.y !== p.y) loop.push(p);
  }
  return loop;
}
// Seven letters 28 mm tall, 4 mm apart: a word, some 6000 points.
const tracedWord = Array.from({ length: 7 }, (_, i) => traced(20 + i * 22, 40, 9, 14));
const toSegment = (q: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
};

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

  it('keeps a traced outline at least the margin from the artwork, and not much more', () => {
    const [loop, ...rest] = cutoutSilhouette(tracedWord, 'outline', 6);
    expect(rest).toEqual([]);
    const gaps = tracedWord.flat().map(q => Math.min(...loop.map((a, i) => toSegment(q, a, loop[(i + 1) % loop.length]))));
    // Round corners are drawn as short chords, a few thousandths inside the arc.
    expect(Math.min(...gaps)).toBeGreaterThan(5.98);
    expect(Math.min(...gaps)).toBeLessThan(6.25);
  });

  it('[performance] grows a word traced off a raster quickly enough to draw as the cutout is turned on', () => {
    const t = performance.now();
    // Margins the offset cache has not seen.
    for (const margin of [6.01, 6.02, 6.03]) cutoutSilhouette(tracedWord, 'outline', margin);
    expect((performance.now() - t) / 3).toBeLessThan(100);
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
