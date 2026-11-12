import type { Vec3 } from '../geom';
import type { Brep, BrepEdge } from './brep';
import { withUsedPoints } from './walls';

/** Below this, in mm³, a shell is a sliver of no width: two walls back to back where cut boundaries coincide. */
const NO_VOLUME = 1e-3;

/**
 * The B-rep as one closed shell per piece of material: faces joined through the edges they share. A piece a cut
 * separates from the rest, or one that only touches it along an edge, is a solid of its own, which a reader takes for a
 * void when it's written into the same shell. Shells with no volume are left out, unless that would leave nothing: then
 * the B-rep is written as it is, so a part is never listed with no solid.
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
  if (groups.size === 1) return [brep];
  const shells = [...groups.values()].flatMap(group => {
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
  return shells.length ? shells : [brep];
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
 * The volume a shell encloses, positive when it faces outward, by the divergence theorem with the field (0, 0, z): the
 * sum over its faces of z times their area as seen from above, signed by the way they face. A plane in any direction
 * counts, from its loops as polygons (arcs as short chords), whose fans of triangles are exact for a plane. A cylinder
 * is vertical (`BrepFace`), so it faces sideways everywhere and adds nothing.
 */
export function shellVolume(brep: Brep): number {
  let volume = 0;
  for (const face of brep.faces) {
    if (face.surface.kind !== 'plane') continue;
    for (const loop of face.loops) {
      const ring = loop.flatMap(({ edge, forward }) => {
        const along = edgePoints(brep.edges[edge]!, brep.points);
        // Backward, the walk starts at the edge's end and takes its points in reverse.
        return forward ? along : [brep.points[brep.edges[edge]!.end]!, ...along.slice(1).reverse()];
      });
      const o = ring[0]!;
      for (let i = 1; i + 1 < ring.length; i++) {
        const b = ring[i]!,
          c = ring[i + 1]!;
        // z is linear over the triangle, so its mean times the area seen from above is exact.
        const area = ((b[0] - o[0]) * (c[1] - o[1]) - (c[0] - o[0]) * (b[1] - o[1])) / 2;
        volume += (area * (o[2] + b[2] + c[2])) / 3;
      }
    }
  }
  return volume;
}
