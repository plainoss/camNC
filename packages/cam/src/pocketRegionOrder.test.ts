import { describe, expect, it } from 'vitest';
import type { PartFeatures } from './features';
import { DepthMap, readGcode, type Move } from './analyze';
import { pointInPolygonD, PointInPolygonResult } from 'clipper2-ts';
import { difference, intersect, offset, polyArea, union, type PathD, type PathsD } from './geom';
import { toGcode } from './gcode';
import { forEachRegion, regionLinks, type RegionNode } from './pocketRegionOrder';
import { camPart, DEFAULT_SETTINGS, stepdownFor } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number): PathD => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function pocketPart(outline: PathD, region: PathsD, depth: number): PartFeatures {
  const upper = difference([outline], region);
  return {
    thickness: 18,
    outlines: [outline],
    footprint: [outline],
    throughHoles: [],
    levels: [{ z: 18, region: upper, area: polyArea(upper) }],
    pockets: [{ floorZ: 18 - depth, region, strictRegion: region, above: upper, area: polyArea(region) }],
    bottomFaces: [],
    slopedArea: 0,
  };
}

/** The cupboard side's edge groove: a top and a bottom arm 700 mm apart, joined by a rabbet along one side. */
const edgeGroove = pocketPart(rect(0, 0, 300, 720), union([rect(-2, 702, 302, 722), rect(-2, -2, 302, 18)], [rect(294, -2, 302, 722)]), 8);
/** Two 60 mm squares joined by an 80 x 10 mm neck: the rings split at the neck. */
const dumbbell = pocketPart(
  rect(0, 0, 400, 300),
  union([rect(100, 120, 160, 180), rect(240, 120, 300, 180)], [rect(160, 145, 240, 155)]),
  6
);

const xyLength = (move: Move) => Math.hypot(move.to[0] - move.from[0], move.to[1] - move.from[1]);
/** XY rapids, and how many of them cross from one side of `side` to the other. */
function travel(moves: Move[], side: (x: number, y: number) => boolean) {
  const rapids = moves.filter(move => move.rapid && xyLength(move) > 1e-6);
  return {
    rapidLength: rapids.reduce((sum, move) => sum + xyLength(move), 0),
    crossings: rapids.filter(move => side(move.from[0], move.from[1]) !== side(move.to[0], move.to[1])).length,
  };
}

/**
 * The deepest any feed move cuts below the highest material left within the bit's radius, counting only the material
 * the pocket removes (`waste`): the walls around it stay at the stock top.
 */
function deepestFreshCut(moves: Move[], top: number, radius: number, waste: PathsD) {
  const xs = moves.flatMap(move => [move.from[0], move.to[0]]),
    ys = moves.flatMap(move => [move.from[1], move.to[1]]);
  const map = new DepthMap(Math.min(...xs) - 5, Math.min(...ys) - 5, Math.max(...xs) + 5, Math.max(...ys) + 5, 0.25);
  const inside = new Uint8Array(map.w * map.h);
  for (let j = 0; j < map.h; j++)
    for (let i = 0; i < map.w; i++) {
      const p = { x: map.x0 + i * map.res, y: map.y0 + j * map.res };
      inside[j * map.w + i] = waste.filter(path => pointInPolygonD(p, path) === PointInPolygonResult.IsInside).length % 2;
    }
  const span = Math.ceil(radius / map.res);
  /** Top of the highest waste material left under the bit at (x, y). */
  const highestAt = (x: number, y: number) => {
    const ci = Math.round((x - map.x0) / map.res),
      cj = Math.round((y - map.y0) / map.res);
    let high = -Infinity;
    for (let j = Math.max(0, cj - span); j <= Math.min(map.h - 1, cj + span); j++)
      for (let i = Math.max(0, ci - span); i <= Math.min(map.w - 1, ci + span); i++) {
        const dx = map.x0 + i * map.res - x,
          dy = map.y0 + j * map.res - y;
        if (dx * dx + dy * dy <= radius * radius && inside[j * map.w + i]) high = Math.max(high, Math.min(top, map.data[j * map.w + i]));
      }
    return high;
  };
  let deepest = 0;
  for (const move of moves) {
    if (move.rapid || (move.from[2] >= top && move.to[2] >= top)) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(move.to[0] - move.from[0], move.to[1] - move.from[1], move.to[2] - move.from[2]) / 0.2));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const [x, y, z] = [0, 1, 2].map(a => move.from[a] + t * (move.to[a] - move.from[a]));
      deepest = Math.max(deepest, highestAt(x, y) - z);
      map.stamp(x, y, z, radius);
    }
  }
  return deepest;
}

