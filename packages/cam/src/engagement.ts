import type { Vec3 } from './geom';
import { StockModel } from './stock';
import type { Pass, Tool } from './toolpaths';
import type { MotionRole } from './motion';
import { parsedPostNumber } from './postValidation';

const positive = (value: number) => Number.isFinite(value) && value > 0;
export interface RemovalRateOptions {
  /** Maximum new planar frontier per minute over each block, mm2/min; axial floor removal is separate. */
  maxPlanarRemovalRate: number;
  minimumFeed: number;
  sampleLength?: number;
  plungeFeed?: number;
  /** Bound detailed polygon analysis; later moves use the conservative full-slot frontier bound. */
  maxDetailedQueries?: number;
  maxDetailedSweeps?: number;
}

export interface RemovalRateResult {
  passes: RatedPass[];
  limitedSegments: number;
  maximumAreaRate: number;
  /** Pure axial entries need a separate plunge/axial-depth policy; no planar-rate claim is made for them. */
  axialEntries: number;
  descendingSegments: number;
  retractedLinks: number;
  conservativeFrontierSegments: number;
}

type RatedPass = Pass & { roles?: MotionRole[] };

/** Limit material-area removal using prior sweeps; geometric engagement and axial load remain separate constraints. */
export function limitRemovalRate(passes: RatedPass[], tool: Tool, stock: StockModel, options: RemovalRateOptions): RemovalRateResult {
  const radius = tool.diameter / 2,
    step = options.sampleLength ?? radius / 2;
  if (![radius, step, options.maxPlanarRemovalRate, options.minimumFeed].every(positive))
    throw new Error('Invalid material removal-rate policy');
  if (options.plungeFeed !== undefined && !positive(options.plungeFeed)) throw new Error('Invalid material removal plunge feed');
  const queryBudget = options.maxDetailedQueries ?? 64,
    sweepBudget = options.maxDetailedSweeps ?? 128;
  if (![queryBudget, sweepBudget].every(value => Number.isInteger(value) && value >= 0))
    throw new Error('Invalid material analysis budget');
  let detailedQueries = 0,
    conservativeFrontierSegments = 0;
  let limitedSegments = 0,
    maximumAreaRate = 0,
    axialEntries = 0,
    descendingSegments = 0,
    retractedLinks = 0;
  const resolve = (from: Vec3, to: Vec3, requestedFeed: number): number => {
    if (!positive(requestedFeed)) throw new Error('Cutting feed must be positive and finite');
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (to[2] < from[2]) descendingSegments++;
    if (length === 0) {
      if (to[2] < from[2] && to[2] < stock.stockTop) axialEntries++;
      stock.recordPath([from, to], radius);
      return requestedFeed;
    }
    // A translated disk adds at most D * length outside its occupied starting disk.
    // This excludes axial removal under that disk, which ramp/plunge limits govern separately.
    let frontierArea = 2 * radius * length;
    let fullSlot = true;
    if (requestedFeed > options.maxPlanarRemovalRate / (2 * radius) && detailedQueries < queryBudget && stock.checkpoint() <= sweepBudget) {
      detailedQueries++;
      const measured = stock.measureMove(from, to, radius).newArea;
      if (measured < frontierArea) {
        frontierArea = measured;
        fullSlot = false;
      }
    } else conservativeFrontierSegments++;
    const allowed = fullSlot
      ? options.maxPlanarRemovalRate / (2 * radius)
      : frontierArea > 0
        ? (options.maxPlanarRemovalRate * length) / frontierArea
        : requestedFeed;
    const target = Math.min(requestedFeed, allowed);
    let feed = Math.floor(target * 1000) / 1000;
    // Keep an exactly representable boundary feed; otherwise reserve parsing error before rounding down.
    if (frontierArea > 0 && parsedPostNumber(feed) > allowed) {
      const margin = 0.001 + target * 2 ** -20;
      feed = Math.floor(Math.max(0, target - margin) * 1000) / 1000;
      if (parsedPostNumber(feed) > allowed) throw new Error('Material removal bound is not representable at the posted feed precision');
    }
    if (feed < options.minimumFeed - 1e-9) throw new Error('Material removal bound cannot be met at the minimum permitted feed');
    if (feed < requestedFeed - 1e-9) limitedSegments++;
    maximumAreaRate = Math.max(maximumAreaRate, (frontierArea / length) * parsedPostNumber(feed));
    stock.recordPath([from, to], radius);
    return feed;
  };
  const checkpoint = stock.checkpoint();
  try {
    let last: Vec3 | undefined;
    const resolved = passes.map((pass, pi) => {
      if (!pass.pts.length || pass.pts.length !== pass.feeds.length)
        throw new Error('Material removal policy requires nonempty point/feed pairs');
      const first = pass.pts[0];
      let approachFeed = pass.feeds[0];
      let link = pass.link,
        clearLink = false;
      if (pi > 0 && link === 'direct' && last) {
        clearLink = last.every((value, axis) => value === first[axis]) || stock.certifyLink(last, first, radius).clear;
        if (!clearLink) {
          link = 'retract';
          retractedLinks++;
        }
      }
      if (pi === 0 || link === 'retract') {
        approachFeed = Math.min(approachFeed, tool.plungeFeed ?? options.plungeFeed ?? approachFeed);
        resolve([first[0], first[1], Math.max(stock.stockTop, first[2])], first, approachFeed);
      } else if (last) approachFeed = resolve(last, first, approachFeed);
      const pts: Vec3[] = [[...first]],
        feeds = [approachFeed];
      const roles = pass.roles ? [pi === 0 || link === 'retract' ? ('approach' as const) : pass.roles[0]] : undefined;
      for (let i = 1; i < pass.pts.length; i++) {
        const from = pass.pts[i - 1],
          to = pass.pts[i];
        const count = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
        if (count > 100000) throw new Error('Material removal policy exceeds the supported segment count');
        for (let k = 1; k <= count; k++) {
          const next: Vec3 = k === count ? [...to] : (from.map((value, axis) => value + ((to[axis] - value) * k) / count) as Vec3);
          feeds.push(resolve(pts[pts.length - 1], next, pass.feeds[i]));
          pts.push(next);
          roles?.push(pass.roles![i]);
        }
      }
      last = pts[pts.length - 1];
      return { ...pass, pts, feeds, link, clearLink, ...(roles ? { roles } : {}) };
    });
    return {
      passes: resolved,
      limitedSegments,
      maximumAreaRate,
      axialEntries,
      descendingSegments,
      retractedLinks,
      conservativeFrontierSegments,
    };
  } catch (error) {
    stock.rollback(checkpoint);
    throw error;
  }
}
