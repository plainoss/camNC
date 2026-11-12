import type { PathsD } from 'clipper2-ts';
import type { PartFeatures } from '../features';
import { difference, intersect, union, type Pt, type Vec3 } from '../geom';
import { ON_CIRCLE, pathCircles, type Circle } from './arcs';
import { stackedWalls, withoutSeams, withUsedPoints } from './walls';

/** A closed solid as faces bounded by shared edges, in the part's local frame (mm, z up). */
export interface Brep {
  points: Vec3[];
  edges: BrepEdge[];
  faces: BrepFace[];
  /** Arc edges a loop used only part of, which makes the shell invalid. */
  partialArcs?: number;
}
export interface BrepEdge {
  start: number;
  end: number;
  /** A straight edge, or an arc of a horizontal circle at its vertices' height, run counterclockwise when `ccw`. */
  circle?: Circle & { z: number; ccw: boolean };
}
export interface BrepFace {
  /** A plane through `origin` facing `normal` (outward), or a vertical cylinder about `circle`'s center. */
  surface: { kind: 'plane'; origin: Vec3; normal: Vec3 } | { kind: 'cylinder'; circle: Circle; outward: boolean };
  /** Each loop runs counterclockwise seen from outside, holes clockwise: edges with the direction they're used in. */
  loops: { edge: number; forward: boolean }[][];
}

type Path = Pt[];
/** Points this close are one vertex: twice Clipper's 1e-4 mm rounding. */
const SAME_POINT = 2e-4;
const signedArea = (path: Path) =>
  path.reduce((sum, p, i) => sum + p.x * path[(i + 1) % path.length]!.y - path[(i + 1) % path.length]!.x * p.y, 0) / 2;