/** What the pocket of `part` removes from it, kept off its walls by a cell. */
const wasteOf = (part: PartFeatures) => intersect(offset(part.pockets[0].region, -0.3), part.outlines);

describe('pocket roughing order across regions that split', () => {
  const tool = DEFAULT_SETTINGS.tools[0];
  const stepdown = stepdownFor(tool, DEFAULT_SETTINGS);

  // Row by row across both arms, the bit crossed the board on 156 rapids, 125 m of them. Arm by arm, what's left is one
  // hop per depth back to the start of the U-shaped rows round the rabbet, which run climb from one arm to the other.
  it('roughs each arm of an edge groove before moving to the other', () => {
    const moves = readGcode(toGcode(camPart(edgeGroove, { cutThrough: false })));
    const { rapidLength, crossings } = travel(moves, (_, y) => y > 360);
    expect(crossings).toBeLessThanOrEqual(12);
    expect(rapidLength).toBeLessThan(10_000);
    expect(deepestFreshCut(moves, 18, tool.diameter / 2, wasteOf(edgeGroove))).toBeLessThanOrEqual(stepdown + 1e-3);
  });

  // Ring by ring across both lobes, the bit changed lobe on 160 rapids, 19.9 m of travel. Lobe by lobe it crosses once.
  it('roughs each lobe of a pocket that splits at a neck before moving to the other', () => {
    const moves = readGcode(toGcode(camPart(dumbbell, { cutThrough: false })));
    const { rapidLength, crossings } = travel(moves, x => x > 200);
    expect(crossings).toBeLessThanOrEqual(2);
    expect(rapidLength).toBeLessThan(1_000);
    expect(deepestFreshCut(moves, 18, tool.diameter / 2, wasteOf(dumbbell))).toBeLessThanOrEqual(stepdown + 1e-3);
  });
});

describe('pocket regions', () => {
  const square = (cx: number, cy: number, h: number) => rect(cx - h, cy - h, cx + h, cy + h);
  const regions = (groups: PathD[][]) => {
    const out: string[][] = [];
    forEachRegion(groups, regionLinks(groups, 3, true), true, { x: 0, y: 0 }, region => {
      out.push(region.map(({ group, index }: RegionNode) => `${group}.${index}`));
      const { group, index } = region[region.length - 1];
      return groups[group][index][0];
    });
    return out;
  };

  it('keeps one region in group order', () => {
    expect(regions([[square(0, 0, 1)], [square(0, 0, 2)], [square(0, 0, 3)]])).toEqual([['0.0', '1.0', '2.0']]);
  });

  it('cuts each lobe whole, nearest first, then the shared rings that follow both in their order', () => {
    // Centre-out rings of two lobes 100 mm apart, then two rings round both.
    const lobes = [
      [square(100, 0, 1), square(0, 0, 1)],
      [square(100, 0, 3), square(0, 0, 3)],
      [rect(-5, -5, 105, 5)],
      [rect(-7, -7, 107, 7)],
    ];
    expect(regions(lobes)).toEqual([
      ['0.1', '1.1'],
      ['0.0', '1.0'],
      ['2.0', '3.0'],
    ]);
  });

  it('links a path to the nearest earlier group that has a path next to it, however far back', () => {
    const groups = [[square(0, 0, 1), square(100, 0, 1)], [square(100, 0, 3)], [square(100, 0, 5)], [square(100, 0, 7), square(0, 0, 3)]];
    const links = regionLinks(groups, 3, true);
    expect(links.preds[links.id(3, 1)]).toEqual([links.id(0, 0)]);
    expect(regions(groups)).toEqual([
      ['0.0', '3.1'],
      ['0.1', '1.0', '2.0', '3.0'],
    ]);
  });

  it('starts a lobe whose rings begin later once its own rings are reached', () => {
    const lobes = [[square(0, 0, 1)], [square(0, 0, 3), square(100, 0, 1)], [rect(-5, -5, 105, 5)]];
    expect(regions(lobes)).toEqual([['0.0', '1.0'], ['1.1'], ['2.0']]);
  });
});
