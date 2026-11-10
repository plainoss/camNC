import { intersectPaths, unionPaths, type PartFeatures } from '@wbcnc/cam';
import { ShapeUtils, Vector2 } from 'three';

type Path = { x: number; y: number }[];
const signedArea = (path: Path) =>
  path.reduce((sum, p, i) => sum + p.x * path[(i + 1) % path.length]!.y - path[(i + 1) % path.length]!.x * p.y, 0) / 2;
function contains(path: Path, point: { x: number; y: number }) {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const a = path[i]!,
      b = path[j]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Clipper's paths as outer loops with the holes inside each. */
function shapes(region: Path[]) {
  const outers = region.filter(path => signedArea(path) > 0).sort((a, b) => signedArea(a) - signedArea(b)),
    groups = outers.map(outer => ({ outer, holes: [] as Path[] }));
  for (const hole of region.filter(path => signedArea(path) < 0)) groups.find(group => contains(group.outer, hole[0]!))?.holes.push(hole);
  return groups;
}

/**
 * A watertight solid for a part with cuts, without the hidden faces stacked slabs would leave: one cap per height, the
 * bottom, and walls between heights. Each horizontal face is exactly a level, so `extractFeatures` reads it back.
 */
export function cutPartMesh(features: PartFeatures, underside?: PartFeatures): { positions: Float64Array; indices: Uint32Array } {
  const positions: number[] = [];
  const triangle = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) =>
    positions.push(...a, ...b, ...c);
  const cap = (region: Path[], z: number, up: boolean) => {
    // Match the walls' Clipper precision, including the original footprint whose curve vertices can have more digits.
    for (const { outer, holes } of shapes(unionPaths(region))) {
      const contour = outer.map(p => new Vector2(p.x, p.y)),
        rings = holes.map(hole => hole.map(p => new Vector2(p.x, p.y))),
        all = [...contour, ...rings.flat()];
      for (const [i, j, k] of ShapeUtils.triangulateShape(contour, rings)) {
        const a = all[i!]!,
          b = all[j!]!,
          c = all[k!]!,
          counterclockwise = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0,
          [p, q] = counterclockwise === up ? [b, c] : [c, b];
        triangle([a.x, a.y, z], [p.x, p.y, z], [q.x, q.y, z]);
      }
    }
  };
  const levels = [...(features.meshLevels ?? features.levels)].sort((a, b) => b.z - a.z);
  for (const level of levels) cap(level.region, level.z, true);
  // The underside is the same stack seen from the other face, with its heights turned over.
  const below = [...(underside?.meshLevels ?? underside?.levels ?? [])].sort((a, b) => b.z - a.z),
    thickness = features.thickness;
  if (below.length) for (const level of below) cap(level.region, thickness - level.z, false);
  else cap(features.footprint, 0, false);
  // Opposite-face pockets can overlap in depth without meeting in XY. Splicing the two stacks at the deepest
  // underside floor then creates inverted/overlapping walls. Partition at every floor and keep only material
  // present in both stacks, so each interval has one outward boundary even when their depths overlap.
  const heights = [...new Set([0, ...levels.map(level => level.z), ...below.map(level => thickness - level.z)])].sort((a, b) => a - b);
  heights.slice(0, -1).forEach((low, i) => {
    const high = heights[i + 1]!,
      middle = (low + high) / 2,
      above = unionPaths(levels.filter(level => level.z > middle).flatMap(level => level.region)),
      region = below.length
        ? intersectPaths(above, unionPaths(below.filter(level => level.z > thickness - middle).flatMap(level => level.region)))
        : above;
    // Paths run with the material on their left, so each wall faces outward.
    for (const path of region)
      path.forEach((p, n) => {
        const q = path[(n + 1) % path.length]!;
        triangle([p.x, p.y, low], [q.x, q.y, low], [q.x, q.y, high]);
        triangle([p.x, p.y, low], [q.x, q.y, high], [p.x, p.y, high]);
      });
  });
  return { positions: Float64Array.from(positions), indices: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) };
}
