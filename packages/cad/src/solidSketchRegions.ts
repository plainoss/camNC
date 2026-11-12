import { tessellateCurve } from './curves';
import { CAD_CHORD_TOLERANCE, pointInPolygon, polygonArea, segmentsMeet } from './geometry';
import { areaPoint } from './regionProfile';
import { sketchRegions, type CadSketchRegion } from './sketchRegions';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import type { CadPoint, CadPointEntity, CadSketch } from './types';

const epsilon = CAD_GEOMETRY_TOLERANCE;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
function boxOf(points: CadPoint[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { x, y } of points) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return box;
}
const boxesMeet = (a: Box, b: Box) =>
  a.minX <= b.maxX + epsilon && b.minX <= a.maxX + epsilon && a.minY <= b.maxY + epsilon && b.minY <= a.maxY + epsilon;
const boxHolds = (box: Box, { x, y }: CadPoint) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;

interface Segment extends Box {
  a: CadPoint;
  b: CadPoint;
}
const segmentsOf = (path: CadPoint[], closed: boolean): Segment[] =>
  (closed ? path : path.slice(0, -1)).map((a, i) => {
    const b = path[(i + 1) % path.length]!;
    return { a, b, ...boxOf([a, b]) };
  });

/** Whether any of one list of segments touches or crosses any of another: a sweep along x of those in both boxes. */
function segmentListsMeet(first: Segment[], second: Segment[]): boolean {
  const firstBox = boxOf(first.flatMap(segment => [segment.a, segment.b])),
    secondBox = boxOf(second.flatMap(segment => [segment.a, segment.b]));
  const tagged = [
    ...first.filter(segment => boxesMeet(segment, secondBox)).map(segment => ({ segment, side: 0 })),
    ...second.filter(segment => boxesMeet(segment, firstBox)).map(segment => ({ segment, side: 1 })),
  ].sort((a, b) => a.segment.minX - b.segment.minX);
  const active: [Segment[], Segment[]] = [[], []];
  for (const { segment, side } of tagged) {
    for (const list of active) for (let i = list.length - 1; i >= 0; i--) if (list[i]!.maxX + epsilon < segment.minX) list.splice(i, 1);
    for (const other of active[1 - side]!)
      if (boxesMeet(segment, other) && segmentsMeet(segment.a, segment.b, other.a, other.b)) return true;
    active[side]!.push(segment);
  }
  return false;
}

/** Points within the geometry tolerance as one, found through a grid of buckets as wide as the tolerance. */
function pointIndex() {
  const points: CadPoint[] = [],
    buckets = new Map<string, number[]>();
  return (point: CadPoint): number => {
    const x = Math.floor(point.x / epsilon),
      y = Math.floor(point.y / epsilon);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const index of buckets.get(`${x + dx}:${y + dy}`) ?? [])
          if (Math.hypot(points[index]!.x - point.x, points[index]!.y - point.y) <= epsilon) return index;
    const key = `${x}:${y}`;
    buckets.set(key, [...(buckets.get(key) ?? []), points.length]);
    return points.push(point) - 1;
  };
}

interface Piece {
  path: CadPoint[];
  ends: [number, number];
}

/**
 * The closed shapes drawn in a sketch, each as a closed polyline, and every curve on a closed chain of curves, closed
 * or not. Closed curves, such as circles, are shapes, and so are chains of open curves that meet end to end and close,
 * such as a rectangle's sides. A curve with an end that meets no other curve's end is an open line, such as a cut
 * across a frame or a line of a grid, and so is one only joined to those: they never bound a shape. Where more than two
 * curve ends meet, as where a mitre line meets a frame's corner, a chain goes on along the curve drawn first, so a shape
 * keeps the sides drawn with it and a line drawn onto it later stays open.
 */
