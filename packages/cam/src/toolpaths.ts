import { CamInputError, validateCamSettings, validateFeatures, validateDepthRange, validatePaths, validateTool } from './validation';
import { areaD, type PathD, type PathsD } from 'clipper2-ts';
import { openPocketRegion, type PartFeatures } from './features';
import { cleanRegion, difference, intersect, minOf, offset, pathLength, polyArea, union, type Vec3 } from './geom';
import { applyTabMotion, repeatTabIntervals } from './tabMotion';
import { geometryTolerances } from './accuracy';
import { finalizePlan } from './finalizePlan';
import { kVacuumSlug, type TabSettings } from './settings';
import {
  DEFAULT_SETTINGS,
  type CamSettings,
  type HoleChoice,
  type HoleMiddle,
  type Operation,
  type PartCam,
  type Pass,
  type Tool,
} from './toolpathTypes';
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
import { pocketOperation } from './pocketOperation';

export { DEFAULT_SETTINGS, DEFAULT_TOOL } from './toolpathTypes';
export type { CamSettings, HoleChoice, HoleMiddle, Operation, PartCam, Pass, Tool } from './toolpathTypes';
export { MATERIALS, DEFAULT_TABS, type Material, type TabSettings } from './settings';
export { stepdownFor } from './passPlanning';
export { pocketOperation } from './pocketOperation';

// ---- helpers ----

/** Start in the middle of the longest edge so lead-in marks don't land on a corner. */
function rotateToLongestEdge(loop: Loop): Loop {
  let best = 0,
    bl = -1;
  for (let i = 0; i < loop.length; i++) {
    const l = dist2(loop[i], loop[(i + 1) % loop.length]);
    if (l > bl) {
      bl = l;
      best = i;
    }
  }
  const a = loop[best],
    b = loop[(best + 1) % loop.length];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return [mid, ...loop.slice(best + 1), ...loop.slice(0, best + 1)];
}

/** Move a contour's seam to a known point on it, retaining the exact previous XY pose. */
function contourFromPoint(loop: Loop, point: Vec3): Loop | undefined {
  const start = { x: point[0], y: point[1] };
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i],
      b = loop[(i + 1) % loop.length];
    if (start.x === a.x && start.y === a.y) return [start, ...loop.slice(i + 1), ...loop.slice(0, i)];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length2 = dx * dx + dy * dy;
    if (length2 === 0) continue;
    const t = ((start.x - a.x) * dx + (start.y - a.y) * dy) / length2;
    if (t < 0 || t > 1 || Math.hypot(a.x + t * dx - start.x, a.y + t * dy - start.y) > 1e-9) continue;
    if (start.x === b.x && start.y === b.y) {
      const next = (i + 1) % loop.length;
      return [start, ...loop.slice(next + 1), ...loop.slice(0, next)];
    }
    return [start, ...loop.slice(i + 1), ...loop.slice(0, i + 1)];
  }
  return undefined;
}

/** Split polygons-with-holes into components (outer + the holes inside it). */
const round2 = (v: number) => +v.toFixed(2);
const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);

/**
 * What a pocket operation cuts, as the Model step names features: closed pockets and edge grooves (open to the
 * outline) that end at this floor, and the ones it only cuts the first part of (they go deeper later).
 */
function pocketTitle(f: PartFeatures, i: number, region: PathsD, top: number): string {
  const p = f.pockets[i];
  const depth = round2(f.thickness - p.floorZ);
  const deeper = f.pockets.slice(i + 1).flatMap(q => q.strictRegion);
  const n = { pockets: 0, grooves: 0, pocketsOn: 0, groovesOn: 0 };
  for (const c of components(region)) {
    if (polyArea(c) < 1) continue;
    // Its floor is here only where it doesn't go on to a deeper level.
    const own = intersect(c, p.strictRegion);
    const endsHere = polyArea(deeper.length ? difference(own, deeper) : own) > 1;
    const open = polyArea(difference(c, f.outlines)) > 0.01;
    const goesOn = !endsHere && deeper.length > 0 && polyArea(intersect(c, deeper)) > 1;
    n[open ? (goesOn ? 'groovesOn' : 'grooves') : goesOn ? 'pocketsOn' : 'pockets']++;
  }
  const grooveWord = (k: number) => (k > 1 ? `${k} edge grooves` : 'edge groove');
  const done = [n.pockets && `${plural(n.pockets, 'pocket')} ${depth} deep`, n.grooves && `${grooveWord(n.grooves)} ${depth} deep`];
  const onward = [n.pocketsOn && plural(n.pocketsOn, 'pocket'), n.groovesOn && grooveWord(n.groovesOn)].filter(Boolean);
  const what = [...done, onward.length && `${onward.join(' and ')} to ${depth}`].filter(Boolean);
  const from = top < f.thickness - 1e-6 ? `, from ${round2(f.thickness - top)}` : '';
  return what.length ? `${what.join(' + ')}${from}` : `Pocket ${depth} deep`;
}

