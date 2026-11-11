import { tessellateCurve } from './curves';
import { CAD_CHORD_TOLERANCE, loopsMeet, pointInPolygon } from './geometry';
import { areaPoint } from './regionProfile';
import { sketchRegions } from './sketchRegions';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import type { CadPoint, CadPointEntity, CadSketch } from './types';

const near = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y) <= CAD_GEOMETRY_TOLERANCE;

interface Piece {
  path: CadPoint[];
  /** Where its ends are, as indices into the list of ends the sketch's open curves share. */
  ends: [number, number];
}

/**
 * The closed shapes drawn in a sketch, each as a closed polyline: closed curves, such as circles, and chains of open
 * curves that meet end to end and close, such as a rectangle's sides. A curve with an end that meets no other curve's
 * end is an open line, such as a cut across a frame or a line of a grid, and so is one only joined to those, so they
 * never bound a shape. Where more than two curve ends meet, as where a mitre line meets a frame's corner, a chain goes
 * on along the curve drawn first, so a shape keeps the sides drawn with it and a line drawn onto it later stays open.
 */
export function drawnClosedShapes(sketch: CadSketch): CadPoint[][] {
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  const shapes: CadPoint[][] = [],
    pieces: Piece[] = [],
    ends: CadPoint[] = [];
  const endAt = (point: CadPoint) => {
    const known = ends.findIndex(end => near(end, point));
    return known >= 0 ? known : ends.push(point) - 1;
  };
  for (const entity of sketch.entities) {
    if (entity.type === 'point' || entity.construction) continue;
    let path: CadPoint[];
    try {
      path = tessellateCurve(entity, points, CAD_CHORD_TOLERANCE);
    } catch {
      continue;
    }
    if (path.length < 2 || !path.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) continue;
    if (near(path[0]!, path.at(-1)!)) {
      if (path.length > 3) shapes.push(path.slice(0, -1));
    } else pieces.push({ path, ends: [endAt(path[0]!), endAt(path.at(-1)!)] });
  }
  // Open lines: a curve with a loose end, until none is left.
  const live = new Set(pieces.keys());
  for (let pruned = true; pruned; ) {
    pruned = false;
    const count = new Map<number, number>();
    for (const index of live) for (const end of pieces[index]!.ends) count.set(end, (count.get(end) ?? 0) + 1);
    for (const index of [...live])
      if (pieces[index]!.ends.some(end => count.get(end)! < 2)) {
        live.delete(index);
        pruned = true;
      }
  }
  // Chain what's left into closed shapes, each going on along the first curve drawn that's still free.
  const used = new Set<number>();
  for (const first of [...live].sort((a, b) => a - b)) {
    if (used.has(first)) continue;
    const chain = [{ piece: first, from: pieces[first]!.ends[0] }];
    const reached = new Map([[pieces[first]!.ends[0], 0]]);
    let at = pieces[first]!.ends[1];
    while (!reached.has(at)) {
      reached.set(at, chain.length);
      const next = [...live]
        .filter(index => !used.has(index) && !chain.some(link => link.piece === index) && pieces[index]!.ends.includes(at))
        .sort((a, b) => a - b)[0];
      if (next === undefined) break;
      chain.push({ piece: next, from: at });
      const [a, b] = pieces[next]!.ends;
      at = a === at ? b : a;
    }
    // Stuck, it closes nothing. Otherwise it came back to its start, or to a corner on its way, as a lasso does.
    if (reached.get(at) === chain.length) {
      used.add(first);
      continue;
    }
    const loop = chain.slice(reached.get(at));
    for (const link of loop) used.add(link.piece);
    shapes.push(
      loop.flatMap(({ piece, from }) => {
        const { path, ends } = pieces[piece]!;
        const along = ends[0] === from ? path : [...path].reverse();
        return along.slice(0, -1);
      })
    );
  }
  return shapes;
}

/**
 * A sketch's regions that are solid when it's extruded as shapes apart, by how its drawn closed shapes nest. Shapes
 * that cross or touch are one shape, as overlapping rectangles or three overlapping circles are, and all of it is
 * solid. A region inside an odd number of shapes, each holding it whole, is solid, and one inside an even number is a
 * hole: the inside of a frame or a circle in a panel is a hole, and an island in it is solid again. Open lines, such as
 * the mitres or cuts across a frame or the lines of a grid, only split regions, so a frame cut into pieces keeps its
 * hole. A region inside no shape at all, bounded only by lines that cross, is solid too.
 */
export function solidSketchRegionIds(sketch: CadSketch): string[] {
  const shapes = drawnClosedShapes(sketch);
  // Shapes that cross or touch go together: their union is one outline, nested in others or holding them.
  const group = shapes.map((_, index) => index);
  const root = (index: number): number => (group[index] === index ? index : (group[index] = root(group[index]!)));
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++) if (root(i) !== root(j) && loopsMeet(shapes[i]!, shapes[j]!)) group[root(i)] = root(j);
  return sketchRegions(sketch, CAD_CHORD_TOLERANCE)
    .filter(region => {
      const inside = areaPoint(region);
      // A region with no point of its own area is too thin to tell; it's kept rather than lost.
      if (!inside) return true;
      const around = new Set(shapes.flatMap((shape, index) => (pointInPolygon(inside, shape) ? [root(index)] : [])));
      return around.size === 0 || around.size % 2 === 1;
    })
    .map(region => region.id);
}
