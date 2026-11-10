import { areaD, pointInPolygonD, PointInPolygonResult, type PathD, type PathsD } from 'clipper2-ts';
import { CamInputError, validateDepthRange } from './validation';
import { pathLength, type Vec3 } from './geom';
import { applyFeedPolicy, type MotionRole } from './motion';
import { geometryTolerances } from './accuracy';
import type { CamSettings, Pass, Tool } from './toolpathTypes';

export type Loop = PathD;

export const offsetToleranceFor = (settings: CamSettings) =>
  geometryTolerances(settings.geometryTolerance, settings.sourceTolerance).offset;

export const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Start the loop at the point on it (vertex or edge) nearest to p. */
export function rotateToNearest(loop: Loop, p: { x: number; y: number }): Loop {
  let best = 0,
    bd = Infinity,
    bq = loop[0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i],
      b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = dist2(p, q);
    if (d < bd) {
      bd = d;
      best = i;
      bq = q;
    }
  }
  const rest = [...loop.slice(best + 1), ...loop.slice(0, best + 1)];
  // Avoid a zero-length first segment when the nearest point is a vertex.
  if (dist2(rest[rest.length - 1], bq) < 1e-12) rest.pop();
  if (dist2(rest[0], bq) < 1e-12) rest.shift();
  return [bq, ...rest];
}

export const closeLoop = (loop: Loop, z: number): Vec3[] => [...loop, loop[0]].map(p => [p.x, p.y, z]);

/** Ramp down along a closed loop from zFrom to zTo, then one full lap at zTo. Plunges if the loop is tiny. */
export function rampLoop(loop: Loop, zFrom: number, zTo: number, s: CamSettings, tool: Tool): Pass {
  const per = pathLength(loop, true);
  const pts: Vec3[] = [];
  const feeds: number[] = [];
  if (per < tool.diameter || zFrom <= zTo) {
    pts.push([loop[0].x, loop[0].y, zTo]);
    feeds.push(s.plungeFeed);
  } else {
    const rampLen = (zFrom - zTo) / Math.tan((s.rampAngleDeg * Math.PI) / 180);
    if (Math.ceil(rampLen / per) * loop.length > 100_000)
      throw new CamInputError([{ field: 'rampAngleDeg', message: 'would require more than 100000 entry segments' }]);
    pts.push([loop[0].x, loop[0].y, zFrom]);
    feeds.push(s.plungeFeed);
    let travelled = 0;
    const closed = [...loop, loop[0]];
    outer: for (;;) {
      for (let i = 1; i < closed.length; i++) {
        const a = closed[i - 1],
          b = closed[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (travelled + seg >= rampLen) {
          const t = (rampLen - travelled) / seg;
          const bottom: Vec3 = [a.x + t * (b.x - a.x), a.y + t * (b.y - a.y), zTo];
          pts.push(bottom);
          feeds.push(s.feed);
          // Continue from here for a full lap at depth, back to where the ramp reached the bottom.
          for (const p of [...closed.slice(i, closed.length - 1), ...closed.slice(0, i)]) {
            pts.push([p.x, p.y, zTo]);
            feeds.push(s.feed);
          }
          pts.push([...bottom]);
          feeds.push(s.feed);
          break outer;
        }
        travelled += seg;
        pts.push([b.x, b.y, zFrom - (travelled / rampLen) * (zFrom - zTo)]);
        feeds.push(s.feed);
      }
    }
  }
  if (pts.length === 1) {
    for (const p of closeLoop(loop, zTo).slice(1)) {
      pts.push(p);
      feeds.push(s.feed);
    }
  }
  return { pts, feeds, link: 'retract' };
}

export function components(paths: PathsD): PathsD[] {
  const outers = paths.filter(p => areaD(p) > 0);
  const holes = paths.filter(p => areaD(p) < 0);
  const comps = outers.map(o => [o]);
  for (const h of holes) {
    const c = comps.find(c => pointInPolygonD(h[0], c[0]) !== PointInPolygonResult.IsOutside);
    c?.push(h);
  }
  return comps;
}

/** How deep one pass cuts with this bit: a max stepdown for all bits, else the bit's own, else the material's share. */
export function stepdownFor(tool: Tool, s: Pick<CamSettings, 'maxStepdown' | 'material'>): number {
  return s.maxStepdown ?? tool.stepdown ?? s.material.stepdownFactor * tool.diameter;
}

export function depthLevels(top: number, bottom: number, maxStep: number): number[] {
  validateDepthRange(top, bottom, maxStep);
  const n = Math.max(1, Math.ceil((top - bottom) / maxStep - 1e-9));
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? bottom : top - ((k + 1) * (top - bottom)) / n));
}

/** The settings a bit cuts with: its own cutting data over the job's. */
export function cuttingWith(tool: Tool, s: CamSettings): CamSettings {
  return {
    ...s,
    feed: tool.feed ?? s.feed,
    plungeFeed: tool.plungeFeed ?? s.plungeFeed,
    rampFeed: tool.rampFeed ?? s.rampFeed,
    leadFeed: tool.leadFeed ?? s.leadFeed,
    leadOutFeed: tool.leadOutFeed ?? s.leadOutFeed,
    finishFeed: tool.finishFeed ?? s.finishFeed,
    reducedFeed: tool.reducedFeed ?? s.reducedFeed,
    transitionFeed: tool.transitionFeed ?? s.transitionFeed,
    stepoverFactor: tool.stepover ? tool.stepover / tool.diameter : s.stepoverFactor,
    finalFeedFactor: tool.finalFeedFactor ?? s.finalFeedFactor,
  };
}

export function scheduledPass(pass: Pass, s: CamSettings, tool: Tool, role: MotionRole = 'cut'): Pass {
  return applyFeedPolicy(
    { ...pass, phase: pass.phase ?? 'rough' },
    {
      plungeFeed: s.plungeFeed,
      rampFeed: s.rampFeed ?? s.plungeFeed,
      leadFeed: s.leadFeed ?? s.feed,
      leadOutFeed: s.leadOutFeed ?? s.leadFeed ?? s.feed,
      transitionFeed: s.transitionFeed ?? s.feed,
      reducedFeed: s.reducedFeed,
      materialSide: pass.materialSide,
      cornerFeed: s.cornerFeed ?? { factor: 0.5, minAngleDeg: 30, maxRadius: tool.diameter / 2, distance: tool.diameter / 4 },
    },
    role
  );
}

export function finishRoles(pass: Pass): Pass {
  return {
    ...pass,
    phase: 'finish',
    roles: pass.pts.map((p, i) =>
      pass.roles?.[i] === 'cut'
        ? 'finish'
        : (pass.roles?.[i] ??
          (i === 0 ? (pass.link === 'direct' ? 'link' : 'approach') : p[2] < pass.pts[i - 1][2] - 1e-8 ? 'ramp' : 'finish'))
    ),
  };
}