// ---- operations ----

/** Tab intervals (arc length along `loop`) centered on the given points. */
function tabIntervals(loop: Vec3[], centers: { x: number; y: number }[], halfLen: number) {
  const cum = [0];
  for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]));
  return centers.map(c => {
    let best = 0,
      bd = Infinity;
    for (let i = 1; i < loop.length; i++) {
      const [ax, ay] = loop[i - 1],
        [bx, by] = loop[i];
      const dx = bx - ax,
        dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.y - ay) * dy) / l2)) : 0;
      const d = (ax + t * dx - c.x) ** 2 + (ay + t * dy - c.y) ** 2;
      if (d < bd) {
        bd = d;
        best = cum[i - 1] + t * Math.sqrt(l2);
      }
    }
    return [best - halfLen, best + halfLen] as const;
  });
}

/**
 * Raise the path to tabZ inside the given arc-length intervals (vertical steps at the borders). A step down goes into
 * uncut wood: at the plunge feed. `feeds` stays one per point; arc fitting only looks at runs of constant feed.
 */
function applyTabs(pass: Pass, intervals: (readonly [number, number])[], tabZ: number, plungeFeed: number): Pass {
  return applyTabMotion(pass, intervals, tabZ, plungeFeed);
}

/** Evenly spread tabs over the long straight runs of a loop. */
export function placeTabs(loop: Loop, tabs: TabSettings, tool: Tool): { x: number; y: number }[] {
  const per = pathLength(loop, true);
  const count = Math.max(tabs.minCount, Math.round(per / tabs.spacing));
  const minRun = tabs.width + 3 * tool.diameter;
  // Merge collinear segments into straight runs.
  const runs: { a: { x: number; y: number }; b: { x: number; y: number }; len: number }[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i],
      b = loop[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const prev = runs[runs.length - 1];
    if (prev) {
      const c = ((prev.b.x - prev.a.x) * (b.y - a.y) - (prev.b.y - prev.a.y) * (b.x - a.x)) / (prev.len * len || 1);
      if (Math.abs(c) < 0.01 && prev.b === a) {
        prev.b = b;
        prev.len = Math.hypot(b.x - prev.a.x, b.y - prev.a.y);
        continue;
      }
    }
    runs.push({ a, b, len });
  }
  const long = runs.filter(r => r.len >= minRun);
  if (!long.length) return [];
  const counts = long.map(() => 0);
  for (let k = 0; k < count; k++) {
    let bi = 0;
    long.forEach((r, i) => {
      if (r.len / (counts[i] + 1) > long[bi].len / (counts[bi] + 1)) bi = i;
    });
    counts[bi]++;
  }
  return long.flatMap((r, i) =>
    Array.from({ length: counts[i] }, (_, k) => {
      const t = (k + 1) / (counts[i] + 1);
      return { x: r.a.x + t * (r.b.x - r.a.x), y: r.a.y + t * (r.b.y - r.a.y) };
    })
  );
}

/**
 * Outline profile: bounded roughing, a full-depth radial finish unless explicitly stepped, and deliberate entry motion.
 * `inside` = through hole (tool inside the loop).
 */
/** profileOperation's bit loops per shape (and bit radius, allowance, direction). */
const loopCache = new WeakMap<PathD, Map<string, { rough: Loop; final: Loop } | null>>();

