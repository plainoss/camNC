import { CamInputError, validatePaths, validateTool } from './validation';
import { areaD, pointInPolygonD, PointInPolygonResult } from 'clipper2-ts';
import { offset, polyArea, union, type PathsD, type Vec3 } from './geom';
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

const loopPass = (loop: PathsD[number], z: number, feed: number, plungeFeed: number): Pass => {
  const pts: Vec3[] = [...loop, loop[0]].map(q => [q.x, q.y, z]);
  return { pts, feeds: pts.map((_, i) => (i ? feed : plungeFeed)), link: 'retract', phase: 'finish' };
};

/** Separate pieces of a region: each outer loop with the holes inside it. */
function islands(region: PathsD): PathsD[] {
  const outer = region.filter(loop => areaD(loop) > 0);
  const pieces = outer.map(loop => [loop]);
  for (const hole of region.filter(loop => areaD(loop) < 0)) {
    const i = outer.findIndex(loop => pointInPolygonD(hole[0], loop) !== PointInPolygonResult.IsOutside);
    if (i >= 0) pieces[i].push(hole);
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
 * it. Outer rings come first, so each ring only takes the next thin strip off the wall.
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
  const rings: Pass[] = [];
  const ring = (r: number, z: number) => offset(region, -r).map(loop => loopPass(loop, z, feed, plunge));
  const lastPoint = () => {
    const end = rings.at(-1)?.pts.at(-1);
    return end ? { x: end[0], y: end[1] } : { x: 0, y: 0 };
  };
  const depthAt = (r: number) => stockTop - (r - tipR) * slope;
  // The walls: one ring per step out to the depth limit, or until the artwork closes up. A stroke that closes up
  // between two steps gets one more ring on its centre line, so no ridge is left along its middle.
  for (let r = Math.min(tipR + kVCarveStep, rCap); ; ) {
    const level = offset(region, -r);
    if (!level.length) break;
    rings.push(
      ...nearestFirst(
        level.map(loop => loopPass(loop, depthAt(r), feed, plunge)),
        lastPoint()
      )
    );
    if (r >= rCap) break;
    const next = Math.min(r + kVCarveStep, rCap);
    for (const part of islands(level)) {
      if (offset(part, -(next - r)).length) continue;
      const last = closesAt(part, next - r);
      if (last > 1e-3)
        rings.push(
          ...nearestFirst(
            offset(part, -last).map(loop => loopPass(loop, depthAt(r + last), feed, plunge)),
            lastPoint()
          )
        );
    }
    r = next;
  }
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
    // Rings at the floor: right across a flat bottom with no flat bit, or the band a flat bit's radius can't reach.
    const flatStep = Math.max(0.02, (2 * kFlatCusp) / slope + 2 * tipR);
    const band = clearTool ? clearTool.diameter / 2 + flatStep : Infinity;
    for (let d = flatStep; d <= band; d += flatStep) {
      const level = ring(rCap + d, floorZ);
      if (!level.length) break;
      rings.push(...nearestFirst(level, lastPoint()));
    }
    if (clearTool) {
      const clear = pocketOperation(`${carving.name}: clear flat bottoms`, flat, stockTop, floorZ, clearTool, s);
      operations.push({ ...clear, title: 'clear flat bottoms', feature: 'pocket' });
    }
  }
  if (rings.length)
    operations.push({
      name: `${carving.name}: V-carve`,
      title: `V-carve, up to ${cap.toFixed(1)} deep`,
      kind: 'vcarve',
      feature: 'pocket',
      tool,
      plungeFeed: plunge,
      passes: rings,
      ...(warnings.length && { warnings }),
    });
  return operations;
}
