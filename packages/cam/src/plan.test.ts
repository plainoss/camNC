import { describe, expect, it } from 'vitest';
import { profileFeatures } from './cutFeatures';
import { DEFAULT_TABS } from './settings';
import { camPart } from './toolpaths';
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

describe('counterbores', () => {
  const circle = (cx: number, cy: number, r: number): PathD =>
    Array.from({ length: 96 }, (_, i) => ({ x: cx + r * Math.cos((i * Math.PI) / 48), y: cy + r * Math.sin((i * Math.PI) / 48) }));

  it('cuts a counterbore barely wider than its screw hole, using the hole’s space and staying inside its wall', () => {
    const { features } = profileFeatures({
      thickness: 18,
      outline: rect(0, 0, 100, 60),
      holes: [circle(50, 30, 2.25)],
      cuts: [{ id: 'counterbore', from: 0, to: 3, through: false, outline: circle(50, 30, 5), islands: [] }],
    });
    const { operations, warnings } = camPart(features, { cutThrough: false });
    expect(warnings.filter(w => w.includes('no tool fits'))).toEqual([]);
    const pocket = operations.find(op => /pocket/i.test(op.name))!;
    expect(pocket).toBeDefined();
    const points = pocket.passes.flatMap(pass => pass.pts);
    expect(Math.min(...points.map(q => q[2]))).toBeCloseTo(15, 6);
    // The bit's edge never reaches past the counterbore's 5 mm radius.
    const reach = Math.max(...points.filter(q => q[2] < 18).map(q => Math.hypot(q[0] - 50, q[1] - 30)));
    expect(reach + 3.175 / 2).toBeLessThanOrEqual(5 + 0.02);
  });
});

describe('open rebates', () => {
  it('cuts a rebate that runs off the part right out to its ends, without a corner warning', () => {
    // A cupboard side's rebates: across both ends and along the back edge, drawn past the part so they're open.
    const rebate = (id: string, outline: ReturnType<typeof rect>) => ({ id, from: 0, to: 8, through: false, outline, islands: [] });
    const { features } = profileFeatures({
      thickness: 18,
      outline: rect(0, 0, 300, 720),
      holes: [],
      cuts: [rebate('bottom', rect(-5, -5, 310, 23)), rebate('top', rect(-5, 702, 310, 23)), rebate('back', rect(294, -5, 11, 730))],
    });
    const { warnings } = camPart(features, { cutThrough: false });
    expect(warnings.filter(w => w.includes('left in corners'))).toEqual([]);
  });
});

describe('planBoard', () => {
  it('warns when a part is relieved for a smaller bit than the board is cut with', () => {
    const profile = profileFeatures({ thickness: 18, outline: rect(0, 0, 200, 120), holes: [] });
    const relieved = (cornerRelief: number): BoardPartSource => ({
      part: () => ({ size: profile.size, features: profile.features, cornerRelief }),
      underside: () => profile.features,
    });
    const tight = planBoard(board(), {}, relieved(2)).warnings.filter(w => w.includes('relieved'));
    expect(tight).toEqual([
      'Plate: its inside corners are relieved for a ⌀2 bit, but this board is cut with a ⌀3.175 bit, so they stay rounded.',
    ]);
    expect(planBoard(board(), {}, relieved(6)).warnings.filter(w => w.includes('relieved'))).toEqual([]);
  });

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
