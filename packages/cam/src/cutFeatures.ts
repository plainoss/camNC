import { areaD, type PathsD } from 'clipper2-ts';
import { cleanRegion, difference, intersect, polyArea, union, type PathD } from './geom';
import { openPocketRegion, type Level, type PartFeatures, type PocketFeature } from './features';

export interface FlatCut {
  id: string;
  /** mm below the top: where the cut starts and its floor. */
  from: number;
  to: number;
  through: boolean;
  outline: PathD;
  /** Regions nested in the outline, left uncut. */
  islands: PathD[];
}
export interface FlatProfile {
  thickness: number;
  /** Counterclockwise. */
  outline: PathD;
  /** Counterclockwise, as cut through the part. */
  holes: PathD[];
  cuts: FlatCut[];
}

const Z_TOL = 0.005;
const reversed = (paths: PathsD) => paths.map(path => [...path].reverse());

/** What each through hole comes from: its index in `holes`, or the cut that made it. */
export type HoleSource = { hole: number } | { cut: string };

/**
 * A profile's 2.5D features, built from its polygons so exact curves reach CAM without going through a mesh. Cuts apply
 * in order to a height map. A cut only removes what's under its start, so a cut on a pocket floor can't undercut the
 * material beside that pocket.
 */
export function featuresFromCuts(
  { thickness, outline, holes, cuts }: FlatProfile,
  extendOpen = 2
): { features: PartFeatures; holeSources: HoleSource[] } {
  let footprint: PathsD = [outline, ...reversed(holes)];
  const heights = new Map<number, PathsD>([[thickness, footprint]]);
  const quantize = (z: number) => +(Math.round(z / Z_TOL) * Z_TOL).toFixed(4);
  const holeCuts: { id: string; region: PathsD }[] = [];
  for (const cut of cuts) {
    const floor = cut.through ? 0 : quantize(thickness - cut.to),
      start = quantize(thickness - cut.from);
    let shape = intersect(difference([cut.outline], cut.islands), footprint);
    if (cut.from > 0) {
      const open = [...heights].filter(([z]) => z <= start + Z_TOL).flatMap(([, region]) => region);
      shape = intersect(shape, union(open, []));
    }
    if (polyArea(shape) <= 0) continue;
    const removed: PathsD = [];
    for (const [z, region] of heights) {
      if (z <= floor + Z_TOL) continue;
      removed.push(...intersect(region, shape));
      heights.set(z, difference(region, shape));
    }
    if (cut.through) {
      footprint = difference(footprint, shape);
      holeCuts.push({ id: cut.id, region: shape });
    } else heights.set(floor, union(heights.get(floor) ?? [], removed));
  }

  const outlines = holeCuts.length ? footprint.filter(path => areaD(path) > 0) : [outline];
  let throughHoles = holes,
    holeSources: HoleSource[] = holes.map((_, hole) => ({ hole }));
  if (holeCuts.length) {
    // Holes no through cut overlaps keep their place and exact points, because saved hole choices refer to them. What
    // Clipper hands back is rounded, so it can't be matched to them by comparing shapes.
    const overlap = (a: PathD, b: PathsD) => polyArea(intersect([a], b)) > 0,
      loops = footprint.filter(path => areaD(path) < 0).map(path => [...path].reverse()),
      added = loops.flatMap(path => {
        const from = holeCuts.find(({ region }) => overlap(path, region));
        return from ? [{ path, source: { cut: from.id } as HoleSource }] : [];
      }),
      // A hole a cut merged into is gone. One still its own loop stays, even inside an island the cut went around.
      untouched = loops.filter(path => !holeCuts.some(({ region }) => overlap(path, region))),
      kept = holes.flatMap((path, hole) => (overlap(path, untouched) ? [{ path, source: { hole } as HoleSource }] : []));
    throughHoles = [...kept, ...added].map(entry => entry.path);
    holeSources = [...kept, ...added].map(entry => entry.source);
  }

  const meshLevels: Level[] = [...heights]
    .sort((a, b) => b[0] - a[0])
    .map(([z, region]) => ({ z, region, area: polyArea(region) }))
    .filter(level => level.area > 0);
  const levels: Level[] = meshLevels
    .map(level => {
      const region = cleanRegion(level.region);
      return { z: level.z, region, area: polyArea(region) };
    })
    .filter(level => level.area > 0.5);
  // Measured from the thickness, not the highest level: cuts can cover the whole top, and each one starts at the surface.
  const pockets: PocketFeature[] = [];
  for (const level of levels) {
    if (level.z >= thickness - Z_TOL || level.z <= Z_TOL) continue;
    // From the exact heights, because cleaning a level drops small islands that must not be machined away.
    const above = union(
      [...heights].filter(([z]) => z > level.z + Z_TOL).flatMap(([, region]) => region),
      []
    );
    const strictRegion = difference(cleanRegion(difference(footprint, above), 0.01, 0.5), above);
    if (!strictRegion.length) continue;
    const pocket = { floorZ: level.z, strictRegion, above, area: polyArea(strictRegion) };
    pockets.push({ ...pocket, region: openPocketRegion(outlines, pocket, extendOpen) });
  }
  return {
    features: { thickness, footprint, outlines, throughHoles, levels, meshLevels, pockets, bottomFaces: [], slopedArea: 0 },
    holeSources,
  };
}

type Point = { x: number; y: number };

/** A cut as CAD hands it over: from the top unless it says it's from the underside. */
export interface SidedCut extends FlatCut {
  side?: 'top' | 'underside';
}

