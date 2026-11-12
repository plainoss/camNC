import type { Vec3 } from '../geom';
import type { Brep, BrepEdge } from './brep';
import { withUsedPoints } from './walls';

/** Below this, in mm³, a shell is a sliver of no width: two walls back to back where cut boundaries coincide. */
const NO_VOLUME = 1e-3;

/**
 * The B-rep as one closed shell per piece of material: faces joined through the edges they share. A piece a cut
 * separates from the rest, or one that only touches it along an edge, is a solid of its own, which a reader takes for a
 * void when it's written into the same shell. Shells with no volume are left out.
 */
export function brepShells(brep: Brep): Brep[] {
  const parent = brep.faces.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const owner = new Map<number, number>();
  brep.faces.forEach((face, f) => {
    for (const { edge } of face.loops.flat()) {
      const other = owner.get(edge);
      if (other === undefined) owner.set(edge, f);
      else parent[root(other)] = root(f);
    }
  });
  const groups = new Map<number, number[]>();
  brep.faces.forEach((_, f) => (groups.get(root(f)) ?? groups.set(root(f), []).get(root(f))!).push(f));
  if (groups.size === 1) return Math.abs(shellVolume(brep)) > NO_VOLUME ? [brep] : [];
  return [...groups.values()].flatMap(group => {
    // Only the shell's own edges, numbered in their old order.
    const used = [...new Set(group.flatMap(f => brep.faces[f]!.loops.flat().map(({ edge }) => edge)))].sort((a, b) => a - b),
      at = new Map(used.map((edge, i) => [edge, i]));
    const shell = withUsedPoints({
      points: brep.points,
      edges: used.map(edge => brep.edges[edge]!),
      faces: group.map(f => {
        const face = brep.faces[f]!;
        return { ...face, loops: face.loops.map(loop => loop.map(use => ({ ...use, edge: at.get(use.edge)! }))) };
      }),
    });
    return Math.abs(shellVolume(shell)) > NO_VOLUME ? [shell] : [];
  });
}

/** Points along an edge from its start, without its end: arcs in short steps. */
function edgePoints(edge: BrepEdge, points: readonly Vec3[]): Vec3[] {
  const a = points[edge.start]!;
  if (!edge.circle) return [a];
  const b = points[edge.end]!,
    { x, y, r, z, ccw } = edge.circle;
  const from = Math.atan2(a[1] - y, a[0] - x);
  let to = Math.atan2(b[1] - y, b[0] - x);
  if (ccw) while (to <= from) to += 2 * Math.PI;
  else while (to >= from) to -= 2 * Math.PI;
  const steps = 16;
  return Array.from({ length: steps }, (_, i) => {
    const angle = from + ((to - from) * i) / steps;
    return [x + r * Math.cos(angle), y + r * Math.sin(angle), z] as Vec3;
  });
}

/**
 * The volume a shell encloses, positive when it faces outward. Its walls are vertical, so only its flat tops and
 * bottoms count: each one's height times its area as seen from above (arcs as short chords), counterclockwise seen
 * from outside being negative for a bottom.
 */
export function shellVolume(brep: Brep): number {
  let volume = 0;
  for (const face of brep.faces) {
    const { surface } = face;
    if (surface.kind !== 'plane' || Math.abs(surface.normal[2]) < 0.5) continue;
    for (const loop of face.loops) {
      const ring = loop.flatMap(({ edge, forward }) => {
        const along = edgePoints(brep.edges[edge]!, brep.points);
        // Backward, the walk starts at the edge's end and takes its points in reverse.
        return forward ? along : [brep.points[brep.edges[edge]!.end]!, ...along.slice(1).reverse()];
      });
      const area = ring.reduce((sum, p, i) => sum + p[0] * ring[(i + 1) % ring.length]![1] - ring[(i + 1) % ring.length]![0] * p[1], 0) / 2;
      volume += surface.origin[2] * area;
    }
  }
  return volume;
}
