import { pointInPolygonD, PointInPolygonResult, type PathD, type PathsD } from 'clipper2-ts';
import { CamInputError, validateCamSettings, validateDepthRange, validatePaths, validateTool } from './validation';
import { clipLines, difference, intersect, offset, pathLength, PRECISION, type Vec3 } from './geom';
import type { MotionRole } from './motion';
import { geometryTolerances, planAccuracy } from './accuracy';
import { conservativePocketRingSpacing, pocketEndpointDeviation, pocketRingSpacing } from './pocketSpacing';
import { createPocketRings } from './pocketRings';
import { forEachRegion, regionLinks } from './pocketRegionOrder';
import { pocketCoverageRadius, pocketRingsCoverFloor, pocketRowsCoverFloor } from './pocketCoverage';
import { nextPocketFloorSpacing } from './pocketFloorRefinement';
import type { CamSettings, Operation, Pass, Tool } from './toolpathTypes';
import {
  type Loop,
  offsetToleranceFor,
  dist2,
  rotateToNearest,
  closeLoop,
  rampLoop,
  components,
  stepdownFor,
  depthLevels,
  cuttingWith,
  scheduledPass,
  finishRoles,
} from './passPlanning';

const outsideAll = (p: { x: number; y: number }, solid: PathsD) =>
  solid.every(o => pointInPolygonD(p, o) === PointInPolygonResult.IsOutside);

/**
 * For a pocket that is open to the part's edge: the loop rotated to start at the longest edge that lies in the waste
 * outside the part (loop[0] -> loop[1]). Undefined for closed pockets.
 */
function rotateToWaste(loop: Loop, solid: PathsD): Loop | undefined {
  let best = -1,
    bl = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i],
      b = loop[(i + 1) % loop.length];
    const l = dist2(a, b);
    if (l > bl && outsideAll(a, solid) && outsideAll(b, solid)) {
      bl = l;
      best = i;
    }
  }
  if (best < 0) return undefined;
  return [...loop.slice(best), ...loop.slice(0, best)];
}

/**
 * Entry for a loop that starts on a waste edge (see rotateToWaste): zigzag ramp along that edge until zTo, so the
 * whole descent stays outside the part however long the ramp, then one full lap at zTo from there.
 */
function rampOnWasteEdge(loop: Loop, zFrom: number, zTo: number, s: CamSettings): Pass {
  const [a, b] = loop;
  const edge = Math.sqrt(dist2(a, b));
  const slope = Math.tan((s.rampAngleDeg * Math.PI) / 180);
  if ((zFrom - zTo) / (edge * slope) > 1000)
    throw new CamInputError([{ field: 'rampAngleDeg', message: 'would require more than 1000 entry traversals' }]);
  const pts: Vec3[] = [[a.x, a.y, zFrom]];
  const feeds = [s.plungeFeed];
  let z = zFrom,
    forward = true;
  for (let leg = 0; z > zTo && leg < 1000; leg++, forward = !forward) {
    const drop = edge * slope;
    const t = z - drop > zTo ? 1 : (z - zTo) / drop;
    const [from, to] = forward ? [a, b] : [b, a];
    z = Math.max(zTo, z - drop);
    pts.push([from.x + t * (to.x - from.x), from.y + t * (to.y - from.y), z]);
    feeds.push(s.feed);
  }
  // Lap at depth: on to b, around the loop back to a, then to where the ramp ended.
  const end = pts[pts.length - 1];
  for (const p of [...loop.slice(1), a]) {
    pts.push([p.x, p.y, zTo]);
    feeds.push(s.feed);
  }
  pts.push([end[0], end[1], zTo]);
  feeds.push(s.feed);
  return { pts, feeds, link: 'retract' };
}

/** Inside a region given as Clipper paths (outer loops + holes), by crossing parity. */
function insideRegion(p: { x: number; y: number }, region: PathsD) {
  let n = 0;
  for (const path of region) if (pointInPolygonD(p, path, PRECISION) === PointInPolygonResult.IsInside) n++;
  return n % 2 === 1;
}

function segmentInside(a: { x: number; y: number }, b: { x: number; y: number }, region: PathsD) {
  const n = Math.max(2, Math.ceil(Math.sqrt(dist2(a, b)) / 0.5));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (!insideRegion({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }, region)) return false;
  }
  return true;
}