export function profileOperation(
  name: string,
  loopShape: PathD,
  topZ: number,
  tool: Tool,
  settings: CamSettings,
  inside = false
): Operation {
  validateCamSettings(settings);
  validateTool(tool);
  validatePaths([loopShape], 'profile');
  const s = cuttingWith(tool, settings);
  const offsetTolerance = offsetToleranceFor(s);
  const r = tool.diameter / 2;
  const sign = inside ? -1 : 1;
  const shape = [inside ? [...loopShape].reverse() : loopShape];
  const one = (paths: PathsD) => paths.sort((a, b) => Math.abs(areaD(b)) - Math.abs(areaD(a)))[0];
  const orient = (p: PathD) => {
    // Clipper keeps the input orientation; outer loop CCW. Climb (material on the right) = CW around the part,
    // CCW inside a hole.
    const ccw = areaD(p) > 0;
    const wantCcw = inside === s.climb;
    return ccw === wantCcw ? p : [...p].reverse();
  };
  // The bit's loops around the shape: the costly part (Clipper offsets), the same for the board's tab plan and its
  // program, so kept per shape.
  const key = `${sign}:${r}:${s.leaveStock}:${s.climb}:${offsetTolerance}`;
  let loops = loopCache.get(loopShape)?.get(key);
  if (!loops) {
    const finalRaw = one(offset(shape, sign * r, offsetTolerance));
    const roughRaw = one(offset(shape, sign * (r + s.leaveStock), offsetTolerance));
    // A hole hardly wider than the bit has no room for the allowance: rough on the final path.
    const roughPath = roughRaw ?? finalRaw;
    const rough = roughPath && rotateToLongestEdge(orient(roughPath));
    loops = rough && finalRaw ? { rough, final: rotateToNearest(orient(finalRaw), rough[0]) } : null;
    if (!loopCache.has(loopShape)) loopCache.set(loopShape, new Map());
    loopCache.get(loopShape)!.set(key, loops);
  }
  const passes: Pass[] = [];
  if (!loops) return { name, kind: 'profile', feature: inside ? 'hole' : 'outline', tool, passes };
  const { rough, final } = loops;
  const warnings = new Set<string>();
  const sourceLoops = new WeakMap<Pass, { loop: Loop; start: number; zFrom: number }>();

  // A bottom skin (outlines only): the final pass stops there, and roughing never goes below it.
  const floorZ = inside ? s.finalZ : (s.outlineFloor ?? s.finalZ);
  const roughBottom = Math.min(topZ, Math.max(s.profileRoughBottom, floorZ));
  // Only a light skim: a depth-limited finish has to stay in the main program. Without roughing nothing would mark the skin.
  const finishAtRelease =
    !inside &&
    !!s.outlineFinishAtRelease &&
    s.outlineFloor !== undefined &&
    s.leaveStock > 0 &&
    s.profileFinishStepdown === undefined &&
    topZ - floorZ > 0.01;
  const profileStep = s.profileStepdown ?? stepdownFor(tool, s);
  validateDepthRange(topZ, floorZ, profileStep);
  if (s.profileFinishStepdown !== undefined) validateDepthRange(topZ, floorZ, s.profileFinishStepdown);
  // The strip under the roughing floor is a new axial cut, even with a light radial finish allowance.
  // With no wall stock, cut straight to the requested floor at the cutting feed. An explicit
  // finishing depth limit still controls the bottom strip independently of the radial allowance.
  const finishWithRoughing = s.leaveStock === 0 && s.profileFinishStepdown === undefined;
  const extendRoughing = !finishAtRelease && !finishWithRoughing && roughBottom - floorZ > profileStep + 1e-9;
  const roughTo = extendRoughing || finishAtRelease || finishWithRoughing ? floorZ : roughBottom;
  const roughLevels = topZ - roughTo > 0.01 ? depthLevels(topZ, roughTo, profileStep) : [];
  if (extendRoughing) roughLevels.pop();
  const append = (baseLoop: Loop, zFrom: number, z: number, feed: number, phase: 'rough' | 'finish') => {
    const requested = s.profileEntry ?? 'ramp';
    let loop = baseLoop;
    const previous = passes.at(-1)?.pts.at(-1);
    let pass: Pass;
    if (requested === 'plunge') {
      const pts = closeLoop(loop, z);
      pass = { pts, feeds: pts.map((_, i) => (i ? feed : s.plungeFeed)), link: 'retract', entry: 'plunge' };
    } else {
      // Begin the next depth at the prior lap's actual pose. The following descent is an explicit
      // slope/feed-limited cut, rather than a travel link assumed clear below the previous floor.
      if (previous?.[2] === zFrom) loop = contourFromPoint(baseLoop, previous) ?? baseLoop;
      pass = { ...rampLoop(loop, zFrom, z, { ...s, feed }, tool), entry: 'ramp' };
      if (pathLength(loop, true) < tool.diameter && zFrom > z) {
        pass.entry = 'plunge';
        warnings.add('Contour entry loop is too small for a ramp; using a bounded plunge');
      }
    }
    const record = (next: Pass, start: number, entryTop = zFrom) => {
      next.phase = phase;
      next.materialSide = s.climb ? 'right' : 'left';
      if (phase === 'finish') next = finishRoles(next);
      passes.push(next);
      sourceLoops.set(next, { loop, start, zFrom: entryTop });
    };
    pass.link = previous && previous.every((value, axis) => value === pass!.pts[0][axis]) ? 'direct' : 'retract';
    const atDepth = pass.pts.findIndex(p => Math.abs(p[2] - z) < 1e-8);
    if (pass.entry === 'ramp' && atDepth > 0 && atDepth < pass.pts.length - 1) {
      const entry = { ...pass, pts: pass.pts.slice(0, atDepth + 1), feeds: pass.feeds.slice(0, atDepth + 1) };
      const lap = { ...pass, pts: pass.pts.slice(atDepth), feeds: pass.feeds.slice(atDepth), link: 'direct' as const, entry: undefined };
      const start = pathLength(
        entry.pts.map(q => ({ x: q[0], y: q[1] })),
        false
      );
      record(entry, 0);
      record(lap, start, z);
    } else record(pass, 0);
  };
  let previousZ = topZ;
  for (const z of roughLevels) {
    append(rough, previousZ, z, s.feed, 'rough');
    previousZ = z;
  }
  const ffeed = s.finishFeed ?? s.feed * s.finalFeedFactor;
  const finishTop = s.leaveStock > 0 && s.profileFinishStepdown !== undefined ? topZ : previousZ;
  const finishLevels = s.profileFinishStepdown !== undefined ? depthLevels(finishTop, floorZ, s.profileFinishStepdown) : [floorZ];
  previousZ = finishTop;
  if (!finishAtRelease && !finishWithRoughing)
    for (const z of finishLevels) {
      append(final, previousZ, z, ffeed, 'finish');
      previousZ = z;
    }

  if (s.tabs && !inside) {
    const centers = s.tabs.centers ?? placeTabs(final, s.tabs, tool);
    const half = (s.tabs.width + tool.diameter) / 2;
    for (let i = 0; i < passes.length; i++) {
      const p = passes[i];
      if (minOf(p.pts.map(q => q[2])) >= s.tabs.height) continue;
      const { loop, start } = sourceLoops.get(p)!;
      const perimeter = pathLength(loop, true);
      const travel = pathLength(
        p.pts.map(q => ({ x: q[0], y: q[1] })),
        false
      );
      const intervals = repeatTabIntervals(
        tabIntervals(closeLoop(loop, 0), centers, half).map(([a, b]) => [a - start, b - start] as const),
        perimeter,
        travel
      );
      passes[i] = applyTabs(p, intervals, s.tabs.height, s.plungeFeed);
      sourceLoops.set(passes[i], sourceLoops.get(p)!);
    }
  }
  const plannedPasses = passes.map(pass => scheduledPass(pass, s, tool, pass.phase === 'finish' ? 'finish' : 'cut'));
  return {
    name,
    kind: 'profile',
    feature: inside ? 'hole' : 'outline',
    tool,
    plungeFeed: s.plungeFeed,
    passes: plannedPasses,
    ...(finishAtRelease && {
      finishAtRelease: { loop: closeLoop(final, floorZ), approach: [rough[0].x, rough[0].y, floorZ] as Vec3 },
    }),
    ...(warnings.size ? { warnings: [...warnings] } : {}),
  };
}

