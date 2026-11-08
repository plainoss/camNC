import { describe, expect, it } from 'vitest';
import { profileFeatures } from './cutFeatures';
import type { PathD } from './geom';
import { planBoard, type BoardRequest } from './plan';
import { progressOver } from './progress';
import { DEFAULT_TABS } from './settings';
import type { Tool } from './toolpaths';
import { carvingOperations, type BoardCarving } from './vcarve';

const rect = (x: number, y: number, w: number, h: number): PathD => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const V60: Tool = { number: 4, diameter: 8, name: '60° V-bit', shape: 'v', angle: 60 };
const carving: BoardCarving = { id: 'c', name: 'Sign', region: [rect(20, 20, 30, 12)], tool: V60, maxDepth: 2 };
const plate = profileFeatures({ thickness: 18, outline: rect(0, 0, 120, 80), holes: [rect(30, 30, 20, 20)] });
const board = (extra: Partial<BoardRequest> = {}): BoardRequest => ({
  id: 'b',
  name: 'A',
  w: 240,
  h: 160,
  thickness: 18,
  stockTop: 18,
  holdDown: 'tabs',
  tabs: DEFAULT_TABS,
  parts: [{ id: 'one', partId: 'plate', name: 'Plate', x: 100, y: 20, rotated: false }],
  ...extra,
});
const source = { part: () => ({ size: plate.size, features: plate.features }), underside: () => plate.features };

/** What a computation reported, checked to only ever go forward and stay within 0 to 1. */
function reports() {
  const seen: number[] = [];
  return {
    seen,
    onProgress: (fraction: number) => {
      expect(fraction).toBeGreaterThanOrEqual(seen.at(-1) ?? 0);
      expect(fraction).toBeLessThanOrEqual(1);
      seen.push(fraction);
    },
  };
}

describe('progressOver', () => {
  it('reports steps by their share of the whole, and how far a step got inside it', () => {
    const { seen, onProgress } = reports();
    const progress = progressOver(onProgress, 4);
    progress.done(1);
    const inner = progress.step(2)!;
    inner(0.5);
    inner(2); // past its end: no further than the step
    progress.done(2);
    progress.done(1);
    expect(seen).toEqual([0.25, 0.5, 0.75, 0.75, 1]);
  });

  it('hands out no step progress when nobody is watching', () => {
    expect(progressOver(undefined, 1).step(1)).toBeUndefined();
  });
});

describe('planning progress', () => {
  it('goes forward from the start of a board to near its end, and plans the same board', () => {
    const request = board({ carvings: [carving], flip: { registration: 'camera' }, rotationDeg: 90 });
    const { seen, onProgress } = reports();
    const watched = planBoard(request, {}, source, { onProgress });
    expect(seen[0]).toBe(0);
    expect(seen.length).toBeGreaterThan(5);
    // The tab hold check is the last little bit: the caller says when it's done.
    expect(seen.at(-1)).toBeGreaterThan(0.9);
    expect(watched).toEqual(planBoard(request, {}, source));
  });

  it('follows a carving ring by ring, to its end', () => {
    const { seen, onProgress } = reports();
    const watched = carvingOperations(carving, 18, {}, onProgress);
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.at(-1)).toBe(1);
    expect(watched).toEqual(carvingOperations(carving, 18, {}));
  });
});
