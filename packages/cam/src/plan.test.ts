import { describe, expect, it } from 'vitest';
import { profileFeatures } from './cutFeatures';
import { DEFAULT_TABS } from './settings';
import { planBoard, type BoardPartSource, type BoardRequest } from './plan';
import type { PathD } from './geom';

const rect = (x: number, y: number, w: number, h: number): PathD => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const board = (extra: Partial<BoardRequest> = {}): BoardRequest => ({
  id: 'b',
  name: 'A',
  w: 240,
  h: 160,
  thickness: 18,
  stockTop: 18,
  holdDown: 'tabs',
  tabs: DEFAULT_TABS,
  parts: [{ id: 'one', partId: 'plate', name: 'Plate', x: 20, y: 20, rotated: false }],
  ...extra,
});
const source = (profile: ReturnType<typeof profileFeatures>): BoardPartSource => ({
  part: () => ({ size: profile.size, features: profile.features }),
  underside: () => profile.features,
});

describe('profileFeatures', () => {
  it('moves a profile to the origin and keeps its offset', () => {
    const profile = profileFeatures({ thickness: 18, outline: rect(50, 30, 200, 120), holes: [rect(100, 60, 20, 20)] });
    expect(profile.offset).toEqual({ x: 50, y: 30 });
    expect(profile.size).toEqual([200, 120, 18]);
    expect(profile.features.throughHoles[0]![0]).toEqual({ x: 50, y: 30 });
    expect(profile.problem).toBeUndefined();
    expect(profile.below).toBeNull();
  });

  it('turns clockwise loops counterclockwise', () => {
    const profile = profileFeatures({ thickness: 18, outline: [...rect(0, 0, 100, 50)].reverse(), holes: [] });
    expect(profile.features.outlines[0]).toEqual(rect(0, 0, 100, 50));
  });

  it('says when through cuts split the part', () => {
    const profile = profileFeatures({
      thickness: 18,
      outline: rect(0, 0, 200, 120),
      holes: [],
      cuts: [{ id: 'slot', from: 0, to: 18, through: true, outline: rect(95, -5, 10, 130), islands: [] }],
    });
    expect(profile.problem).toMatch(/split the part/);
  });

  it('builds side B from cuts on the underside, turned over either way', () => {
    const profile = profileFeatures({
      thickness: 18,
      outline: rect(0, 0, 200, 120),
      holes: [],
      cuts: [
        { id: 'top', from: 0, to: 6, through: false, outline: rect(20, 20, 40, 40), islands: [] },
        { id: 'cup', side: 'underside', from: 0, to: 10, through: false, outline: rect(150, 20, 30, 30), islands: [] },
      ],
    });
    expect(profile.problem).toBeUndefined();
    expect(profile.features.pockets.map(pocket => pocket.floorZ)).toEqual([12]);
    expect(profile.features.bottomFaces).toEqual([{ z: 10, area: 900 }]);
    expect(profile.below!.pockets.map(pocket => pocket.floorZ)).toEqual([8]);
    // Turned about X the pocket keeps its x and mirrors in y; turned about Y, the other way round.
    const xs = (features: ReturnType<NonNullable<typeof profile.turned>>) => features.pockets[0]!.strictRegion[0]!.map(p => p.x);
    expect(Math.min(...xs(profile.turned!('x')))).toBeCloseTo(150);
    expect(Math.min(...xs(profile.turned!('y')))).toBeCloseTo(20);
  });

  it('says when cuts from the two faces meet', () => {
    const profile = profileFeatures({
      thickness: 18,
      outline: rect(0, 0, 200, 120),
      holes: [],
      cuts: [
        { id: 'top', from: 0, to: 10, through: false, outline: rect(20, 20, 40, 40), islands: [] },
        { id: 'under', side: 'underside', from: 0, to: 10, through: false, outline: rect(30, 30, 40, 40), islands: [] },
      ],
    });
    expect(profile.problem).toMatch(/two faces meet/);
  });
});

describe('planBoard', () => {
  it('plans a part on a board without the app: programs, numbers and safety checks', () => {
    const profile = profileFeatures({
      thickness: 18,
      outline: rect(0, 0, 200, 120),
      holes: [],
      cuts: [{ id: 'pocket', from: 0, to: 6, through: false, outline: rect(40, 30, 120, 60), islands: [] }],
    });
    const plan = planBoard(board(), {}, source(profile));
    expect(plan.safety).toEqual([]);
    expect(plan.programs).toHaveLength(1);
    expect(plan.gcode).toMatch(/G1 /);
    expect(plan.ops.map(op => op.kind)).toEqual(['pocket', 'profile']);
    expect(plan.ops[0]!.label).toBe('Plate · 1 pocket 6 deep');
    expect(plan.hold?.every(hold => hold.ok)).toBe(true);
  });

  it('measures side B from the stock’s new top when the stock is thicker than the part', () => {
    const profile = profileFeatures({
      thickness: 18,
      outline: rect(0, 0, 200, 120),
      holes: [],
      cuts: [{ id: 'pocket', from: 0, to: 6, through: false, outline: rect(40, 30, 120, 60), islands: [] }],
    });
    const asked: [string, boolean][] = [];
    const plan = planBoard(
      board({ stockTop: 19, flip: { registration: 'camera' } }),
      {},
      {
        part: () => ({ size: profile.size, features: profile.features }),
        underside: (partId, rotated) => (asked.push([partId, rotated]), profile.features),
      }
    );
    expect(asked[0]).toEqual(['plate', false]);
    expect(plan.sideB?.ops.find(op => op.kind === 'pocket')!.zBottom).toBeCloseTo(19 - 6, 3);
  });
});
