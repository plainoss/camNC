import { CamInputError, validatePaths, validateTool } from './validation';
import { areaD, pointInPolygonD, PointInPolygonResult } from 'clipper2-ts';
import { clipLines, difference, distPointSeg, offset, pathLength, polyArea, union, type PathsD, type Vec3 } from './geom';
import { DEFAULT_SETTINGS, pocketOperation, type CamSettings, type Operation, type Pass, type Tool } from './toolpaths';

/** Artwork V-carved into the top of a board: lettering or filled SVG shapes, already outlined. */
export interface BoardCarving {
  id: string;
  name: string;
  /** Closed outlines on the board, mm, nonzero fill: holes (the inside of an "o") wind the other way. */
  region: PathsD;
  /** The V-bit. */
  tool: Tool;
  /** Deepest cut below the stock top, mm. Wider strokes than this allows get a flat bottom at this depth. */
  maxDepth: number;
  /** Flat bit that clears the flat bottoms first. Without one, the V-bit clears them in fine rings. */
  clearTool?: Tool;
}

/** Sideways step between a V-bit's rings, mm. Walls are exact for straight edges; corners leave cusps this size. */
export const kVCarveStep = 0.2;
/** Deepest a V-bit cuts in one pass when its cutting data sets no stepdown, mm. */
export const kVStepdown = 1.5;
/** How close a deeper ring must come to count as cutting a shallower one's stretch, mm. */
const kCovered = 0.02;
/** Stretches of a ring shorter than this are outline noise: what they'd leave is smaller than a ring step, mm. */
const kMinStretch = 0.1;
/** Longest move between two passes that stays down, cutting, mm. */
const kMaxJoin = 3;
/** Spacing of the checks along such a move, and how far the cone may come past the outline on it, mm. */
const kJoinSample = 0.01;
const kJoinTolerance = 0.01;
/** Leftovers of a flat bit thinner than this are not worth a V-bit pass, mm. */
const kSliver = 0.2;
/** Highest ridge a pointed V-bit may leave between rings on a flat bottom, mm. */
const kFlatCusp = 0.05;

/** How much deeper a V-bit cuts per mm it cuts wider on each side: 1 / tan(angle / 2). */
export function vSlope(tool: Pick<Tool, 'angle'>): number {
  return 1 / Math.tan(((tool.angle ?? 90) / 2) * (Math.PI / 180));
}

/** The deepest a V-bit can cut with its cone, mm: below that, its shank cuts the wall. */
export function vConeDepth(tool: Pick<Tool, 'angle' | 'diameter' | 'tipDiameter'>): number {
  return ((tool.diameter - (tool.tipDiameter ?? 0)) / 2) * vSlope(tool);
}

const linePass = (line: PathsD[number], z: number, feed: number, plungeFeed: number): Pass => {
  const pts: Vec3[] = line.map(q => [q.x, q.y, z]);
  return { pts, feeds: pts.map((_, i) => (i ? feed : plungeFeed)), link: 'retract', phase: 'finish' };
};

const loopPass = (loop: PathsD[number], z: number, feed: number, plungeFeed: number): Pass => {
  const pts: Vec3[] = [...loop, loop[0]].map(q => [q.x, q.y, z]);
  return { pts, feeds: pts.map((_, i) => (i ? feed : plungeFeed)), link: 'retract', phase: 'finish' };
};

/**
 * Separate pieces of a region: each outer loop with the holes inside it. A hole belongs to the smallest outer loop around
 * it, since an island can sit inside another one's hole and have a hole of its own.
 */
function islands(region: PathsD): PathsD[] {
  const outer = region.filter(loop => areaD(loop) > 0);
  const pieces = outer.map(loop => [loop]);
  for (const hole of region.filter(loop => areaD(loop) < 0)) {
    let owner = -1;
    outer.forEach((loop, i) => {
      if (pointInPolygonD(hole[0], loop) === PointInPolygonResult.IsOutside) return;
      if (owner < 0 || areaD(loop) < areaD(outer[owner])) owner = i;
    });
    if (owner >= 0) pieces[owner].push(hole);
  }
  return pieces;
}