/** Where a bit of radius r can cut in a region. */
const reachOf = (region: PathsD, r: number, tolerance: number) => offset(offset(region, -r, tolerance), r, tolerance);

/** A bit fits a spot if it does at this share of its radius (it may be just as wide as the bit). */
const kNarrowSpotFit = 0.9;

/**
 * What a smaller bit should cut of a region, given what bigger bits `reached`: the spots it fits into whole, such as a
 * slot off a wider pocket. Rounded inside corners aren't: the bit doesn't fit into what they leave. The spots grow by
 * the bit's diameter into the rest of the region, so that the bit reaches all of them and leaves no wall where they join it.
 */
function narrowSpots(region: PathsD, reached: PathsD, tool: Tool, settings: CamSettings): PathsD {
  const r = tool.diameter / 2;
  const tolerance = geometryTolerances(settings.geometryTolerance, settings.sourceTolerance);
  const left = cleanRegion(difference(reachOf(region, r, tolerance.offset), reached), tolerance.cleanup, 0.5, tolerance.simplify);
  const spots = components(left).filter(c => offset(c, -kNarrowSpotFit * r, tolerance.offset).length > 0);
  if (!spots.length) return [];
  const grown = intersect(offset(spots.flat(), tool.diameter, tolerance.offset), region);
  return intersect(cleanRegion(grown, tolerance.cleanup, 0.05, tolerance.simplify), region);
}