function drawnClosedShapes(sketch: CadSketch): { shapes: CadPoint[][]; chained: Segment[] } {
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  const shapes: CadPoint[][] = [],
    pieces: Piece[] = [],
    endAt = pointIndex();
  for (const entity of sketch.entities) {
    if (entity.type === 'point' || entity.construction) continue;
    let path: CadPoint[];
    try {
      path = tessellateCurve(entity, points, CAD_CHORD_TOLERANCE);
    } catch {
      continue;
    }
    if (path.length < 2 || !path.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) continue;
    const ends: [number, number] = [endAt(path[0]!), endAt(path.at(-1)!)];
    if (ends[0] !== ends[1]) pieces.push({ path, ends });
    else if (path.length > 3) shapes.push(path.slice(0, -1));
  }
  // The pieces at each end, in the order they were drawn.
  const atEnd: number[][] = [];
  pieces.forEach((piece, index) => {
    for (const end of piece.ends) (atEnd[end] ??= []).push(index);
  });
  // Open lines: a curve with a loose end, until none is left.
  const live = pieces.map(() => true),
    degree = atEnd.map(list => list.length);
  const loose = degree.flatMap((count, end) => (count < 2 ? [end] : []));
  while (loose.length) {
    const end = loose.pop()!;
    for (const index of atEnd[end]!) {
      if (!live[index]) continue;
      live[index] = false;
      for (const other of pieces[index]!.ends) if (--degree[other]! === 1) loose.push(other);
    }
  }
  const chained = [
    ...shapes.flatMap(shape => segmentsOf(shape, true)),
    ...pieces.flatMap((piece, index) => (live[index] ? segmentsOf(piece.path, false) : [])),
  ];
  // Chain what's left into closed shapes, each going on along the first curve drawn that's still free.
  const used = pieces.map(() => false);
  for (let first = 0; first < pieces.length; first++) {
    if (!live[first] || used[first]) continue;
    const chain = [{ piece: first, from: pieces[first]!.ends[0] }],
      inChain = new Set([first]);
    const reached = new Map([[pieces[first]!.ends[0], 0]]);
    let at = pieces[first]!.ends[1];
    while (!reached.has(at)) {
      reached.set(at, chain.length);
      const next = atEnd[at]!.find(index => live[index] && !used[index] && !inChain.has(index));
      if (next === undefined) break;
      chain.push({ piece: next, from: at });
      inChain.add(next);
      const [a, b] = pieces[next]!.ends;
      at = a === at ? b : a;
    }
    // Stuck, it closes nothing. Otherwise it came back to its start, or to a corner on its way, as a lasso does.
    if (reached.get(at) === chain.length) {
      used[first] = true;
      continue;
    }
    const loop = chain.slice(reached.get(at));
    for (const link of loop) used[link.piece] = true;
    shapes.push(
      loop.flatMap(({ piece, from }) => {
        const { path, ends } = pieces[piece]!;
        return (ends[0] === from ? path : [...path].reverse()).slice(0, -1);
      })
    );
  }
  return { shapes, chained };
}

/**
 * How deep each region lies, counted inwards from the outside of the drawing over the edges regions share: a region
 * touching the outside, at an edge or a corner, is 1 deep, and crossing an edge on a curve of a closed chain goes one
 * deeper, while crossing an open line doesn't. Corners and edges are told by node, as the regions share them.
 */
function depthsFromOutside(regions: CadSketchRegion[], segments: Segment[]): number[] {
  const nodes = new Map<CadPoint, number>();
  const node = (point: CadPoint) => nodes.get(point) ?? nodes.set(point, nodes.size).get(point)!;
  const loops = regions.map(region =>
    [region.points, ...region.holes].map((loop, i) => (polygonArea(loop) > 0 === (i === 0) ? loop : [...loop].reverse()))
  );
  const pieces = new Map<string, { region: number; a: CadPoint; b: CadPoint }>();
  const across: { region: number; a: CadPoint; b: CadPoint }[][] = regions.map(() => []);
  loops.forEach((list, region) => {
    for (const loop of list)
      loop.forEach((a, i) => {
        const b = loop[(i + 1) % loop.length]!;
        if (a === b) return;
        const back = `${node(b)}>${node(a)}`,
          shared = pieces.get(back);
        if (shared) {
          pieces.delete(back);
          across[region]!.push({ region: shared.region, a, b });
          across[shared.region]!.push({ region, a, b });
        } else pieces.set(`${node(a)}>${node(b)}`, { region, a, b });
      });
  });
  const outside = new Set([...pieces.values()].flatMap(piece => [piece.a, piece.b]));
  // An edge on a curve of a closed chain: its middle lies on one of them.
  // Buckets about as big as a typical segment, so a long one spans a few and a query looks at a few segments.
  const extents = segments.map(segment => Math.max(segment.maxX - segment.minX, segment.maxY - segment.minY)).sort((a, b) => a - b);
  const all = boxOf(segments.flatMap(segment => [segment.a, segment.b]));
  const cell = Math.max(extents[extents.length >> 1] ?? 1, (all.maxX - all.minX + all.maxY - all.minY) / 2048, 1e-3);
  const grid = new Map<string, Segment[]>();
  for (const segment of segments)
    for (let x = Math.floor(segment.minX / cell); x <= Math.floor(segment.maxX / cell); x++)
      for (let y = Math.floor(segment.minY / cell); y <= Math.floor(segment.maxY / cell); y++)
        grid.set(`${x}:${y}`, [...(grid.get(`${x}:${y}`) ?? []), segment]);
  const onChain = (a: CadPoint, b: CadPoint) => {
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return (grid.get(`${Math.floor(middle.x / cell)}:${Math.floor(middle.y / cell)}`) ?? []).some(segment => {
      const dx = segment.b.x - segment.a.x,
        dy = segment.b.y - segment.a.y,
        length = Math.hypot(dx, dy);
      if (!boxesMeet(segment, { minX: middle.x, maxX: middle.x, minY: middle.y, maxY: middle.y }) || length === 0) return false;
      return Math.abs(dx * (middle.y - segment.a.y) - dy * (middle.x - segment.a.x)) / length <= 1e-6 * Math.max(1, length);
    });
  };
  const depth = regions.map(() => Infinity);
  let frontier = loops.flatMap((list, region) => (list.some(loop => loop.some(point => outside.has(point))) ? [region] : []));
  for (const region of frontier) depth[region] = 1;
  // One depth at a time: crossing an open line stays at it, crossing a closed chain's curve goes on to the next.
  for (let level = 1; frontier.length; level++) {
    const stack = [...frontier],
      next: number[] = [];
    while (stack.length) {
      const region = stack.pop()!;
      if (depth[region] !== level) continue;
      for (const { region: other, a, b } of across[region]!) {
        const step = onChain(a, b) ? 1 : 0;
        if (level + step >= depth[other]!) continue;
        depth[other] = level + step;
        (step ? next : stack).push(other);
      }
    }
    frontier = next;
  }
  return depth;
}