/** How far in a region can be offset before it closes up, within (0, limit): to a hundredth of a mm. */
function closesAt(region: PathsD, limit: number): number {
  let lo = 0,
    hi = limit;
  while (hi - lo > 0.01) {
    const mid = (lo + hi) / 2;
    if (offset(region, -mid).length) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Distance from points to an outline, with its edges in a grid of 1 mm cells. */
function outlineDistance(region: PathsD) {
  const cell = 1;
  const grid = new Map<string, [number, number, number, number][]>();
  for (const loop of region)
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length];
      const edge: [number, number, number, number] = [a.x, a.y, b.x, b.y];
      for (let cx = Math.floor(Math.min(a.x, b.x) / cell); cx <= Math.floor(Math.max(a.x, b.x) / cell); cx++)
        for (let cy = Math.floor(Math.min(a.y, b.y) / cell); cy <= Math.floor(Math.max(a.y, b.y) / cell); cy++) {
          const key = `${cx},${cy}`;
          (grid.get(key) ?? grid.set(key, []).get(key)!).push(edge);
        }
    });
  /** Is no part of the outline closer to (x, y) than `r`? */
  return (x: number, y: number, r: number) => {
    for (let cx = Math.floor((x - r) / cell); cx <= Math.floor((x + r) / cell); cx++)
      for (let cy = Math.floor((y - r) / cell); cy <= Math.floor((y + r) / cell); cy++)
        for (const [ax, ay, bx, by] of grid.get(`${cx},${cy}`) ?? []) if (distPointSeg(x, y, ax, ay, bx, by) < r) return false;
    return true;
  };
}

/**
 * Passes one after the other, joined into one where the move between them is short and the cone stays inside the
 * outline all along it, at the depth it ramps through there: no retract and plunge in between.
 */