function contains(path: Path, point: Pt) {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const a = path[i]!,
      b = path[j]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/**
 * The path with each of its own vertices that lies on one of its segments split into it, and the zero-width spikes
 * that leaves taken out. Clipper can return a path that runs out to a curve point and back along the chord past it.
 */
function cleanPath(path: Path): Path {
  const split = path.flatMap((p, n) => {
    const q = path[(n + 1) % path.length]!,
      dx = q.x - p.x,
      dy = q.y - p.y,
      length = dx * dx + dy * dy;
    if (!length) return [p];
    const inside = path
      .map(v => ({ v, t: ((v.x - p.x) * dx + (v.y - p.y) * dy) / length }))
      .filter(({ v, t }) => t > 1e-9 && t < 1 - 1e-9 && ((v.x - p.x) * dy - (v.y - p.y) * dx) ** 2 < ON_CIRCLE * ON_CIRCLE * length)
      .sort((a, b) => a.t - b.t);
    return [p, ...inside.map(({ v }) => v)];
  });
  const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
  const cycle = split.filter((p, i) => !same(p, split[(i + 1) % split.length]!));
  for (let changed = true; changed && cycle.length > 3; ) {
    changed = false;
    for (let i = 0; i < cycle.length && cycle.length > 3; i++)
      if (same(cycle[(i + cycle.length - 1) % cycle.length]!, cycle[(i + 1) % cycle.length]!)) {
        cycle.splice(i, 1);
        cycle.splice(i % cycle.length, 1);
        changed = true;
      }
  }
  return cycle;
}

/** Clipper's paths as outer loops with the holes inside each. */
function shapes(region: PathsD) {
  const outers = region.filter(path => signedArea(path) > 0).sort((a, b) => signedArea(a) - signedArea(b)),
    groups = outers.map(outer => ({ outer, holes: [] as Path[] }));
  for (const hole of region.filter(path => signedArea(path) < 0)) groups.find(group => contains(group.outer, hole[0]!))?.holes.push(hole);
  return groups.map(({ outer, holes }) => ({ outer: cleanPath(outer), holes: holes.map(cleanPath) }));
}

/**
 * The part as a B-rep, built the way its mesh is (`cutPartMesh`): one face per height and side, the bottom, and walls
 * between heights, one face for as many heights as its outline stays the same. Wall runs that follow a circle become
 * one cylindrical face with arc edges; everything else is planar, so curves other than arcs stay within the sketch's
 * chord tolerance.
 */
export function partBrep(features: PartFeatures, underside?: PartFeatures | null): Brep {
  const exact = buildBrep(features, underside, true);
  // Where arcs can't be matched up between faces, the part is still written, with flat facets for its curves.
  return brepProblems(exact).length ? buildBrep(features, underside, false) : exact;
}

function buildBrep(features: PartFeatures, underside: PartFeatures | null | undefined, arcs: boolean): Brep {
  const points: Vec3[] = [],
    index = new Map<string, number[]>();
  /**
   * One vertex for points within Clipper's rounding of each other: side B's regions are built turned over and back, so
   * the same corner can come back from it rounded the other way.
   */
  const vertex = (x: number, y: number, z: number) => {
    const cell = (v: number) => Math.round(v / SAME_POINT);
    const [cx, cy, cz] = [cell(x), cell(y), Math.round(z * 1e5)];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const at of index.get(`${cx + dx},${cy + dy},${cz}`) ?? []) {
          const p = points[at]!;
          if (Math.abs(p[0] - x) <= SAME_POINT && Math.abs(p[1] - y) <= SAME_POINT) return at;
        }
    const at = points.push([x, y, z]) - 1;
    const key = `${cx},${cy},${cz}`;
    index.set(key, [...(index.get(key) ?? []), at]);
    return at;
  };
  /** Faces as vertex cycles until edges are known. Arc faces carry the chains that become their arc edges. */
  type Draft = { surface: BrepFace['surface']; loops: number[][] };
  const drafts: Draft[] = [];
  const chains: { vertices: number[]; circle: Circle; z: number }[] = [];

  const cap = (region: PathsD, z: number, up: boolean) => {
    for (const { outer, holes } of shapes(union(region))) {
      // Coincident boundaries can leave slivers with no area.
      if (Math.abs(signedArea(outer)) < 1e-6) continue;
      const loop = (path: Path) => {
        const ids = path.map(p => vertex(p.x, p.y, z));
        return up ? ids : ids.reverse();
      };
      drafts.push({ surface: { kind: 'plane', origin: [0, 0, z], normal: [0, 0, up ? 1 : -1] }, loops: [outer, ...holes].map(loop) });
    }
  };
  const levels = [...(features.meshLevels ?? features.levels)].sort((a, b) => b.z - a.z);
  const below = [...(underside?.meshLevels ?? underside?.levels ?? [])].sort((a, b) => b.z - a.z),
    thickness = features.thickness;

  // Walls between heights, as the mesh has them: material present in both stacks over each interval.
  const heights = [...new Set([0, ...levels.map(level => level.z), ...below.map(level => thickness - level.z)])].sort((a, b) => a - b);
  const slabs = heights.slice(0, -1).map((low, i) => {
    const high = heights[i + 1]!,
      middle = (low + high) / 2,
      above = union(levels.filter(level => level.z > middle).flatMap(level => level.region)),
      region = below.length
        ? intersect(above, union(below.filter(level => level.z > thickness - middle).flatMap(level => level.region)))
        : above;
    return { low, high, region: region.map(cleanPath) };
  });
  // Each height's faces are where the material below it and above it differ, from the same regions as the walls, so
  // they meet point for point: facing up where there's material only below, down where there's only material above.
  heights.forEach((z, k) => {
    const under = slabs[k - 1]?.region ?? [],
      over = slabs[k]?.region ?? [];
    cap(difference(under, over), z, true);
    cap(difference(over, under), z, false);
  });
  const circles = !arcs ? [] : pathCircles(slabs.flatMap(slab => slab.region));
  const seams = new Set<number>();
  for (const { circle, ccw, along, low, high, bottom, top, first, last } of stackedWalls(slabs, circles, vertex)) {
    for (const v of [...first, ...last]) seams.add(v);
    // Along the bottom, up the last side, back along the top and down the first side, past the heights in between.
    const loop = [...bottom, ...last, ...[...top].reverse(), ...[...first].reverse()];
    if (!circle) {
      // Paths run with the material on their left, so each wall faces outward to the right.
      const [p, q] = along as [Pt, Pt];
      const dx = q.x - p.x,
        dy = q.y - p.y,
        length = Math.hypot(dx, dy);
      drafts.push({ surface: { kind: 'plane', origin: [p.x, p.y, low], normal: [dy / length, -dx / length, 0] }, loops: [loop] });
      continue;
    }
    chains.push({ vertices: bottom, circle, z: low }, { vertices: top, circle, z: high });
    // A counterclockwise run has the material on its left, inside the circle: the face looks away from the axis.
    drafts.push({ surface: { kind: 'cylinder', circle, outward: ccw }, loops: [loop] });
  }

  const level = new Map<number, number[]>();
  points.forEach((p, v) => {
    const z = Math.round(p[2] * 1e5);
    level.set(z, [...(level.get(z) ?? []), v]);
  });
  for (const draft of drafts)
    draft.loops = draft.loops.map(loop => withoutSpikes(conform(loop, points, true, circles, level))).filter(loop => loop.length >= 3);
  // A wall whose two ends merged into one vertex has nothing left.
  for (let i = drafts.length - 1; i >= 0; i--) if (!drafts[i]!.loops.length) drafts.splice(i, 1);
  for (const chain of chains) chain.vertices = withoutSpikes(conform(chain.vertices, points, false, circles, level), false);
  withoutSeams(drafts, chains, points, seams);
  return withUsedPoints(withEdges(drafts, chains, points));
}