/**
 * All operations for one flat board. Each feature uses the largest tool that fits, smaller ones then cut the narrow
 * spots of a pocket that it doesn't reach; operations are ordered smallest tool first, inner features (pockets high to
 * low, then holes) before the outline.
 */
/**
 * Only what cuts through: a part's through holes and outlines, no tabs (for the board's tab plan, which needs to know
 * what stock is left, not the pockets).
 */
export function throughCuts(features: PartFeatures, settings: Partial<CamSettings> = {}): Operation[] {
  const s: CamSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    tabs: false,
    outlineFloor: undefined,
    profileEntry: 'plunge',
  };
  validateCamSettings(s);
  validateFeatures(features);
  const top = Math.max(s.stockTop ?? 0, features.levels[0]?.z ?? 0, features.thickness);
  const tools = [...s.tools].sort((a, b) => b.diameter - a.diameter);
  const fits = (region: PathsD) => (t: Tool) => offset(region, -t.diameter / 2, offsetToleranceFor(s)).length > 0;
  return [
    ...features.throughHoles.flatMap((h, i) => {
      const tool = tools.find(fits([h]));
      return tool ? [profileOperation(`Hole ${i + 1}`, h, top, tool, s, true)] : [];
    }),
    ...features.outlines.map((o, i) => profileOperation(`Outline ${i + 1}`, o, top, tools[0], s)),
  ];
}

/** A cut deeper than this many bit diameters gets a warning when the bit has no flute length: a long 1/8" bit has about 22 mm of flute. */
const kDeepCutDiameters = 7;

/**
 * Bits that go deeper than their flutes are long (from the stock top, the deepest cut of all their operations): the
 * shank would rub. A warning, not a stop: a library's flute length may be conservative.
 */
export function fluteWarnings(ops: Operation[], stockTop: number): string[] {
  const out: string[] = [];
  for (const tool of new Set(ops.map(o => o.tool))) {
    const zs = ops.filter(o => o.tool === tool).flatMap(o => o.passes.flatMap(p => p.pts.map(q => q[2])));
    if (!zs.length) continue;
    const depth = stockTop - minOf(zs);
    if (tool.fluteLength) {
      if (depth > tool.fluteLength + 1e-6)
        out.push(`bit D=${tool.diameter} cuts ${round2(depth)} mm deep from the stock top, its flutes are ${tool.fluteLength} mm long`);
    } else if (depth > kDeepCutDiameters * tool.diameter + 1e-6)
      // Without a flute length, a cut many diameters deep is still worth a look: small bits rarely reach that far.
      out.push(
        `bit D=${tool.diameter} cuts ${round2(depth)} mm deep from the stock top, over ${kDeepCutDiameters} times its diameter: check its flute length`
      );
  }
  return out;
}

