import type { CadDimension, CadPoint } from '@wbcnc/cad';

/** How far up and right of the pointer, in screen pixels, a one-curve dimension's label follows it. */
const BESIDE_POINTER = 22;

/**
 * Where a dimension being placed shows its label: at the pointer, or beside it while one curve's size is shown, so the
 * label never hides the edge of a second curve the pointer is about to pick.
 */
export function draftLabelAt(constraint: CadDimension, pointer: CadPoint, pixelScale: number): CadPoint {
  if (constraint.type !== 'diameter' && constraint.type !== 'radius') return pointer;
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  return { x: pointer.x + BESIDE_POINTER / scale, y: pointer.y + BESIDE_POINTER / scale };
}
