import type { CadCutDepth } from '@wbcnc/cad';

type Vector = { x: number; y: number; z: number };

/** Where a view ray passes closest to a vertical line. Null when looking along the line, where height can't be read. */
export function heightOnAxis(origin: Vector, direction: Vector, axis: { x: number; y: number }): number | null {
  const denominator = 1 - direction.z * direction.z;
  if (denominator < 1e-4) return null;
  const wx = origin.x - axis.x,
    wy = origin.y - axis.y,
    along = direction.x * wx + direction.y * wy + direction.z * origin.z;
  return (origin.z - direction.z * along) / denominator;
}

/** The depth a drag arrives at, in half millimetres. All the way down is a through cut. */
export function draggedDepth(start: CadCutDepth, raisedBy: number, thickness: number): CadCutDepth {
  const from = start === 'through' ? thickness : start,
    depth = Math.round((from - raisedBy) * 2) / 2;
  return depth >= thickness ? 'through' : Math.max(0, depth);
}
