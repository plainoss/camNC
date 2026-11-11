import type { CadPlaceOptions, Len } from './editTypes';

/** Moves a pattern's placements to an assembly origin in mm, keeping their expressions editable. */
export function placedFrom(origin: readonly [number, number, number] = [0, 0, 0]) {
  if (!origin.every(Number.isFinite)) throw new TypeError('A pattern origin needs three finite millimetre values.');
  return <T extends CadPlaceOptions>(options: T): T => ({
    ...options,
    at: options.at.map((value: Len, i) => (origin[i] ? `(${typeof value === 'number' ? `${value}mm` : value}) + ${origin[i]}mm` : value)),
  });
}
