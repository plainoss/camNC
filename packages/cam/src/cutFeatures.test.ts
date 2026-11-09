import { describe, expect, it } from 'vitest';
import { camPart } from './toolpaths';
import { featuresFromCuts, type FlatCut } from './cutFeatures';
import { difference, intersect, polyArea, union, type PathD } from './geom';

const rect = (x: number, y: number, w: number, h: number): PathD => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const profile = (cuts: FlatCut[], holes: PathD[] = []) => ({ thickness: 18, outline: rect(0, 0, 200, 120), holes, cuts });
const cut = (id: string, outline: PathD, to: number, extra: Partial<FlatCut> = {}): FlatCut => ({
  id,
  from: 0,
  to,
  through: to >= 18,
  outline,
  islands: [],
  ...extra,
});

describe('features from cuts', () => {
  it('makes a pocket at the cut’s floor, with the rest of the top around it', () => {
    const { features } = featuresFromCuts(profile([cut('a', rect(20, 20, 70, 60), 6)]));
    expect(features.pockets).toHaveLength(1);
    expect(features.pockets[0]!.floorZ).toBe(12);
    expect(features.pockets[0]!.area).toBeCloseTo(4200, 0);
    expect(features.levels.map(level => level.z)).toEqual([18, 12]);
    expect(features.levels[0]!.area).toBeCloseTo(24000 - 4200, 0);
    expect(features.throughHoles).toEqual([]);
    expect(features.bottomFaces).toEqual([]);
  });

  it('leaves existing holes exact, in order, and open below a pocket', () => {
    const hole = rect(150, 50, 20, 20),
      { features, holeSources } = featuresFromCuts(profile([cut('a', rect(20, 20, 70, 60), 6)], [hole]));
    expect(features.throughHoles).toEqual([hole]);
    expect(holeSources).toEqual([{ hole: 0 }]);
  });

  it('extends a pocket past the outline where it’s open to the edge, so the bit runs off the part', () => {
    const { features } = featuresFromCuts(profile([cut('rabbet', rect(176, 0, 24, 120), 6)]));
    const pocket = features.pockets[0]!;
    expect(pocket.area).toBeCloseTo(24 * 120, 0);
    expect(Math.max(...pocket.region.flat().map(p => p.x))).toBeCloseTo(202, 1);
    expect(Math.max(...pocket.strictRegion.flat().map(p => p.x))).toBeCloseTo(200, 1);
    expect(features.outlines).toEqual([rect(0, 0, 200, 120)]);
  });

  it('leaves islands standing inside a pocket', () => {
    const { features } = featuresFromCuts(profile([cut('a', rect(20, 20, 70, 60), 6, { islands: [rect(40, 40, 10, 10)] })]));
    expect(features.pockets[0]!.area).toBeCloseTo(4200 - 100, 0);
    expect(features.levels[0]!.area).toBeCloseTo(24000 - 4100, 0);
  });

  it('keeps an island too small for a level out of the pocket', () => {
    const island = rect(50, 50, 0.2, 0.2),
      { features } = featuresFromCuts(profile([cut('a', rect(20, 20, 80, 80), 6, { islands: [island] })])),
      pocket = features.pockets[0]!;
    expect(pocket.area).toBeCloseTo(6400 - 0.04, 2);
    expect(polyArea(intersect([island], pocket.strictRegion))).toBeCloseTo(0, 6);
    expect(polyArea(intersect([island], pocket.region))).toBeCloseTo(0, 6);
  });

  it('keeps exact solid levels complementary around curved islands, including small holes', () => {
    const circle = (radius: number) =>
        Array.from({ length: 64 }, (_, i) => ({
          x: 50 + radius * Math.cos((i * Math.PI) / 32),
          y: 50 + radius * Math.sin((i * Math.PI) / 32),
        })),
      hole = circle(0.08),
      { features } = featuresFromCuts(profile([cut('a', rect(20, 20, 80, 80), 6, { islands: [circle(5)] })], [hole])),
      allSurfaces = union(features.meshLevels!.flatMap(level => level.region));
    // Every point of the footprint has exactly one up-facing surface, even when CAM cleaning drops a small loop.
    expect(polyArea(difference(features.footprint, allSurfaces))).toBe(0);
    expect(polyArea(difference(allSurfaces, features.footprint))).toBe(0);
    expect(features.meshLevels![0]!.region.some(path => Math.abs(polyArea([path])) < 0.05)).toBe(true);
    expect(features.levels[0]!.region.every(path => Math.abs(polyArea([path])) >= 0.05)).toBe(true);
  });

  it('keeps a hole beside a floor cut, naming only the hole the cut really made', () => {
    const hole = rect(120, 40, 10, 10),
      { features, holeSources } = featuresFromCuts(
        profile([cut('pocket', rect(20, 20, 60, 60), 6), cut('slot', rect(40, 40, 100, 20), 18, { from: 6 })], [hole])
      );
    expect(holeSources).toEqual([{ hole: 0 }, { cut: 'slot' }]);
    expect(features.throughHoles).toHaveLength(2);
    expect(features.throughHoles[0]).toEqual(hole);
  });

  it('keeps a hole inside an island of a through cut', () => {
    const hole = rect(50, 50, 4, 4),
      { features, holeSources } = featuresFromCuts(
        profile([cut('ring', rect(20, 20, 80, 80), 18, { islands: [rect(40, 40, 30, 30)] })], [hole])
      );
    expect(holeSources).toEqual([{ hole: 0 }, { cut: 'ring' }]);
    expect(features.throughHoles[0]).toEqual(hole);
  });

  it('replaces a hole a through cut merged into, without counting it twice', () => {
    const { features, holeSources } = featuresFromCuts(profile([cut('slot', rect(40, 40, 30, 10), 18)], [rect(60, 40, 30, 10)]));
    expect(holeSources).toEqual([{ cut: 'slot' }]);
    expect(polyArea(features.throughHoles)).toBeCloseTo(500, 3);
  });

  it('steps a second cut down from a pocket floor, and keeps nesting in one region per height', () => {
    const { features } = featuresFromCuts(profile([cut('a', rect(20, 20, 70, 60), 6), cut('b', rect(40, 40, 20, 20), 10, { from: 6 })]));
    expect(features.levels.map(level => level.z)).toEqual([18, 12, 8]);
    expect(features.pockets.map(pocket => pocket.floorZ)).toEqual([12, 8]);
    expect(features.pockets[1]!.area).toBeCloseTo(400, 0);
    expect(features.pockets[0]!.area).toBeCloseTo(4200, 0);
  });

  it('never undercuts: a floor cut stops at the edge of the pocket it starts in', () => {
    const { features } = featuresFromCuts(profile([cut('a', rect(20, 20, 70, 60), 6), cut('b', rect(80, 30, 40, 20), 10, { from: 6 })]));
    expect(features.pockets[1]!.area).toBeCloseTo(10 * 20, 0);
  });

  it('lets a cut that starts at the top pass through an existing pocket', () => {
    const { features } = featuresFromCuts(profile([cut('a', rect(20, 20, 70, 60), 6), cut('b', rect(80, 30, 40, 20), 10)]));
    expect(features.pockets[1]!.area).toBeCloseTo(40 * 20, 0);
    // The shallower pocket's area also covers what's deeper, because it's cleared on the way down.
    expect(features.pockets[0]!.area).toBeCloseTo(4200 + 30 * 20, 0);
  });

  it('makes a through cut a hole named after its cut, keeping earlier holes first', () => {
    const hole = rect(150, 50, 20, 20),
      { features, holeSources } = featuresFromCuts(profile([cut('slot', rect(20, 20, 60, 10), 18)], [hole]));
    expect(holeSources).toEqual([{ hole: 0 }, { cut: 'slot' }]);
    expect(features.throughHoles[0]).toEqual(hole);
    expect(polyArea([features.throughHoles[1]!])).toBeCloseTo(600, 0);
    expect(features.pockets).toEqual([]);
  });

  it('moves the outline when a through cut reaches it', () => {
    const { features } = featuresFromCuts(profile([cut('notch', rect(180, 0, 20, 120), 18)]));
    expect(features.outlines).toHaveLength(1);
    expect(Math.max(...features.outlines.flat().map(p => p.x))).toBeCloseTo(180, 3);
    expect(features.throughHoles).toEqual([]);
  });

  it('ignores a cut wholly outside the part', () => {
    const { features } = featuresFromCuts(profile([cut('a', rect(300, 20, 10, 10), 6)]));
    expect(features.pockets).toEqual([]);
    expect(features.levels).toHaveLength(1);
  });

  it('makes a pocket of every region when cuts cover the whole top', () => {
    const { features } = featuresFromCuts(profile([cut('a', rect(0, 0, 100, 120), 5), cut('b', rect(100, 0, 100, 120), 7)]));
    expect(features.pockets.map(pocket => pocket.floorZ)).toEqual([13, 11]);
    const same = featuresFromCuts(profile([cut('a', rect(0, 0, 100, 120), 5), cut('b', rect(100, 0, 100, 120), 5)])).features;
    expect(same.pockets.map(pocket => pocket.floorZ)).toEqual([13]);
    expect(same.pockets[0]!.area).toBeCloseTo(24000, 0);
    const cam = camPart(same, { tabs: false, cutThrough: true });
    const pockets = cam.operations.filter(op => op.feature === 'pocket');
    expect(pockets.length).toBeGreaterThan(0);
    const zs = pockets.flatMap(op => op.passes.flatMap(pass => pass.pts.map(point => point[2])));
    expect(Math.min(...zs)).toBeCloseTo(13, 1);
  });

  it('keeps every untouched hole’s identity, whatever Clipper does to its points', () => {
    for (const radius of [5, 20, 95]) {
      const round = Array.from({ length: 120 }, (_, i) => ({
          x: 100 + 0.37 + radius * Math.cos((i * Math.PI) / 60),
          y: 60 + 0.11 + radius * 0.5 * Math.sin((i * Math.PI) / 60),
        })),
        small = rect(180, 100, 10, 10),
        { features, holeSources } = featuresFromCuts(profile([cut('slot', rect(5, 5, 8, 8), 18)], [round, small]));
      expect(holeSources).toEqual([{ hole: 0 }, { hole: 1 }, { cut: 'slot' }]);
      expect(features.throughHoles[0]).toEqual(round);
    }
  });

  it('gives CAM pockets at the right depths', () => {
    const { features } = featuresFromCuts(profile([cut('a', rect(20, 20, 70, 60), 6), cut('b', rect(176, 0, 24, 120), 3)]));
    const cam = camPart(features, { tabs: false, cutThrough: true });
    const pockets = cam.operations.filter(op => op.name.toLowerCase().includes('pocket'));
    expect(pockets.length).toBeGreaterThanOrEqual(2);
    const floors = pockets.map(op => Math.min(...op.passes.flatMap(pass => pass.pts.map(point => point[2]))));
    expect(Math.min(...floors)).toBeCloseTo(12, 1);
    expect(floors.some(z => Math.abs(z - 15) < 0.1)).toBe(true);
  });
});