function joined(passes: Pass[], region: PathsD, reach: (depth: number) => number, stockTop: number, feed: number): Pass[] {
  const clear = outlineDistance(region);
  const out: Pass[] = [];
  for (const pass of passes) {
    const last = out.at(-1);
    const from = last?.pts.at(-1),
      to = pass.pts[0];
    if (last && from) {
      const gap = Math.hypot(to[0] - from[0], to[1] - from[1]);
      let ok = gap <= kMaxJoin && insideRegion(region, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
      for (let k = 0, n = Math.max(1, Math.ceil(gap / kJoinSample)); ok && k <= n; k++) {
        const t = k / n;
        const z = from[2] + (to[2] - from[2]) * t;
        // Both ends are on their limits: a move from one ring to the next deeper along the wall stays on it all the way.
        ok = clear(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, reach(stockTop - z) - kJoinTolerance);
      }
      if (ok) {
        out[out.length - 1] = {
          ...last,
          pts: [...last.pts, ...pass.pts],
          feeds: [...last.feeds, ...pass.feeds.map((f, i) => (i ? f : feed))],
        };
        continue;
      }
    }
    out.push(pass);
  }
  return out;
}

/** Inside a region, nonzero fill: on its outline counts as inside. */
function insideRegion(region: PathsD, x: number, y: number): boolean {
  let winding = 0;
  for (const loop of region) {
    const where = pointInPolygonD({ x, y }, loop);
    if (where === PointInPolygonResult.IsOn) return true;
    if (where === PointInPolygonResult.IsInside) winding += areaD(loop) > 0 ? 1 : -1;
  }
  return winding !== 0;
}

/** Nearest loop next, starting where the last one ended. */
function nearestFirst(passes: Pass[], from: { x: number; y: number }): Pass[] {
  const left = [...passes];
  const out: Pass[] = [];
  let at = from;
  while (left.length) {
    let best = 0,
      bestD = Infinity;
    left.forEach((p, i) => {
      const d = (p.pts[0][0] - at.x) ** 2 + (p.pts[0][1] - at.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const [next] = left.splice(best, 1);
    out.push(next);
    const end = next.pts.at(-1)!;
    at = { x: end[0], y: end[1] };
  }
  return out;
}

/**
 * Operations for one carving: a flat bit's clearing pocket first (when strokes are wider than the depth limit allows
 * and `clearTool` is set), then the V-bit.
 *
 * The V-bit follows the artwork's inward offsets. On the ring at distance r from the outline its tip is at depth
 * (r - tip radius) × slope, where its cone is exactly r wide at the surface: it touches the outline and never cuts past
 * it.
 */
export function carvingOperations(carving: BoardCarving, stockTop: number, settings: Partial<CamSettings> = {}): Operation[] {
  const s: CamSettings = { ...DEFAULT_SETTINGS, ...settings };
  const tool = carving.tool;
  validateTool(tool, 'carving.tool');
  if (tool.shape !== 'v') throw new CamInputError([{ field: 'carving.tool', message: 'must be a V-bit' }]);
  validatePaths(carving.region, 'carving');
  if (!(carving.maxDepth > 0)) throw new CamInputError([{ field: 'carving.maxDepth', message: 'must be greater than zero' }]);
  if (carving.maxDepth >= stockTop)
    throw new CamInputError([{ field: 'carving.maxDepth', message: `must be less than the board's ${stockTop} mm` }]);
  const region = union(carving.region);
  if (!region.length || polyArea(region) <= 0) return [];
  const slope = vSlope(tool);
  const tipR = (tool.tipDiameter ?? 0) / 2;
  const cap = Math.min(carving.maxDepth, vConeDepth(tool));
  const rCap = tipR + cap / slope;
  const feed = tool.feed ?? s.feed;
  const plunge = tool.plungeFeed ?? s.plungeFeed;
  const floorZ = stockTop - cap;
  // Wall passes are ordered nearest first across depths, so the ones where a stroke narrows join up.
  const walls: Pass[] = [];
  const rings: Pass[] = [];
  const lastPoint = () => {
    const end = rings.at(-1)?.pts.at(-1);
    return end ? { x: end[0], y: end[1] } : { x: 0, y: 0 };
  };
  const depthAt = (r: number) => stockTop - (r - tipR) * slope;
  const stepdown = tool.stepdown ?? kVStepdown;
  // A cut deeper than a stepdown is taken in steps along the same path, one pass: an open path back and forth.
  const inSteps = (path: PathsD[number], z: number, closed: boolean): Pass => {
    const depth = stockTop - z;
    const steps = Math.max(1, Math.ceil(depth / stepdown - 1e-9));
    const pts: Vec3[] = [];
    const feeds: number[] = [];
    for (let k = 0; k < steps; k++) {
      const at = k === steps - 1 ? z : stockTop - ((k + 1) * depth) / steps;
      const along = closed ? [...path, path[0]] : k % 2 ? [...path].reverse() : path;
      along.forEach((q, i) => {
        pts.push([q.x, q.y, at]);
        feeds.push(i ? feed : plunge);
      });
    }
    return { pts, feeds, link: 'retract', phase: 'finish' };
  };
  // The walls, from the outline inwards: a ring per step out to the depth limit, or until the artwork closes up. A
  // stroke that closes up between two steps gets one more ring on its centre line, so no ridge is left along its
  // middle. On a straight wall the deepest ring alone cuts it exactly: its cone reaches every point between it and the
  // outline at that point's depth. So a ring is only cut where no deeper ring comes within a step of it, where the
  // artwork narrows.
  const first = Math.min(tipR + kVCarveStep, rCap);
  // A stroke that closes up before even the first ring gets its centre line, as deep as it's wide, or it would be lost.
  // Thinner than the tip of a flat-tipped bit, it can't be cut without cutting wider than drawn.
  for (const part of islands(region)) {
    if (offset(part, -first).length) continue;
    const last = closesAt(part, first);
    if (last <= tipR + 1e-3) continue;
    walls.push(...offset(part, -last).map(loop => inSteps(loop, depthAt(last), true)));
  }
  for (let r = first; ; ) {
    const level = offset(region, -r);
    if (!level.length) break;
    const z = depthAt(r);
    if (r >= rCap) {
      walls.push(...level.map(loop => inSteps(loop, z, true)));
      break;
    }
    const next = Math.min(r + kVCarveStep, rCap);
    // Strokes that close up before the next step: their centre line, the deepest they go.
    const centres: { loops: PathsD; z: number }[] = [];
    let reached = offset(offset(region, -next), next - r + kCovered);
    for (const part of islands(level)) {
      if (offset(part, -(next - r)).length) continue;
      const last = closesAt(part, next - r);
      if (last <= 1e-3) continue;
      const centre = offset(part, -last);
      centres.push({ loops: centre, z: depthAt(r + last) });
      reached = union(reached, offset(centre, last + kCovered));
    }
    const open = clipLines(
      level.map(loop => [...loop, loop[0]]),
      difference(offset(region, -(r - kVCarveStep / 2)), reached)
    ).filter(line => pathLength(line, false) > kMinStretch);
    walls.push(...open.map(line => inSteps(line, z, false)));
    for (const centre of centres) walls.push(...centre.loops.map(loop => inSteps(loop, centre.z, true)));
    r = next;
  }
  rings.push(...nearestFirst(walls, { x: 0, y: 0 }));
  const flat = offset(region, -rCap);
  const operations: Operation[] = [];
  const warnings: string[] = [];
  if (flat.length) {
    warnings.push(
      cap < carving.maxDepth
        ? `Strokes wider than ${(2 * rCap).toFixed(1)} mm get a flat bottom: the V-bit's cone is only ${cap.toFixed(1)} mm deep`
        : `Strokes wider than ${(2 * rCap).toFixed(1)} mm get a flat bottom at ${cap.toFixed(1)} mm deep`
    );
    // A flat bit only helps where it fits; otherwise the V-bit clears the whole flat bottom.
    const clearTool = carving.clearTool && offset(flat, -carving.clearTool.diameter / 2).length ? carving.clearTool : undefined;
    // Rings at the floor: right across a flat bottom with no flat bit, or only in the corners its radius can't reach.
    const flatStep = Math.max(0.02, (2 * kFlatCusp) / slope + 2 * tipR);
    const R = clearTool ? clearTool.diameter / 2 : 0;
    // What the flat bit leaves: corners narrower than its radius. Slivers thinner than kSliver are outline noise.
    const left = clearTool
      ? offset(offset(difference(flat, offset(offset(flat, -R), R - kCovered)), -kSliver / 2), kSliver / 2 + flatStep)
      : undefined;
    for (let d = flatStep; ; d += flatStep) {
      const level = offset(region, -(rCap + d));
      if (!level.length || (clearTool && d > R + flatStep)) break;
      const paths = left
        ? clipLines(
            level.map(loop => [...loop, loop[0]]),
            left
          )
        : level;
      rings.push(
        ...nearestFirst(
          paths.map(path => (left ? linePass(path, floorZ, feed, plunge) : loopPass(path, floorZ, feed, plunge))),
          lastPoint()
        )
      );
    }
    if (clearTool) {
      const clear = pocketOperation(`${carving.name}: clear flat bottoms`, flat, stockTop, floorZ, clearTool, s);
      operations.push({ ...clear, title: 'clear flat bottoms', feature: 'pocket' });
    }
  }
  const passes = joined(rings, region, depth => tipR + depth / slope, stockTop, feed);
  if (passes.length)
    operations.push({
      name: `${carving.name}: V-carve`,
      title: `V-carve, up to ${cap.toFixed(1)} deep`,
      kind: 'vcarve',
      feature: 'pocket',
      tool,
      plungeFeed: plunge,
      passes,
      ...(warnings.length && { warnings }),
    });
  return operations;
}
