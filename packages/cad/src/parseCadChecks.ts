import type { CadDirection, CadPlacement } from './types';

// The field checks shared by the parts of parseCadDocument: each throws the error a malformed document is refused with.

export function number(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('CAD numeric fields must be finite numbers');
}
export function reference(value: unknown) {
  if (typeof value !== 'string' || !value) throw new Error('CAD references must be nonempty strings');
}
export function checkPlacement(placement: CadPlacement) {
  const { position, rotation, positionExpressions } = placement ?? ({} as CadPlacement);
  if (!Array.isArray(position) || position.length !== 3 || !Array.isArray(rotation) || rotation.length !== 4)
    throw new Error('Invalid CAD placement');
  [...position, ...rotation].forEach(number);
  if (Math.abs(Math.hypot(...rotation) - 1) > 1e-6) throw new Error('Invalid CAD placement');
  if (
    positionExpressions !== undefined &&
    (!Array.isArray(positionExpressions) ||
      positionExpressions.length !== 3 ||
      positionExpressions.some(e => e !== null && typeof e !== 'string'))
  )
    throw new Error('Invalid CAD placement');
}
export function checkDirection(direction: CadDirection) {
  const { along, flip } = direction ?? ({} as CadDirection);
  const face = along && typeof along === 'object' && 'face' in along ? along.face : undefined;
  if (
    !along ||
    typeof along !== 'object' ||
    ('plane' in along
      ? !['top', 'front', 'right'].includes(along.plane)
      : typeof along.partId !== 'string' ||
        !(face === 'top' || face === 'underside' || (face && typeof face === 'object' && typeof face.edge === 'string'))) ||
    (flip !== undefined && typeof flip !== 'boolean')
  )
    throw new Error('Invalid CAD direction');
}
export function checkVector(vector: unknown) {
  if (!Array.isArray(vector) || vector.length !== 3) throw new Error('Invalid CAD transform vector');
  // Iteration visits sparse slots too; a missing component is not a finite coordinate.
  for (const value of vector) number(value);
}