/**
 * A sketch's regions that are solid when it's extruded as shapes apart, by how its drawn closed shapes nest. Shapes
 * whose outlines cross or touch, without one holding the other, are one shape, as overlapping rectangles or three
 * overlapping circles are, and all of it is solid. A region inside an odd number of shapes is solid, and one inside an
 * even number is a hole: the inside of a frame or a circle in a panel is a hole, an island in it is solid again, also
 * when it touches the hole's edge, and a diamond drawn inside a square, touching its sides, is a hole. Open lines, such as the mitres
 * or cuts across a frame or the lines of a grid, only split regions, so a frame cut into pieces keeps its hole.
 *
 * A region inside no shape, bounded by lines that cross or by chains of curves that don't close one around it, is
 * solid when it's an odd number of closed chains' curves deep from the outside: the inside of a frame drawn as closed
 * pieces is a hole, but the cells of a grid of lines are solid.
 */
export function solidSketchRegionIds(sketch: CadSketch): string[] {
  const { shapes, chained } = drawnClosedShapes(sketch);
  const regions = sketchRegions(sketch, CAD_CHORD_TOLERANCE);
  const boxes = shapes.map(boxOf);
  const inside = regions.map(region => {
    const point = areaPoint(region);
    return point ? shapes.flatMap((shape, index) => (boxHolds(boxes[index]!, point) && pointInPolygon(point, shape) ? [index] : [])) : null;
  });
  const holding = shapes.map(() => new Set<number>());
  inside.forEach((list, region) => list?.forEach(shape => holding[shape]!.add(region)));
  const holds = (outer: number, inner: number) =>
    holding[inner]!.size > 0 && [...holding[inner]!].every(region => holding[outer]!.has(region));
  // Shapes that cross or touch go together, unless one holds the other: their union is one outline.
  const group = shapes.map((_, index) => index);
  const root = (index: number): number => (group[index] === index ? index : (group[index] = root(group[index]!)));
  const order = shapes.map((_, index) => index).sort((a, b) => boxes[a]!.minX - boxes[b]!.minX);
  const segments = shapes.map(shape => segmentsOf(shape, true));
  let active: number[] = [];
  for (const shape of order) {
    active = active.filter(other => boxes[other]!.maxX + epsilon >= boxes[shape]!.minX);
    for (const other of active)
      if (
        root(other) !== root(shape) &&
        boxesMeet(boxes[other]!, boxes[shape]!) &&
        !holds(other, shape) &&
        !holds(shape, other) &&
        segmentListsMeet(segments[other]!, segments[shape]!)
      )
        group[root(other)] = root(shape);
    active.push(shape);
  }
  const loose = inside.some(list => list?.length === 0) ? depthsFromOutside(regions, chained) : [];
  return regions
    .filter((_, index) => {
      const list = inside[index];
      // A region with no point of its own area is too thin to tell; it's kept rather than lost.
      if (!list) return true;
      if (list.length) return new Set(list.map(root)).size % 2 === 1;
      // Every region touches the outside or shares an edge with one that's reached, so all have a depth; if one didn't
      // it would be kept rather than lost.
      return !Number.isFinite(loose[index]!) || loose[index]! % 2 === 1;
    })
    .map(region => region.id);
}