/**
 * A wall pass with tangent quarter-arc lead-in and lead-out from the pocket interior: the bit never
 * moves into the wall, it joins and leaves it along its direction. Entry in the middle of the straight wall segment
 * nearest to `from`; the arc radius starts at r and shrinks until the arcs fit into `free` (where the bit center can
 * go). Undefined if no arc fits (then the caller cuts the loop plainly).
 */
function wallPassWithLeads(
  loop: Loop,
  from: { x: number; y: number },
  z: number,
  feed: number,
  r: number,
  free: PathsD,
  tolerance = 0.005
): Pass | undefined {
  const n = loop.length;
  const segs = loop
    .map((a, i) => ({ i, a, b: loop[(i + 1) % n], len: Math.sqrt(dist2(a, loop[(i + 1) % n])) }))
    .filter(sg => sg.len > 0.2)
    .sort((p, q) => q.len - p.len);
  if (!segs.length) return undefined;
  // Long straight segments (at least half as long as the longest) qualify; the nearest one wins.
  const long = segs.filter(sg => sg.len >= segs[0].len / 2);
  const mid = (sg: (typeof segs)[number]) => ({ x: (sg.a.x + sg.b.x) / 2, y: (sg.a.y + sg.b.y) / 2 });
  const seg = long.reduce((best, sg) => (dist2(mid(sg), from) < dist2(mid(best), from) ? sg : best));
  const P = mid(seg);
  const t = { x: (seg.b.x - seg.a.x) / seg.len, y: (seg.b.y - seg.a.y) / seg.len };
  let nrm = { x: -t.y, y: t.x };
  if (!insideRegion({ x: P.x + nrm.x * 0.05, y: P.y + nrm.y * 0.05 }, free)) nrm = { x: t.y, y: -t.x };
  // +1: the normal is t turned left, so both arcs turn left (CCW); -1 right.
  const sense = nrm.x === -t.y && nrm.y === t.x ? 1 : -1;
  for (const rho of [r, 0.75 * r, 0.5 * r, 0.25 * r]) {
    if (rho > seg.len / 2) continue;
    const C = { x: P.x + nrm.x * rho, y: P.y + nrm.y * rho };
    // Points on the circle: C + rho * rotate(-t, angle).
    const at = (deg: number) => {
      const a = (sense * deg * Math.PI) / 180;
      const vx = -t.x,
        vy = -t.y;
      return { x: C.x + rho * (vx * Math.cos(a) - vy * Math.sin(a)), y: C.y + rho * (vx * Math.sin(a) + vy * Math.cos(a)) };
    };
    const steps = Math.max(6, Math.ceil(Math.PI / 2 / (2 * Math.acos(Math.max(-1, 1 - Math.min(tolerance, rho) / rho)))));
    const leadIn = Array.from({ length: steps }, (_, i) => at((90 * i) / steps));
    const leadOut = Array.from({ length: steps }, (_, i) => at(90 + (90 * (i + 1)) / steps));
    if (![...leadIn, ...leadOut].every(q => insideRegion(q, free))) continue;
    const lap = [P, ...loop.slice(seg.i + 1), ...loop.slice(0, seg.i + 1), P];
    const pts: Vec3[] = [...leadIn, ...lap, ...leadOut].map(q => [q.x, q.y, z]);
    const roles: MotionRole[] = pts.map((_, i) =>
      i === 0 ? 'link' : i <= leadIn.length ? 'lead-in' : i < leadIn.length + lap.length ? 'cut' : 'lead-out'
    );
    return { pts, feeds: pts.map(() => feed), roles, link: 'direct' };
  }
  return undefined;
}

/** Default radial wall allowance for pockets open to the edge. */
const kOpenWallAllowance = 0.2;

/** `line` turned so that `walls` (a region it runs along the boundary of) is on its right: climb with an M3 spindle. */
function wallsOnRight(line: PathD, walls: PathsD): PathD {
  let best = 1;
  for (let i = 2; i < line.length; i++) if (dist2(line[i - 1], line[i]) > dist2(line[best - 1], line[best])) best = i;
  const a = line[best - 1],
    b = line[best];
  const len = Math.sqrt(dist2(a, b)) || 1;
  // A point just to the right of the longest segment.
  const probe = { x: (a.x + b.x) / 2 + ((b.y - a.y) / len) * 0.01, y: (a.y + b.y) / 2 - ((b.x - a.x) / len) * 0.01 };
  return insideRegion(probe, walls) ? line : [...line].reverse();
}

