import { pointInPolygon, polygonArea } from './geometry';
import type { CadPoint, EvaluatedCadPart } from './types';

/** A corner bends less than this, in degrees, is a curve's facet, not a corner a bit can't reach. */
const kMinTurn = 10;
/** Arc points per full turn of a bone. */
const kArcSteps = 48;

const sub = (a: CadPoint, b: CadPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const length = (v: CadPoint) => Math.hypot(v.x, v.y);
const unit = (v: CadPoint) => ({ x: v.x / length(v), y: v.y / length(v) });
const dot = (a: CadPoint, b: CadPoint) => a.x * b.x + a.y * b.y;

function onSegment(p: CadPoint, a: CadPoint, b: CadPoint): boolean {
  const ab = sub(b, a),
    t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return Math.hypot(p.x - a.x - t * ab.x, p.y - a.y - t * ab.y) < 1e-6;
}
const onLoop = (p: CadPoint, loop: CadPoint[]) => loop.some((a, i) => onSegment(p, a, loop[(i + 1) % loop.length]!));

/**
 * One loop with a bone at each corner a round bit of `radius` can't reach: every corner whose angle on the cut-away
 * side is under 180°. `cutInside` says which side that is. A bone is the bit's circle through the corner, centred on the
 * corner's bisector, so the bit reaches the very corner. Corners where `keep` says so stay as they are, and so do corners
 * whose edges are too short to take a bone, which are counted.
 */
function relieveLoop(
  points: CadPoint[],
  cutInside: boolean,
  radius: number,
  keep: (p: CadPoint) => boolean,
  fits: (bone: CadPoint[]) => boolean = () => true
) {
  const counterclockwise = polygonArea(points) > 0,
    loop = counterclockwise ? points : [...points].reverse();
  const out: CadPoint[] = [];
  let skipped = 0;
  loop.forEach((p, i) => {
    const a = loop[(i + loop.length - 1) % loop.length]!,
      b = loop[(i + 1) % loop.length]!;
    const inward = sub(p, a),
      outward = sub(b, p),
      d1 = unit(inward),
      d2 = unit(outward),
      turn = (Math.atan2(d1.x * d2.y - d1.y * d2.x, dot(d1, d2)) * 180) / Math.PI;
    // On a counterclockwise loop, a left turn is a corner of what's inside it.
    const cutCorner = cutInside ? turn > kMinTurn : turn < -kMinTurn;
    if (!cutCorner || keep(p)) return out.push(p);
    const bisector = unit({ x: d2.x - d1.x, y: d2.y - d1.y }),
      centre = { x: p.x + radius * bisector.x, y: p.y + radius * bisector.y };
    const back = 2 * radius * dot(bisector, { x: -d1.x, y: -d1.y }),
      ahead = 2 * radius * dot(bisector, d2);
    // Each edge is shared with the next corner, which may want a bone too.
    if (back > length(inward) / 2 || ahead > length(outward) / 2) {
      skipped++;
      return out.push(p);
    }
    const from = { x: p.x - back * d1.x, y: p.y - back * d1.y },
      to = { x: p.x + ahead * d2.x, y: p.y + ahead * d2.y };
    const angle = (q: CadPoint) => Math.atan2(q.y - centre.y, q.x - centre.x);
    // The bone bulges past the corner, the long way round from one edge to the other.
    const start = angle(from);
    let sweep = angle(to) - start;
    const through = angle(p) - start;
    const normal = (value: number) => ((value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (normal(through) > normal(sweep)) sweep = normal(sweep) - 2 * Math.PI;
    else sweep = normal(sweep);
    const steps = Math.max(4, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * kArcSteps));
    const bone = [from];
    for (let k = 1; k < steps; k++) {
      const t = start + (sweep * k) / steps;
      bone.push({ x: centre.x + radius * Math.cos(t), y: centre.y + radius * Math.sin(t) });
    }
    bone.push(to);
    // A bone that would break into another contour, such as a hole's bone through a nearby edge, isn't cut.
    if (!fits(bone)) {
      skipped++;
      return out.push(p);
    }
    out.push(...bone);
  });
  return { points: counterclockwise ? out : out.reverse(), skipped };
}

/** One cut-away loop with bones in its corners, leaving corners on the part's `outline` square. */
export function relieveLoopCorners(points: CadPoint[], cutInside: boolean, diameter: number, outline: CadPoint[]) {
  return relieveLoop(points, cutInside, diameter / 2, p => onLoop(p, outline));
}

/**
 * The part with a bone in each inside corner of its outline, holes, cuts and the islands left in them, so a bit of
 * `diameter` cuts every corner fully and parts that fit into them go all the way in. Corners on the part's own edge,
 * where a cut runs off it, stay square: the bit runs out past them.
 */
export function relieveCorners(part: EvaluatedCadPart, diameter: number): { part: EvaluatedCadPart; skipped: number } {
  const radius = diameter / 2;
  let skipped = 0;
  // A bone stays inside the part and out of its holes, so contours never cross.
  const insidePart = (loop: CadPoint[]) => (bone: CadPoint[]) =>
    bone.every(p => pointInPolygon(p, part.outline) && !part.holes.some(hole => hole !== loop && pointInPolygon(p, hole)));
  const clearOfHoles = (bone: CadPoint[]) => bone.every(p => !part.holes.some(hole => pointInPolygon(p, hole)));
  const relieve = (points: CadPoint[], cutInside: boolean, keep: (p: CadPoint) => boolean = () => false, count = true) => {
    const result = relieveLoop(points, cutInside, radius, keep, cutInside ? insidePart(points) : clearOfHoles);
    if (count) skipped += result.skipped;
    return result.points;
  };
  const onEdge = (p: CadPoint) => onLoop(p, part.outline);
  const outline = relieve(part.outline, false),
    holes = part.holes.map(hole => relieve(hole, true));
  return {
    part: {
      ...part,
      outline,
      holes,
      // The loops repeat the outline and holes for their lineage, so their corners were counted there already.
      loops: part.loops.map(loop => ({ ...loop, points: relieve(loop.points, loop.kind === 'hole', undefined, false) })),
      ...(part.cuts && {
        cuts: part.cuts.map(cut => ({
          ...cut,
          outline: relieve(cut.outline, true, onEdge),
          islands: cut.islands.map(island => relieve(island, false, onEdge)),
        })),
      }),
    },
    skipped,
  };
}