/** The piece inside a through hole is worth a warning above this, mm² (50 x 50 mm). */
const kLooseSlugArea = 2500;
/** Clearing a hole's middle by itself is worth up to this many minutes; beyond, fixing the piece is quicker. */
const kClearMinutes = 3;

/** Board-only planning constraints; they never become job settings or posted plan metadata. */
interface PartPlanningContext {
  pocketClashes?: (operation: Operation) => boolean;
  containedPockets?: ReadonlySet<number>;
  /** Clear the middle of a hole where that's quick, and report every hole's middle in `holeMiddles`. */
  holeMiddles?: {
    choices?: Record<number, HoleChoice>;
    /** Holes with a hold point on their middle: never cleared. */
    screwed?: ReadonlySet<number>;
    /** How long an operation takes the machine. */
    minutes: (operation: Operation) => number;
  };
}

const kClearings = new WeakMap<PathD, Map<string, { clearing: Operation; addMinutes: number }>>();

/**
 * The operation that clears a hole's middle, and how long it takes: the same for each copy of a part and each time its
 * board is planned, so kept with the hole. It stops short of the wall, half the bit's width: the hole's own contour
 * still cuts the wall the same way, and takes what's left.
 */
function clearingOf(hole: PathD, index: number, topZ: number, tool: Tool, s: CamSettings, minutes: (operation: Operation) => number) {
  const { tabs: _tabs, tools: _tools, blankFootprint: _blank, outlineFloor: _floor, ...cutting } = s;
  const key = JSON.stringify([index, topZ, tool, cutting]);
  let known = kClearings.get(hole);
  if (!known) kClearings.set(hole, (known = new Map()));
  let entry = known.get(key);
  if (!entry) {
    const region = offset([hole], -tool.diameter / 2, offsetToleranceFor(s));
    const clearing: Operation = {
      ...pocketOperation(`Hole ${index + 1} middle`, region, topZ, s.finalZ, tool, s),
      feature: 'hole',
      title: 'Middle of a through hole',
    };
    entry = { clearing, addMinutes: round2(minutes(clearing)) };
    known.set(key, entry);
  }
  return entry;
}

/**
 * What to do with the piece in the middle of a through hole, if the bit leaves one: its clearing operation, if it should
 * go.
 */
