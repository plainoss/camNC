import { describe, expect, it } from 'vitest';
import { areaD } from 'clipper2-ts';
import { cutoutPastBoard, cutoutSilhouette } from './cutout';
import { difference, offset, union, type PathD } from './geom';
import { simplifyLoop } from './simplifyLoop';
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
/**
 * A thin piece tapering from a point to 3 mm over 60 mm, turned 7°, traced off a 0.1 mm raster in row runs and simplified
 * within 0.06 mm, as the Carve step outlines artwork.
 */
function tracedWedge(): PathD[] {
  const angle = (7 * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const inside = (x: number, y: number) => {
    const u = (x - 10) * c + (y - 10) * s,
      v = -(x - 10) * s + (y - 10) * c;
    return u >= 0 && u <= 60 && Math.abs(v) <= (1.5 * u) / 60;
  };
  const rects: PathD[] = [];
  for (let row = 50; row < 380; row++) {
    let from = -1;
    for (let col = 50; col <= 720; col++) {
      const ink = col < 720 && inside((col + 0.5) / 10, (row + 0.5) / 10);
      if (ink && from < 0) from = col;
      if (!ink && from >= 0) {
        rects.push(rect(from / 10, row / 10, (col - from) / 10, 0.1));
        from = -1;
      }
    }
  }
  return union(rects).map(loop => simplifyLoop(loop, 0.06));
}
const toSegment = (q: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
};

/** Fixed arithmetic, allocation and sorting work, independent of the cutout implementation. */
function referenceWork() {
  let sum = 0;
  for (let k = 0; k < 400; k++) {
    const rects = Array.from({ length: 400 }, (_, i) => ({ x: (i * 7919 + k) % 1009, w: (i * 104729) % 613 }));
    rects.sort((a, b) => a.x - b.x || a.w - b.w);
    for (const r of rects) sum += Math.min(r.x + r.w, 1000);
  }
  return sum;
}
/** About 0.3 reference runs per silhouette now; growing the raw staircase took over 10. */
const kSilhouetteRatio = 2;

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

  it.each([0, 0.5, 6])('keeps a thin, tapering, turned piece at least a %s mm margin clear', margin => {
    const piece = tracedWedge();
    const [loop, ...rest] = cutoutSilhouette(piece, 'outline', margin);
    expect(rest).toEqual([]);
    // What the margin must hold, less the chord error of round corners: nothing of it is left outside the cut.
    const kept = margin ? offset(piece, margin - 0.01) : piece;
    const outside = difference(kept, [loop]).reduce((sum, p) => sum + Math.abs(areaD(p)), 0);
    expect(outside).toBeLessThan(1e-4);
  });

  it('[performance] grows a word traced off a raster within a fixed multiple of reference work', () => {
    // The raw staircase is harsher than the app's outlines, which are already simplified within 0.06 mm.
    let margin = 6;
    // Margins the offset cache has not seen.
    const work = () => cutoutSilhouette(tracedWord, 'outline', (margin += 1e-3));
    const timed = (run: () => unknown) => {
      const t = performance.now();
      run();
      return performance.now() - t;
    };
    work();
    referenceWork();
    // Alternating order, median ratio: changing runner load favours neither.
    const ratios = Array.from({ length: 7 }, (_, i) => {
      if (i % 2) {
        const r = timed(referenceWork);
        return timed(work) / r;
      }
      const w = timed(work);
      return w / timed(referenceWork);
    }).sort((a, b) => a - b);
    console.info(`cutout silhouette: median ratio ${ratios[3].toFixed(2)} of reference work`);
    expect(ratios[3]).toBeLessThan(kSilhouetteRatio);
  });
});

describe('cutoutPastBoard', () => {
  const size = { w: 160, h: 120 };
  it('passes an outline on the board, up to its edges', () => {
    expect(cutoutPastBoard(cutoutSilhouette(letters, 'outline', 6), size)).toBe(false);
    expect(cutoutPastBoard([rect(0, 0, 160, 120)], size)).toBe(false);
  });

  it('flags an outline that crosses an edge of the board, though the artwork is on it', () => {
    // The artwork's left edge 3 mm inside the board, a 6 mm margin round it.
    const near = letters.map(loop => loop.map(p => ({ x: p.x - 37, y: p.y })));
    expect(Math.min(...near.flat().map(p => p.x))).toBe(3);
    expect(cutoutPastBoard(cutoutSilhouette(near, 'outline', 6), size)).toBe(true);
    expect(cutoutPastBoard(cutoutSilhouette(letters, 'plaque', 45), size)).toBe(true);
    expect(cutoutPastBoard([rect(10, 10, 20, 111)], size)).toBe(true);
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

  it('says once that a cut line past the board edge is the problem, not once per move off the board', () => {
    // The artwork 3 mm inside the board's left edge: the cut line 6 mm round it runs 3 mm past it.
    const near = letters.map(loop => loop.map(p => ({ x: p.x - 37, y: p.y })));
    const past = cutoutSilhouette(near, 'outline', 6)[0];
    for (const holdDown of ['fixture-tape', 'tabs'] as const) {
      const plan = planBoard(
        board({
          holdDown,
          taped: holdDown === 'fixture-tape',
          carvings: [{ ...carving, region: near }],
          cutouts: [{ id: 'cut', name: 'Cutout', outline: past }],
        }),
        {},
        none
      );
      const all = [...plan.safety, ...(plan.release ?? []).flatMap(r => r.safety)];
      expect(all).toEqual([expect.stringMatching(/^Cutout: the cut line runs past the board's edge/)]);
    }
  });

  it('reports nothing for a cut line on the board', () => {
    const plan = planBoard(board({ holdDown: 'fixture-tape', taped: true, cutouts: [{ id: 'cut', name: 'Cutout', outline }] }), {}, none);
    expect([...plan.safety, ...(plan.release ?? []).flatMap(r => r.safety)]).toEqual([]);
  });
});
