/**
 * Test helpers: the material a part's B-rep is built from, and a check of how the faces at shared edges are paired that
 * goes back to that material rather than to the B-rep's own angles.
 */
import type { PartFeatures } from '../features';
import { intersect, union, type Pt, type Vec3 } from '../geom';
import type { Brep, BrepFace } from './brep';

export interface Slab {
  low: number;
  high: number;
  region: Pt[][];
}

/** The part's material between each two heights, as `partBrep` and CAM build it. */
export function partSlabs(features: PartFeatures, underside?: PartFeatures | null): Slab[] {
  const thickness = features.thickness,
    levels = [...(features.meshLevels ?? features.levels)],
    below = [...(underside?.meshLevels ?? underside?.levels ?? [])];
  const heights = [...new Set([0, ...levels.map(l => l.z), ...below.map(l => thickness - l.z)])].sort((a, b) => a - b);
  return heights.slice(0, -1).map((low, i) => {
    const high = heights[i + 1]!,
      middle = (low + high) / 2;
    const above = union(levels.filter(l => l.z > middle).flatMap(l => l.region));
    const region = below.length ? intersect(above, union(below.filter(l => l.z > thickness - middle).flatMap(l => l.region))) : above;
    return { low, high, region };
  });
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
function inside(region: Pt[][], p: Pt) {
  let n = false;
  for (const path of region)
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
      const a = path[i]!,
        b = path[j]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) n = !n;
    }
  return n;
}

/**
 * Edges that share their ends with another edge, where several faces meet at one line, whose two faces don't hold
 * material between them: sampled just off the edge, halfway around from one face to the other on its material side.
 */
export function wrongPairs(brep: Brep, slabs: readonly Slab[]): string[] {
  const key = (e: Brep['edges'][number]) => `${e.start},${e.end},${e.circle ? `${e.circle.x},${e.circle.y},${e.circle.ccw}` : ''}`;
  const count = new Map<string, number>();
  for (const e of brep.edges) count.set(key(e), (count.get(key(e)) ?? 0) + 1);
  const uses = new Map<number, { face: BrepFace; forward: boolean }[]>();
  for (const face of brep.faces)
    for (const { edge, forward } of face.loops.flat()) uses.set(edge, [...(uses.get(edge) ?? []), { face, forward }]);
  const material = (p: Vec3) => {
    const slab = slabs.find(s => s.low < p[2] && p[2] < s.high);
    return !!slab && inside(slab.region, { x: p[0], y: p[1] });
  };
  const wrong: string[] = [];
  brep.edges.forEach((edge, e) => {
    if ((count.get(key(edge)) ?? 0) < 2) return;
    const a = brep.points[edge.start]!,
      b = brep.points[edge.end]!;
    let at: Vec3, t: Vec3;
    if (edge.circle) {
      const { x, y, r, z, ccw } = edge.circle;
      const from = Math.atan2(a[1] - y, a[0] - x);
      let to = Math.atan2(b[1] - y, b[0] - x);
      if (ccw) while (to <= from) to += 2 * Math.PI;
      else while (to >= from) to -= 2 * Math.PI;
      const m = (from + to) / 2;
      at = [x + r * Math.cos(m), y + r * Math.sin(m), z];
      t = ccw ? [-Math.sin(m), Math.cos(m), 0] : [Math.sin(m), -Math.cos(m), 0];
    } else {
      at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      t = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    }
    const sides = (uses.get(e) ?? []).map(({ face, forward }) => {
      const s = face.surface;
      let n: Vec3;
      if (s.kind === 'plane') n = unit(s.normal);
      else {
        const radial = unit([at[0] - s.circle.x, at[1] - s.circle.y, 0]);
        n = s.outward ? radial : [-radial[0], -radial[1], 0];
      }
      // Into the face, square to the edge.
      return { into: unit(cross(n, forward ? t : [-t[0], -t[1], -t[2]])), n };
    });
    if (sides.length !== 2) return void wrong.push(`edge ${e} has ${sides.length} uses`);
    const [first, second] = sides as [(typeof sides)[0], (typeof sides)[0]];
    const u = first.into,
      v = cross(t, u);
    // Turning from the first face toward where its material is, to the second face.
    const towardMaterial = dot(v, first.n) < 0;
    let span = Math.atan2(dot(second.into, v), dot(second.into, u));
    if (towardMaterial && span <= 0) span += 2 * Math.PI;
    if (!towardMaterial && span >= 0) span -= 2 * Math.PI;
    const dir = [0, 1, 2].map(k => u[k]! * Math.cos(span / 2) + v[k]! * Math.sin(span / 2));
    if (!material([at[0] + dir[0]! * 1e-3, at[1] + dir[1]! * 1e-3, at[2] + dir[2]! * 1e-3]))
      wrong.push(`edge ${e} at ${at.map(c => c.toFixed(2)).join(',')}: no material between its faces`);
  });
  return wrong;
}