/**
 * A flat part's features from its profile in any position, as CAM takes it: moved so its corner is at the origin, loops
 * counterclockwise. Cuts from the underside become side B's features. `problem` says why CAM can't hold the part.
 */
export function profileFeatures(source: { thickness: number; outline: Point[]; holes: Point[][]; cuts?: readonly SidedCut[] }): {
  /** Side A's features, with side B's pockets as bottom faces. */
  features: PartFeatures;
  /** Side B's pockets with depths from the underside, as cut, when there are any. */
  below: PartFeatures | null;
  /** Side B's features for the part turned over about X, or about Y when it lies rotated. */
  turned?: (axis: 'x' | 'y') => PartFeatures;
  /** For each through hole, what made it, when there are cuts from the top. */
  holeSources?: HoleSource[];
  offset: Point;
  size: [number, number, number];
  problem?: string;
} {
  const x0 = Math.min(...source.outline.map(p => p.x));
  const y0 = Math.min(...source.outline.map(p => p.y));
  const offset = { x: x0, y: y0 };
  const point = (p: Point) => ({ x: p.x - x0, y: p.y - y0 });
  const area = (loop: Point[]) =>
    loop.reduce((sum, p, i) => {
      const q = loop[(i + 1) % loop.length]!;
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2;
  const positive = (loop: Point[]) => (area(loop) < 0 ? [...loop].reverse() : loop);
  const outer = positive(source.outline.map(point));
  const inner = source.holes.map(h => positive(h.map(point)));
  const size: [number, number, number] = [Math.max(...outer.map(p => p.x)), Math.max(...outer.map(p => p.y)), source.thickness];
  const footprint = [outer, ...inner.map(h => [...h].reverse())];
  const plainFeatures: PartFeatures = {
    thickness: source.thickness,
    footprint,
    outlines: [outer],
    throughHoles: inner,
    levels: [{ z: source.thickness, region: footprint, area: area(outer) - inner.reduce((sum, h) => sum + area(h), 0) }],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
  const failed = (problem: string) => ({ features: plainFeatures, below: null, offset, size, problem });
  const flat = ({ side: _side, ...c }: SidedCut): FlatCut => ({
    ...c,
    outline: c.outline.map(point),
    islands: c.islands.map(island => island.map(point)),
  });
  const cuts = source.cuts ?? [];
  // A through cut is the same hole from either face, so it belongs to the first side, which cuts through.
  const fromBelow = cuts.filter(c => c.side === 'underside' && !c.through).map(flat);
  const aboveCuts = cuts.filter(c => c.side !== 'underside' || c.through);
  // A floor's through cut only reaches as far as its pocket does. From below, that would have to be worked out on side B
  // first, which this doesn't do yet.
  if (aboveCuts.some(c => c.side === 'underside' && c.from > 0))
    return failed("a through cut from an underside pocket's floor can't be machined yet. Cut it from the underside itself.");
  const fromAbove = aboveCuts.map(c => ({ ...flat(c), from: c.side === 'underside' ? 0 : c.from }));
  const profile = { thickness: source.thickness, outline: outer, holes: inner };
  const cut = fromAbove.length ? featuresFromCuts({ ...profile, cuts: fromAbove }) : null;
  // CAD refuses a through cut that reaches the edge, but cuts from separate sketches can still add up to a split.
  if (cut && cut.features.outlines.length !== 1) return failed('these through cuts split the part. Use a separate part for each piece.');
  const plain = cut?.features ?? plainFeatures;
  const below = fromBelow.length ? featuresFromCuts({ ...profile, holes: plain.throughHoles, cuts: fromBelow }).features : null;
  if (below && cutsMeet(plain, below)) return failed('cuts from the two faces meet. Make them shallower, or cut through.');
  const features: PartFeatures = below
    ? { ...plain, bottomFaces: below.pockets.map(pocket => ({ z: source.thickness - pocket.floorZ, area: pocket.area })) }
    : plain;
  return {
    features,
    below,
    // Side B reads these exact polygons, rather than extracting them from a mesh as it does for imported models.
    ...(below && {
      turned: (axis: 'x' | 'y') =>
        featuresFromCuts(flippedProfile({ ...profile, holes: plain.throughHoles, cuts: fromBelow }, axis, [size[0], size[1]])).features,
    }),
    ...(cut && { holeSources: cut.holeSources }),
    offset,
    size,
  };
}

/**
 * The same profile as side B sees it: the part turned over around its X axis, or its Y axis when it lies turned. Only
 * the positions change. A cut's depths still count from the face it's cut from.
 */
export function flippedProfile(profile: FlatProfile, axis: 'x' | 'y', [width, height]: [number, number]): FlatProfile {
  const turn = (path: PathD) => path.map(p => (axis === 'x' ? { x: p.x, y: height - p.y } : { x: width - p.x, y: p.y })).reverse();
  return {
    ...profile,
    outline: turn(profile.outline),
    holes: profile.holes.map(turn),
    cuts: profile.cuts.map(cut => ({ ...cut, outline: turn(cut.outline), islands: cut.islands.map(turn) })),
  };
}

/** Whether cuts from the two faces would meet, which would make a hole neither side's program means to cut. */
export function cutsMeet(top: PartFeatures, underside: PartFeatures): boolean {
  const cuts = (f: PartFeatures) => f.levels.filter(level => level.z < f.thickness - Z_TOL);
  return cuts(top).some(a =>
    cuts(underside).some(b => a.z <= top.thickness - b.z + Z_TOL && Math.abs(polyArea(intersect(a.region, b.region))) > 0.01)
  );
}