/**
 * Splits a loop's or chain's edges at every vertex lying inside them: on the segment within Clipper's rounding, or on the circle a tessellated
 * arc's chord follows, between its ends. Faces built from different Clipper results can break the same boundary at
 * different points, as where another cut's boundary crosses a hole, and a closed shell needs each edge to be shared.
 */
function conform(sequence: number[], points: Vec3[], cyclic: boolean, circles: readonly Circle[], level: Map<number, number[]>): number[] {
  const onCircle = (c: Circle, p: Vec3) => Math.abs(Math.hypot(p[0] - c.x, p[1] - c.y) - c.r) <= ON_CIRCLE;
  const turn = (c: Circle, p: Vec3, q: Vec3) => (p[0] - c.x) * (q[1] - c.y) - (p[1] - c.y) * (q[0] - c.x);
  return sequence.flatMap((a, n) => {
    if (!cyclic && n === sequence.length - 1) return [a];
    const b = sequence[(n + 1) % sequence.length]!,
      p = points[a]!,
      q = points[b]!;
    if (Math.abs(p[2] - q[2]) > 1e-9) return [a];
    const dx = q[0] - p[0],
      dy = q[1] - p[1],
      length = dx * dx + dy * dy;
    const arcs = circles.filter(c => onCircle(c, p) && onCircle(c, q));
    const inside: { v: number; t: number }[] = [];
    for (const v of level.get(Math.round(p[2] * 1e5)) ?? []) {
      if (v === a || v === b) continue;
      const point = points[v]!;
      const t = ((point[0] - p[0]) * dx + (point[1] - p[1]) * dy) / length;
      if (!(t > 1e-9 && t < 1 - 1e-9)) continue;
      const straight = ((point[0] - p[0]) * dy - (point[1] - p[1]) * dx) ** 2 < ON_CIRCLE * ON_CIRCLE * length;
      const between = arcs.some(c => {
        if (!onCircle(c, point)) return false;
        const whole = turn(c, p, q);
        return Math.sign(turn(c, p, point)) === Math.sign(whole) && Math.sign(turn(c, point, q)) === Math.sign(whole);
      });
      if (straight || between) inside.push({ v, t });
    }
    return [a, ...inside.sort((m, o) => m.t - o.t).map(({ v }) => v)];
  });
}

/**
 * The loop without zero-width spikes, where it runs out to a vertex and straight back. Clipper can leave one where a
 * boundary meets a chord, and once the chord is split there both directions of the spike's edge are in one face.
 */
function withoutSpikes(loop: number[], cyclic = true): number[] {
  // Points merged into one vertex leave it twice in a row.
  const cycle = loop.filter((v, i) => (cyclic ? v !== loop[(i + loop.length - 1) % loop.length] : i === 0 || v !== loop[i - 1]));
  for (let changed = true; changed && cycle.length > 3; ) {
    changed = false;
    for (let i = cyclic ? 0 : 1; i < cycle.length - (cyclic ? 0 : 1) && cycle.length > 3; i++) {
      const before = cycle[(i + cycle.length - 1) % cycle.length]!,
        after = cycle[(i + 1) % cycle.length]!;
      if (before !== after) continue;
      // Drop the spike's tip and one copy of where it starts.
      cycle.splice(i, 1);
      cycle.splice(i % cycle.length, 1);
      changed = true;
    }
  }
  return cycle;
}