/**
 * Clipped pieces of closed loops, with the two pieces that meet where a loop starts (`seams`) joined back into one: the
 * loop's start is just where it was opened for clipping, not an end of the path.
 */
function joinAtSeams(pieces: PathsD, seams: { x: number; y: number }[]): PathsD {
  const at = (p: { x: number; y: number }, q: { x: number; y: number }) => dist2(p, q) < 1e-12;
  const out = [...pieces];
  for (const seam of seams) {
    const a = out.findIndex(l => at(l[l.length - 1], seam) || at(l[0], seam));
    const b = out.findIndex((l, i) => i !== a && (at(l[0], seam) || at(l[l.length - 1], seam)));
    if (a < 0 || b < 0) continue;
    const into = at(out[a][out[a].length - 1], seam) ? out[a] : [...out[a]].reverse();
    const from = at(out[b][0], seam) ? out[b] : [...out[b]].reverse();
    out[a] = [...into, ...from.slice(1)];
    out.splice(b, 1);
  }
  return out;
}

/** Distance from p to the nearest edge of `paths` (closed loops). */
function distToEdges(p: { x: number; y: number }, paths: PathsD): number {
  let best = Infinity;
  for (const loop of paths)
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i],
        b = loop[(i + 1) % loop.length];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, (a.x + t * dx - p.x) ** 2 + (a.y + t * dy - p.y) ** 2);
    }
  return Math.sqrt(best);
}

/** Points of `line` up to arc length `len` (the last one interpolated). */
function prefix(line: PathD, len: number): PathD {
  const out = [line[0]];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const d = Math.sqrt(dist2(line[i - 1], line[i]));
    if (acc + d >= len) {
      const t = (len - acc) / (d || 1);
      out.push({ x: line[i - 1].x + t * (line[i].x - line[i - 1].x), y: line[i - 1].y + t * (line[i].y - line[i - 1].y) });
      return out;
    }
    acc += d;
    out.push(line[i]);
  }
  return out;
}

/** Ramp down from zFrom to zTo going back and forth along the start of `line`, then run all of it at zTo. */
function rampAlong(line: PathD, zFrom: number, zTo: number, s: CamSettings): Pass {
  const slope = Math.tan((s.rampAngleDeg * Math.PI) / 180);
  const leg = prefix(line, Math.min(pathLength(line, false), 30));
  const legLen = pathLength(leg, false);
  if (legLen <= 0 || (zFrom - zTo) / (legLen * slope) > 1000)
    throw new CamInputError([{ field: 'rampAngleDeg', message: 'entry cannot reach the floor within 1000 traversals' }]);
  const pts: Vec3[] = [[leg[0].x, leg[0].y, zFrom]];
  const feeds = [s.plungeFeed];
  let z = zFrom,
    forward = true;
  for (let n = 0; z > zTo + 1e-9 && n < 1000 && legLen > 0; n++, forward = !forward) {
    const way = forward ? leg : [...leg].reverse();
    for (let i = 1; i < way.length && z > zTo + 1e-9; i++) {
      const d = Math.sqrt(dist2(way[i - 1], way[i]));
      const t = Math.min(1, (z - zTo) / (d * slope || 1e-9));
      z = Math.max(zTo, z - d * t * slope);
      pts.push([way[i - 1].x + t * (way[i].x - way[i - 1].x), way[i - 1].y + t * (way[i].y - way[i - 1].y), z]);
      feeds.push(s.feed);
    }
  }
  // Down: back to the start of the line along it, then the whole line at depth.
  const at = pts[pts.length - 1];
  const back = leg.filter((_, i) => i > 0 && !(forward === false && i === leg.length - 1));
  const k = back.findIndex(q => Math.abs(q.x - at[0]) < 1e-9 && Math.abs(q.y - at[1]) < 1e-9);
  for (const q of [...(k >= 0 ? back.slice(0, k) : back)].reverse()) {
    pts.push([q.x, q.y, zTo]);
    feeds.push(s.feed);
  }
  for (const q of line) {
    pts.push([q.x, q.y, zTo]);
    feeds.push(s.feed);
  }
  return { pts, feeds, link: 'retract' };
}

/**
 * A pocket open to the part's edge (rabbet, edge groove): passes parallel to its walls, from the far (waste) side in
 * towards them, each at most a stepover closer, so the bit is never buried in a full-width cut next to a wall. Per
 * depth the farthest pass ramps in, the nearest runs `allowance` off the walls, climb; then bounded finishing passes
 * finishes the walls. Every pass starts and ends where the region meets the waste and runs along the end walls and
 * around their corners: no move straight into a wall, no sharp turn onto it.
 */
