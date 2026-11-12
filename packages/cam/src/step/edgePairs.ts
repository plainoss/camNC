import type { Vec3 } from '../geom';
import type { BrepEdge, BrepFace } from './brep';

type Use = { edge: number; forward: boolean };
/** Radians within which faces leave an edge at the same angle: a hole's wall drawn tangent to another's, as rounded. */
const SAME_ANGLE = 1e-3;
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** A point inside the edge and its direction there, from its start to its end. */
function edgeFrame(edge: BrepEdge, points: readonly Vec3[]): { at: Vec3; along: Vec3 } {
  const a = points[edge.start]!,
    b = points[edge.end]!;
  if (!edge.circle)
    return { at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], along: unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) };
  const { x, y, r, z, ccw } = edge.circle;
  const from = Math.atan2(a[1] - y, a[0] - x);
  let to = Math.atan2(b[1] - y, b[0] - x);
  if (ccw) while (to <= from) to += 2 * Math.PI;
  else while (to >= from) to -= 2 * Math.PI;
  const middle = (from + to) / 2,
    turn = ccw ? 1 : -1;
  return { at: [x + r * Math.cos(middle), y + r * Math.sin(middle), z], along: [-Math.sin(middle) * turn, Math.cos(middle) * turn, 0] };
}

function outward(surface: BrepFace['surface'], at: Vec3): Vec3 {
  if (surface.kind === 'plane') return unit(surface.normal);
  const radial = unit([at[0] - surface.circle.x, at[1] - surface.circle.y, 0]);
  return surface.outward ? radial : [-radial[0], -radial[1], 0];
}

/**
 * Where two pieces of material touch along one line, four (or more) faces meet at its edge, and each face pairs with the
 * neighbour it shares material with. Going around the edge, a face that uses it backward has its material turning
 * counterclockwise (about the edge's direction) and one that uses it forward clockwise, so each backward use pairs with
 * the next use counterclockwise. Each pair after the first gets an edge of its own, so every edge has two faces.
 */
export function pairEdgeUses(edges: BrepEdge[], faces: readonly BrepFace[], points: readonly Vec3[]) {
  const uses = new Map<number, { use: Use; surface: BrepFace['surface'] }[]>();
  for (const face of faces)
    for (const loop of face.loops)
      for (const use of loop) (uses.get(use.edge) ?? uses.set(use.edge, []).get(use.edge)!).push({ use, surface: face.surface });
  for (const [edge, all] of uses) {
    if (all.length <= 2) continue;
    const pairs = byAngle(edges[edge]!, all, points) ?? byOrder(all.map(({ use }) => use));
    pairs.slice(1).forEach(([backward, forward]) => {
      const copy = edges.push({ ...edges[edge]! }) - 1;
      backward.edge = forward.edge = copy;
    });
  }
}

function byAngle(edge: BrepEdge, all: { use: Use; surface: BrepFace['surface'] }[], points: readonly Vec3[]): [Use, Use][] | null {
  const { at, along } = edgeFrame(edge, points);
  // Directions square to the edge, measured counterclockwise about it.
  const across = unit(cross(along, Math.abs(along[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])),
    up = cross(along, across);
  const around = all
    .map(({ use, surface }) => {
      // Into the face from the edge: its loops run counterclockwise seen from outside, so the face lies to their left.
      const into = cross(outward(surface, at), use.forward ? along : ([-along[0], -along[1], -along[2]] as Vec3));
      return { use, angle: Math.atan2(dot(into, up), dot(into, across)) };
    })
    .sort((a, b) => a.angle - b.angle);
  // Faces that leave the edge at the same angle, as where a hole's wall touches another wall, pair either way round:
  // a sliver of material between them or a gap. Their order is the one that alternates.
  const groups: (typeof around)[] = [];
  for (const entry of around) {
    const last = groups.at(-1);
    if (last && entry.angle - last.at(-1)!.angle < SAME_ANGLE) last.push(entry);
    else groups.push([entry]);
  }
  for (const backwardFirst of [true, false]) {
    const order = groups.flatMap(group =>
      [...group].sort((a, b) => (Number(a.use.forward) - Number(b.use.forward)) * (backwardFirst ? 1 : -1)).map(({ use }) => use)
    );
    const pairs = alternating(order);
    if (pairs) return pairs;
  }
  return null;
}

/** Each backward use with the next use around the edge, when they alternate backward and forward. */
function alternating(order: Use[]): [Use, Use][] | null {
  const pairs: [Use, Use][] = [];
  for (let i = 0; i < order.length; i++) {
    const use = order[i]!;
    if (use.forward) continue;
    const next = order[(i + 1) % order.length]!;
    if (!next.forward) return null;
    pairs.push([use, next]);
  }
  return pairs.length * 2 === order.length ? pairs : null;
}

/** The uses paired in the order the faces came, for an edge whose faces don't alternate around it. */
function byOrder(all: Use[]): [Use, Use][] {
  const forward = all.filter(use => use.forward),
    backward = all.filter(use => !use.forward);
  return backward.slice(0, forward.length).map((use, i) => [use, forward[i]!]);
}
