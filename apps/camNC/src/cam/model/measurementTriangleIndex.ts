import type { MeasureTriangle, MeasureVec3 } from '@/cad/measureGeometry';

interface Bounds {
  low: MeasureVec3;
  high: MeasureVec3;
}
type Node = Bounds & ({ indices: number[] } | { left: Node; right: Node });

function intersects(bounds: Bounds, a: MeasureVec3, b: MeasureVec3, tolerance: number) {
  let low = 0,
    high = 1;
  for (let axis = 0; axis < 3; axis++) {
    const origin = a[axis]!,
      direction = b[axis]! - origin;
    const min = bounds.low[axis]! - tolerance,
      max = bounds.high[axis]! + tolerance;
    if (!direction) {
      if (origin < min || origin > max) return false;
    } else {
      const first = (min - origin) / direction,
        second = (max - origin) / direction;
      low = Math.max(low, Math.min(first, second));
      high = Math.min(high, Math.max(first, second));
      if (low > high) return false;
    }
  }
  return true;
}

/** A broad phase only: callers still require an overlapping finite edge, not a box or corner contact. */
export function measurementTriangleIndex(triangles: readonly (Bounds | null)[]) {
  const build = (indices: number[]): Node => {
    const low: MeasureVec3 = [Infinity, Infinity, Infinity],
      high: MeasureVec3 = [-Infinity, -Infinity, -Infinity];
    for (const index of indices) {
      const triangle = triangles[index]!;
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(low[axis]!, triangle.low[axis]!);
        high[axis] = Math.max(high[axis]!, triangle.high[axis]!);
      }
    }
    if (indices.length <= 8) return { low, high, indices };
    const widths = high.map((value, axis) => value - low[axis]!),
      axis = widths.indexOf(Math.max(...widths));
    indices.sort((a, b) => {
      const first = triangles[a]!,
        second = triangles[b]!;
      return first.low[axis]! + first.high[axis]! - (second.low[axis]! + second.high[axis]!) || a - b;
    });
    const middle = Math.floor(indices.length / 2);
    return { low, high, left: build(indices.slice(0, middle)), right: build(indices.slice(middle)) };
  };
  const indices = triangles.flatMap((triangle, index) => (triangle ? [index] : []));
  const root = indices.length ? build(indices) : null;
  return (points: MeasureTriangle, tolerance: number): number[] => {
    const result = new Set<number>();
    const visit = (node: Node, a: MeasureVec3, b: MeasureVec3) => {
      if (!intersects(node, a, b, tolerance)) return;
      if ('indices' in node) {
        for (const index of node.indices) if (intersects(triangles[index]!, a, b, tolerance)) result.add(index);
      } else {
        visit(node.left, a, b);
        visit(node.right, a, b);
      }
    };
    // Shared spans lie along a boundary edge. Querying the whole triangle box would visit unrelated interior
    // pin-pocket triangles, especially when a large face contains many small holes.
    if (root) for (let edge = 0; edge < 3; edge++) visit(root, points[edge]!, points[(edge + 1) % 3]!);
    return [...result];
  };
}