function openPocketPasses(
  comp: PathsD,
  walls: PathsD,
  solid: PathsD,
  topZ: number,
  floorZ: number,
  tool: Tool,
  s: CamSettings,
  from: { x: number; y: number },
  stepover = pocketRingSpacing(s, tool.diameter),
  coverageAttempt = 0
): Pass[] {
  const r = tool.diameter / 2;
  const offsetPaths = (paths: PathsD, delta: number) => offset(paths, delta, offsetToleranceFor(s));
  const stepdown = stepdownFor(tool, s);
  const levels = depthLevels(topZ, floorZ, stepdown);
  // A shallow pocket (the last few tenths of a rabbet) cuts its walls lightly anyway: no separate finishing pass.
  const allowance = s.pocketWallAllowance || (topZ - floorZ > 1 ? (s.openWallAllowance ?? kOpenWallAllowance) : 0);
  const free = offsetPaths(comp, -r);
  const physicalFree = intersect(free, solid);
  const openingReserve = pocketTransitionDeviation(s) + 2 * offsetToleranceFor(s) + 0.002;
  const entrySolid = physicalFree.length ? offsetPaths(solid, openingReserve) : solid;
  // A path right at the free area's edge (the row next to the walls) would come out of the clip in slivers: clip to
  // a hair more. Paths are at least `d` >= r from the walls anyway.
  const clipArea = offsetPaths(free, 0.01);
  // Survey useful center positions inside the part, then search farther to find any wider chamber's interior.
  let far = 0;
  for (const loop of physicalFree.length ? physicalFree : free)
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i],
        b = loop[(i + 1) % loop.length];
      const steps = Math.max(1, Math.ceil(Math.sqrt(dist2(a, b))));
      for (let k = 0; k < steps; k++)
        far = Math.max(far, distToEdges({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }, walls));
    }
  // Only the walls within reach matter: offsetting the whole part for every pass is what's slow.
  const xs = comp.flat().map(q => q.x),
    ys = comp.flat().map(q => q.y);
  const reach = (m: number) => {
    const [x0, y0, x1, y1] = [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
    return intersect(walls, [
      [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
    ]);
  };
  let localWalls = reach(far + r + 2);
  // The bit-center paths `d` away from the walls, inside the free area, walls on the right.
  const cache = new Map<number, PathD[]>();
  const along = (d: number) => {
    const hit = cache.get(d);
    if (hit) return hit;
    const around = offsetPaths(localWalls, d);
    const out = joinAtSeams(
      clipLines(
        around.map(l => [...l, l[0]]),
        clipArea
      ),
      around.map(l => l[0])
    )
      .filter(l => l.length > 1 && pathLength(l, false) > 0.5)
      .map(l => wallsOnRight(l, around));
    cache.set(d, out);
    return out;
  };
  // Keep extended endpoints for safe entries, but exclude rows that only cross distant waste.
  // Very narrow edge cuts can require every center outside the part, so retain their existing bounded search.
  const useful = (d: number) =>
    physicalFree.length ? clipLines(along(d), entrySolid).some(line => pathLength(line, false) > 0.001) : along(d).length > 0;
  // Rough rows retain the requested wall allowance even after the centerline/offset uncertainty.
  // The separate wall-finishing row still runs at the nominal cutter radius.
  const roughReserve = allowance > 0 ? openingReserve : 0;
  const near = r + allowance + roughReserve;
  if (!along(near).length) return [];
  // A thin exterior margin preserves the ramp in waste without adding a whole row at the extended clip boundary.
  let lo = Math.max(near, physicalFree.length ? far + openingReserve / 2 : far - 0.01);
  for (let i = 0; i < 200 && useful(lo + 0.5 * stepover); i++) {
    lo += 0.5 * stepover;
    if (lo + r + 2 > far + r + 2) {
      far = lo;
      localWalls = reach(far + r + 2);
      cache.clear();
    }
  }
  while (lo > near && !useful(lo)) lo = Math.max(near, lo - 0.05);
  // Every row hop must fit the selected stepover with both endpoint deviations reserved.
  const span = lo - near;
  const n = Math.max(0, Math.ceil(span / stepover - 1e-9));
  if (coverageAttempt && n > 10_000)
    throw new CamInputError([{ field: 'stepoverFactor', message: 'would require more than 10000 pocket coverage rows' }]);
  const rows = Array.from({ length: n + 1 }, (_, k) => along(n ? lo - (k * (lo - near)) / n : near));
  const conservative = conservativePocketRingSpacing(s, tool.diameter);
  const floorLines = [...rows.flat(), ...(allowance > 0 ? along(r) : [])];
  // Parallel spacing alone misses diagonal gaps. Rebuild only this component until its actual clipped rows prove coverage.
  if (!pocketRowsCoverFloor(comp, floorLines, tool.diameter, s, solid))
    return openPocketPasses(
      comp,
      walls,
      solid,
      topZ,
      floorZ,
      tool,
      s,
      from,
      nextPocketFloorSpacing(stepover, conservative, coverageAttempt),
      coverageAttempt + 1
    );
  // Where the rows split (the arms of an edge groove), each arm is cut through all its depths before the next.
  const links = regionLinks(rows, tool.diameter + stepover, false);
  // The row next to the walls is climb; each row before it runs the way that ends where the one it leads into starts.
  for (let k = n - 1; k >= 0; k--)
    rows[k] = rows[k].map((l, i) => {
      const to = links.nodes[links.succs[links.id(k, i)][0]];
      const next = to ? rows[to.group][to.index][0] : rows[k + 1][0]?.[0];
      return next && dist2(l[0], next) < dist2(l[l.length - 1], next) ? [...l].reverse() : l;
    });
  const passes: Pass[] = [];
  let last: Vec3 | undefined;
  const run = (line: PathD, z: number, feed: number, rampFrom?: number) => {
    const hop = last ? Math.sqrt(dist2({ x: last[0], y: last[1] }, line[0])) : Infinity;
    const pass: Pass =
      rampFrom !== undefined
        ? rampAlong(line, rampFrom, z, s)
        : hop + 2 * pocketEndpointDeviation(s) <= s.stepoverFactor * tool.diameter && last && last[2] === z
          ? { pts: line.map(q => [q.x, q.y, z]), feeds: line.map(() => feed), link: 'direct' }
          : { pts: line.map(q => [q.x, q.y, z]), feeds: line.map((_, k) => (k === 0 ? s.plungeFeed : feed)), link: 'retract' };
    passes.push(pass);
    last = pass.pts[pass.pts.length - 1];
  };
  forEachRegion(rows, links, false, from, region => {
    let prevZ = topZ;
    for (const z of levels) {
      region.forEach(({ group, index }, i) => run(rows[group][index], z, s.feed, i === 0 ? prevZ : undefined));
      prevZ = z;
    }
    return last && { x: last[0], y: last[1] };
  });
  // Finish the walls at bounded axial depths, climb.
  if (allowance > 0)
    for (const z of depthLevels(topZ, floorZ, s.pocketFinishStepdown ?? stepdown))
      for (const line of along(r)) {
        run(line, z, s.finishFeed ?? s.feed * s.pocketFinishFeedFactor);
        passes[passes.length - 1] = finishRoles(passes[passes.length - 1]);
      }
  return passes;
}

/** Contour-parallel (offset) pocket, innermost ring first, ramped entries, climb by default. */
/** `solid`: the part's outlines; ramp entries of pockets open to the edge then start in the waste outside them. */
function pocketTransitionDeviation(settings: CamSettings): number {
  const budget = planAccuracy(settings.geometryTolerance, settings.sourceTolerance).budget;
  return budget.fitting + budget.outputRounding + budget.controllerRounding;
}

function withPocketTransitions(
  operation: Operation,
  region: PathsD,
  settings: CamSettings,
  wallAllowance = settings.pocketWallAllowance,
  retainedSolid?: PathsD
): Operation {
  const maximumStepover = settings.stepoverFactor * operation.tool.diameter;
  let last: Vec3 | undefined;
  const passes = operation.passes.map(pass => {
    const first = pass.pts[0];
    const candidate =
      pass.link === 'direct' &&
      last &&
      last[2] === first[2] &&
      Math.hypot(last[0] - first[0], last[1] - first[1]) > 0 &&
      Math.hypot(last[0] - first[0], last[1] - first[1]) <= maximumStepover;
    const resolved = candidate ? { ...pass, cuttingTransition: { from: [...last!] as Vec3, to: [...first] as Vec3 } } : pass;
    last = pass.pts.at(-1);
    return resolved;
  });
  return {
    ...operation,
    plungeFeed: settings.plungeFeed,
    pocketTransition: {
      region: region.map(path => path.map(point => ({ ...point }))),
      maximumStepover,
      cutFeed: settings.feed,
      transitionFeed: settings.transitionFeed ?? settings.feed,
      wallAllowance,
      ...(retainedSolid ? { retainedSolid: retainedSolid.map(path => path.map(point => ({ ...point }))) } : {}),
    },
    passes,
  };
}

export function pocketOperation(
  name: string,
  region: PathsD,
  topZ: number,
  floorZ: number,
  tool: Tool,
  settings: CamSettings,
  solid?: PathsD
): Operation {
  validateCamSettings(settings);
  validateTool(tool);
  validatePaths(region, 'pocket');
  validateDepthRange(topZ, floorZ, stepdownFor(tool, settings));
  const s = cuttingWith(tool, settings);
  if (s.pocketFinishStepdown !== undefined) validateDepthRange(topZ, floorZ, s.pocketFinishStepdown);
  const offsetPaths = (paths: PathsD, delta: number) => offset(paths, delta, offsetToleranceFor(s));
  const leadTolerance = geometryTolerances(s.geometryTolerance, s.sourceTolerance).lead;
  const r = tool.diameter / 2;
  // Leave room for both endpoint deviations while keeping the physical hop within the selected stepover.
  const stepover = pocketRingSpacing(s, tool.diameter);
  const stepdown = stepdownFor(tool, s);
  const passes: Pass[] = [];
  let roughWallAllowance = s.pocketWallAllowance;
  let pos = { x: 0, y: 0 };
  const comps = components(region);
  // The material the pocket's walls belong to, for pockets open to the edge.
  const walls = solid && difference(solid, region);
  const remaining = new Set(comps.map((_, i) => i));
  while (remaining.size) {
    // Nearest pocket next.
    let ci = -1,
      bd = Infinity;
    for (const i of remaining) {
      const d = Math.min(...comps[i][0].map(p => dist2(p, pos)));
      if (d < bd) {
        bd = d;
        ci = i;
      }
    }
    remaining.delete(ci);
    // With no walls, such as when a pocket covers the whole top, there's nothing to follow: clear it in rings below.
    if (solid && walls?.length && offsetPaths(comps[ci], -r).some(l => rotateToWaste(l, solid))) {
      const open = openPocketPasses(comps[ci], walls, solid, topZ, floorZ, tool, s, pos);
      if (open.length) {
        roughWallAllowance = Math.max(
          roughWallAllowance,
          s.pocketWallAllowance || (topZ - floorZ > 1 ? (s.openWallAllowance ?? kOpenWallAllowance) : 0)
        );
        passes.push(...open);
        const end = open[open.length - 1].pts.at(-1)!;
        pos = { x: end[0], y: end[1] };
        continue;
      }
    }
    const entry = (oriented: Loop, nearest: Loop, zFrom: number, zTo: number): Pass => {
      const waste = solid && rotateToWaste(oriented, solid);
      return waste ? rampOnWasteEdge(waste, zFrom, zTo, s) : rampLoop(nearest, zFrom, zTo, s, tool);
    };
    // Where the bit center may go (the wall ring is its boundary), and where roughing stops.
    const free = offsetPaths(comps[ci], -r);
    // A pocket hardly wider than the bit has no room for the allowance: rough on the wall ring, or nothing would be cut.
    const allowance = offsetPaths(comps[ci], -r - s.pocketWallAllowance).length ? s.pocketWallAllowance : 0;
    let ringSpacing = stepover;
    let rings = createPocketRings(comps[ci], r, allowance, s, ringSpacing);
    const conservative = conservativePocketRingSpacing(s, tool.diameter);
    const covered = () => pocketRingsCoverFloor(comps[ci], allowance > 0 ? [...rings, free] : rings, tool.diameter, s, solid);
    const terminalRadius = pocketCoverageRadius(tool.diameter, s);
    if (terminalRadius <= 0)
      throw new CamInputError([{ field: 'geometryTolerance', message: 'leaves no certifiable pocket floor sweep for this cutter' }]);
    // Keep an already-proved layout. Otherwise an uncertainty-aware termination fills the last central strip before adding other rings.
    if (!covered()) {
      rings = createPocketRings(comps[ci], r, allowance, s, ringSpacing, terminalRadius);
      // Diagonal gaps depend on the component, islands and smoothing. Refine failed high stepovers instead of accepting gaps.
      for (let attempt = 0; !covered(); attempt++) {
        ringSpacing = nextPocketFloorSpacing(ringSpacing, conservative, attempt);
        rings = createPocketRings(comps[ci], r, allowance, s, ringSpacing, terminalRadius);
      }
    }
    // Closed pockets clear from the center out. Open to the edge: the outer ring first, entering from the waste,
    // then inwards, keeping the edge supported by waste during its cut.
    const open = !!solid && !!rings[0]?.some(l => rotateToWaste(l, solid));
    const order = rings.map((_, i) => i);
    if (!open) order.reverse();
    // Where the rings split (lobes past a narrow neck), each lobe is cut through all its depths before the next.
    const groups = order.map(ri => rings[ri]);
    forEachRegion(groups, regionLinks(groups, tool.diameter + ringSpacing, true), true, pos, region => {
      let prevZ = topZ;
      for (const z of depthLevels(topZ, floorZ, stepdown)) {
        let last: Vec3 | undefined;
        for (const { group, index } of region) {
          const ri = order[group];
          const raw = rings[ri][index];
          // Clipper: outer loops CCW, holes CW -> material on the right = climb with an M3 spindle.
          const oriented = s.climb ? raw : [...raw].reverse();
          // The wall ring of a closed pocket, reached from an inner ring: join and leave it on tangent arcs.
          if (!open && ri === 0 && allowance === 0 && last) {
            const lead = wallPassWithLeads(oriented, { x: last[0], y: last[1] }, z, s.feed, r, free, leadTolerance);
            if (lead && segmentInside({ x: last[0], y: last[1] }, { x: lead.pts[0][0], y: lead.pts[0][1] }, free)) {
              passes.push({ ...lead, clearLink: true, materialSide: s.climb ? 'right' : 'left' });
              last = lead.pts[lead.pts.length - 1];
              continue;
            }
          }
          const nearest = rotateToNearest(oriented, last ? { x: last[0], y: last[1] } : pos);
          const near = last && Math.sqrt(dist2({ x: last[0], y: last[1] }, nearest[0])) <= ringSpacing * 1.5;
          const pass: Pass = near
            ? { pts: closeLoop(nearest, z), feeds: closeLoop(nearest, z).map(() => s.feed), link: 'direct' }
            : entry(oriented, nearest, prevZ, z);
          passes.push({ ...pass, materialSide: s.climb ? 'right' : 'left' });
          last = pass.pts[pass.pts.length - 1];
        }
        if (last) pos = { x: last[0], y: last[1] };
        prevZ = z;
      }
      return pos;
    });
    // Bound axial engagement while the radial finishing allowance is removed.
    if (allowance > 0 && rings.length) {
      let last: Vec3 = passes[passes.length - 1].pts.at(-1)!;
      for (const z of depthLevels(topZ, floorZ, s.pocketFinishStepdown ?? stepdown))
        for (const raw of free) {
          const oriented = s.climb ? raw : [...raw].reverse();
          const feed = s.finishFeed ?? s.feed * s.pocketFinishFeedFactor;
          const lead = wallPassWithLeads(oriented, { x: last[0], y: last[1] }, z, feed, r, free, leadTolerance);
          const pass: Pass =
            lead && segmentInside({ x: last[0], y: last[1] }, { x: lead.pts[0][0], y: lead.pts[0][1] }, free)
              ? { ...lead, clearLink: true }
              : { ...rampLoop(rotateToNearest(oriented, { x: last[0], y: last[1] }), z, z, s, tool), feeds: [] };
          if (Math.abs(last[2] - z) > 1e-8) {
            pass.link = 'retract';
            pass.clearLink = false;
            if (pass.roles) pass.roles[0] = 'approach';
          }
          if (!pass.feeds.length) pass.feeds = pass.pts.map((_, k) => (k === 0 ? s.plungeFeed : feed));
          passes.push({ ...finishRoles(pass), materialSide: s.climb ? 'right' : 'left' });
          last = pass.pts[pass.pts.length - 1];
        }
    }
  }
  return withPocketTransitions(
    { name, kind: 'pocket', feature: 'pocket', tool, passes: passes.map(pass => scheduledPass(pass, s, tool)) },
    region,
    s,
    roughWallAllowance,
    solid
  );
}