/** The faces' vertex cycles as shared edges, with each arc chain one edge between its corners. */
function withEdges(
  drafts: { surface: BrepFace['surface']; loops: number[][] }[],
  chains: { vertices: number[]; circle: Circle; z: number }[],
  points: Vec3[]
): Brep {
  // A chain's inner vertices must belong to it alone: where another edge meets one, the chain is split there.
  const neighbours = new Map<number, Set<number>>();
  for (const { loops } of drafts)
    for (const loop of loops)
      loop.forEach((a, n) => {
        const b = loop[(n + 1) % loop.length]!;
        for (const [u, v] of [
          [a, b],
          [b, a],
        ] as const)
          (neighbours.get(u) ?? neighbours.set(u, new Set()).get(u)!).add(v);
      });
  const edges: BrepEdge[] = [],
    keyed = new Map<string, number>(),
    /** For a directed step between vertices that's part of an arc edge: that edge, and how many steps it spans. */
    arcSteps = new Map<string, { edge: number; forward: boolean; first: number; last: number; steps: number }>();
  for (const chain of chains) {
    const c = chain.circle,
      pieces: number[][] = [];
    let current: number[] | null = null;
    chain.vertices.forEach((v, i) => {
      // A vertex another face's boundary put on the chord is off the circle: the steps either side of it stay straight.
      if (Math.abs(Math.hypot(points[v]![0] - c.x, points[v]![1] - c.y) - c.r) > ON_CIRCLE) return void (current = null);
      if (!current) pieces.push((current = []));
      current.push(v);
      if (i > 0 && i < chain.vertices.length - 1 && (neighbours.get(v)?.size ?? 0) > 2) pieces.push((current = [v]));
    });
    for (const piece of pieces) {
      if (piece.length < 2) continue;
      const first = piece[0]!,
        last = piece.at(-1)!;
      const key = `arc:${[...piece].sort((a, b) => a - b).join(',')}`;
      if (keyed.has(key)) continue;
      const a = points[first]!,
        b = points[piece[1]!]!;
      const ccw = (a[0] - c.x) * (b[1] - c.y) - (a[1] - c.y) * (b[0] - c.x) > 0;
      const edge = edges.push({ start: first, end: last, circle: { ...c, z: chain.z, ccw } }) - 1;
      keyed.set(key, edge);
      piece.slice(0, -1).forEach((u, i) => {
        const v = piece[i + 1]!;
        const steps = piece.length - 1;
        arcSteps.set(`${u},${v}`, { edge, forward: true, first, last, steps });
        arcSteps.set(`${v},${u}`, { edge, forward: false, first: last, last: first, steps });
      });
    }
  }
  const line = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let edge = keyed.get(key);
    if (edge === undefined) keyed.set(key, (edge = edges.push({ start: Math.min(a, b), end: Math.max(a, b) }) - 1));
    return { edge, forward: edges[edge]!.start === a };
  };
  // Vertices inside an arc edge, where a loop's walk can't start.
  const inner = new Set<number>();
  for (const [step, arc] of arcSteps) {
    const u = Number(step.split(',')[0]);
    if (u !== arc.first) inner.add(u);
  }
  let partial = 0;
  const faces: BrepFace[] = drafts.map(({ surface, loops }) => ({
    surface,
    loops: loops.map(loop => {
      const start = loop.findIndex(v => !inner.has(v));
      const cycle = start > 0 ? [...loop.slice(start), ...loop.slice(0, start)] : loop;
      const used: { edge: number; forward: boolean }[] = [];
      // Each step is its own straight edge, or one step of an arc edge: consecutive steps of one arc are that edge once.
      let along = 0;
      cycle.forEach((u, n) => {
        const v = cycle[(n + 1) % cycle.length]!,
          arc = arcSteps.get(`${u},${v}`);
        const step = arc ? { edge: arc.edge, forward: arc.forward } : line(u, v);
        const last = used.at(-1);
        if (arc && u !== arc.first && last?.edge === step.edge && last.forward === step.forward) along++;
        else {
          used.push(step);
          along = 1;
        }
        // A loop that leaves an arc part way along can't use that edge.
        if (arc && v === arc.last && along !== arc.steps) partial++;
      });
      return used;
    }),
  }));
  // Where two pieces of material touch along one line, four faces meet at its edge. Each pair facing each other gets an
  // edge of its own, so the shell stays one where every edge has two faces.
  const uses = new Map<number, { forward: { edge: number; forward: boolean }[]; backward: { edge: number; forward: boolean }[] }>();
  for (const face of faces)
    for (const loop of face.loops)
      for (const use of loop) {
        const entry = uses.get(use.edge) ?? uses.set(use.edge, { forward: [], backward: [] }).get(use.edge)!;
        entry[use.forward ? 'forward' : 'backward'].push(use);
      }
  for (const [edge, { forward, backward }] of uses)
    for (let pair = 1; pair < Math.min(forward.length, backward.length); pair++) {
      const copy = edges.push({ ...edges[edge]! }) - 1;
      forward[pair]!.edge = backward[pair]!.edge = copy;
    }
  return { points, edges, faces, ...(partial && { partialArcs: partial }) };
}

/** Checks the shell is closed: every edge used twice, once each way. */
export function brepProblems(brep: Brep): string[] {
  const uses = brep.edges.map(() => ({ forward: 0, backward: 0 }));
  for (const face of brep.faces)
    for (const loop of face.loops) for (const { edge, forward } of loop) uses[edge]![forward ? 'forward' : 'backward']++;
  return [
    ...uses.flatMap((use, edge) =>
      use.forward === 1 && use.backward === 1 ? [] : [`edge ${edge} used ${use.forward}+${use.backward} times`]
    ),
    ...(brep.partialArcs ? [`${brep.partialArcs} arc edges used part way`] : []),
  ];
}