function planHoleMiddle(
  hole: PathD,
  index: number,
  topZ: number,
  tool: Tool,
  s: CamSettings,
  context: NonNullable<PartPlanningContext['holeMiddles']>
): { middle: HoleMiddle; clearing?: Operation } | null {
  const tolerance = offsetToleranceFor(s);
  const piece = offset([hole], -tool.diameter, tolerance);
  if (!piece.length) return null;
  const [xs, ys] = [piece.flat().map(q => q.x), piece.flat().map(q => q.y)];
  const size = round2(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
  const { clearing, addMinutes } = clearingOf(hole, index, topZ, tool, s, context.minutes);
  const choice = context.choices?.[index];
  const small = size <= kVacuumSlug;
  const cleared = !context.screwed?.has(index) && (choice ? choice === 'clear' : !small && addMinutes < kClearMinutes);
  const middle: HoleMiddle = {
    hole: index,
    size,
    addMinutes,
    state: context.screwed?.has(index) ? 'screwed' : cleared ? 'cleared' : small ? 'vacuum' : 'loose',
    ...(choice && { choice }),
  };
  return { middle, ...(cleared && { clearing }) };
}

/**
 * A through hole in a pocket's floor gets cut away anyway, so the bit may use its space, unless it's held by a screw. Without it, a counterbore
 * only a little wider than its screw hole leaves a ring narrower than the bit, and isn't cut at all.
 */
function withOpenHoles(pocket: PartFeatures['pockets'][number], holes: PathsD): PartFeatures['pockets'][number] {
  const outer = pocket.strictRegion.filter(path => areaD(path) > 0);
  const inside = holes.length && outer.length ? intersect(holes, outer) : [];
  return inside.length ? { ...pocket, strictRegion: union(pocket.strictRegion, inside) } : pocket;
}

export function camPart(features: PartFeatures, settings: Partial<CamSettings> = {}, context: PartPlanningContext = {}): PartCam {
  const s: CamSettings = { ...DEFAULT_SETTINGS, ...settings };
  validateCamSettings(s);
  validateFeatures(features);
  const top = Math.max(s.stockTop ?? 0, features.levels[0]?.z ?? 0, features.thickness);
  const tools = [...s.tools].sort((a, b) => b.diameter - a.diameter);
  const warnings: string[] = [];
  const ops: Operation[] = [];
  const holeMiddles: HoleMiddle[] = [];
  const needContained = new Set(context.containedPockets);
  const fits = (region: PathsD, inward: boolean) => (t: Tool) =>
    offset(region, (inward ? -1 : 1) * (t.diameter / 2), offsetToleranceFor(s)).length > 0;

  // Pockets come top-down and each region contains the deeper ones, so a pocket starts at the previous floor --
  // unless that floor was cleared by another (bigger) bit that couldn't reach into this one.
  let pocketTop = top;
  let prevTool: Tool | undefined;
  let previousContained = false;
  let previousRegion: PathsD | undefined;
  features.pockets.forEach((pocket, i) => {
    // A hole whose middle is screwed down keeps that middle: the screw head is in the way.
    const p = withOpenHoles(
      pocket,
      features.throughHoles.filter((_, hole) => !context.holeMiddles?.screwed?.has(hole))
    );
    const contained = context.containedPockets?.has(i);
    // Open to the edge: run the bit 1mm past the edge into the waste, whatever its size. A bit only has to fit
    // that extended region (a 6mm bit cuts a 3.5mm rabbet).
    const openFor = (t: Tool) =>
      contained
        ? p.strictRegion
        : openPocketRegion(features.outlines, p, t.diameter / 2 + 1, geometryTolerances(s.geometryTolerance, s.sourceTolerance));
    const tool = tools.find(t => fits(openFor(t), true)(t));
    if (!tool) {
      if (contained)
        throw new CamInputError([{ field: `pockets[${i}]`, message: 'no tool fits a pocket path that clears neighboring parts' }]);
      return warnings.push(`pocket z=${p.floorZ}: no tool fits`);
    }
    const region = openFor(tool);
    // A contained higher pocket did not clear exterior waste for a lower open entry. Restart that new domain
    // from stock top; a deeper region entirely inside the cleared strict region can still reuse its floor.
    if ((prevTool && prevTool !== tool) || (previousContained && !contained && previousRegion && difference(region, previousRegion).length))
      pocketTop = top;
    prevTool = tool;
    const pocketOps: Operation[] = [
      {
        ...pocketOperation(
          `Pocket ${i + 1} z=${p.floorZ}`,
          region,
          pocketTop,
          p.floorZ,
          tool,
          s,
          contained ? undefined : features.outlines
        ),
        title: pocketTitle(features, i, region, pocketTop),
      },
    ];
    let reached = reachOf(region, tool.diameter / 2, offsetToleranceFor(s));
    for (const small of tools.filter(t => t.diameter < tool.diameter)) {
      const spots = narrowSpots(openFor(small), reached, small, s);
      if (!spots.length) continue;
      // From the stock top: smaller bits go first, nothing has cleared these spots' surroundings yet.
      pocketOps.push({
        ...pocketOperation(
          `Pocket ${i + 1} z=${p.floorZ} narrow spots`,
          spots,
          top,
          p.floorZ,
          small,
          s,
          contained ? undefined : features.outlines
        ),
        title: `${plural(components(spots).length, 'narrow spot')} ${round2(features.thickness - p.floorZ)} deep`,
      });
      reached = union(reached, reachOf(spots, small.diameter / 2, offsetToleranceFor(s)));
    }
    if (context.pocketClashes && pocketOps.some(context.pocketClashes)) {
      if (contained)
        throw new CamInputError([
          { field: `pockets[${i}]`, message: 'a contained pocket path still reaches a neighboring part; move the parts farther apart' },
        ]);
      needContained.add(i);
    }
    if (contained) warnings.push(`Pocket ${i + 1}: Open-pocket path would reach a neighboring part; using a path inside the pocket`);
    ops.push(...pocketOps);
    // Only material on the part counts: what's left in the waste past an open edge comes away with the outline.
    const left = difference(p.strictRegion, reached);
    // Kept inside the pocket, the bit can't run past its open edge: name what that leaves apart from the corners.
    const atEdge = contained
      ? polyArea(left) -
        polyArea(
          difference(
            left,
            reachOf(
              openPocketRegion(features.outlines, p, tool.diameter / 2 + 1, geometryTolerances(s.geometryTolerance, s.sourceTolerance)),
              tool.diameter / 2,
              offsetToleranceFor(s)
            )
          )
        )
      : 0;
    if (atEdge > 1)
      warnings.push(
        `Pocket ${i + 1}: ${atEdge.toFixed(1)}mm² left along the open edge with D=${tool.diameter}: the path stays inside the pocket to keep clear of a neighboring part`
      );
    const uncut = polyArea(left) - atEdge;
    if (uncut > 1) warnings.push(`pocket z=${p.floorZ}: ${uncut.toFixed(1)}mm² left in corners/narrow spots with D=${tool.diameter}`);
    pocketTop = p.floorZ;
    previousContained = !!contained;
    previousRegion = region;
  });
  if (needContained.size > (context.containedPockets?.size ?? 0))
    return camPart(features, settings, { ...context, containedPockets: needContained });
  if (s.cutThrough)
    features.throughHoles.forEach((h, i) => {
      const tool = tools.find(fits([h], true));
      if (!tool) return warnings.push(`through hole ${i + 1}: no tool fits`);
      if (context.holeMiddles) {
        const planned = planHoleMiddle(h, i, top, tool, s, context.holeMiddles);
        if (planned) holeMiddles.push(planned.middle);
        if (planned?.clearing) ops.push(planned.clearing);
        ops.push(profileOperation(`Hole ${i + 1}`, h, top, tool, s, true));
        if (planned?.middle.state === 'loose')
          warnings.push(
            `through hole ${i + 1}: the ${round2(planned.middle.size)} mm piece inside it comes loose on the last pass and can catch the bit. Tape it down, screw it down, or clear it (about ${Math.ceil(planned.middle.addMinutes)} min).`
          );
        return;
      }
      ops.push(profileOperation(`Hole ${i + 1}`, h, top, tool, s, true));
      // Nothing holds the piece in the middle (if the bit leaves one): free on the last lap, it can catch the bit.
      if (Math.abs(polyArea([h])) > kLooseSlugArea && offset([h], -tool.diameter, offsetToleranceFor(s)).length) {
        const [xs, ys] = [h.map(q => q.x), h.map(q => q.y)];
        const size = `${round2(Math.max(...xs) - Math.min(...xs))} x ${round2(Math.max(...ys) - Math.min(...ys))} mm`;
        warnings.push(
          `through hole ${i + 1}: the ${size} piece inside it comes loose on the last pass and can catch the bit. Tape it down, or stop before the last pass and take it out.`
        );
      }
    });
  if (s.cutThrough) features.outlines.forEach((o, i) => ops.push(profileOperation(`Outline ${i + 1}`, o, top, tools[0], s)));
  if (features.bottomFaces.length && s.cutThrough)
    warnings.push(`bottom-side features at z=${features.bottomFaces.map(b => b.z).join(', ')}: need a second (flipped) setup`);
  if (features.slopedArea > 1) warnings.push(`${features.slopedArea.toFixed(0)}mm² of sloped faces ignored (not 2.5D)`);

  warnings.push(...ops.flatMap(op => op.warnings ?? []), ...fluteWarnings(ops, top));

  // Stable sort: smallest tool first, keeps pockets -> holes -> outline within a tool.
  const operations = ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => a.op.tool.diameter - b.op.tool.diameter || a.i - b.i)
    .map(x => x.op);
  return finalizePlan(
    {
      stockTop: top,
      safeZ: top + s.safeHeight,
      retractZ: top + s.retractHeight,
      operations,
      warnings,
      ...(holeMiddles.length && { holeMiddles }),
    },
    s,
    s.blankFootprint
  );
}
