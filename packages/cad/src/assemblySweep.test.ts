import { expect, it } from 'vitest';
import { addRectangle, assemblySweepCollisions, createCadPart, evaluateCadPart, type CadAssemblyPiece, type CadPlacement } from './index';

const at = (x: number, y: number, z: number): CadPlacement => ({ position: [x, y, z], rotation: [0, 0, 0, 1] });
function piece(name: string, rects: [number, number, number, number][], thickness: number, placement: CadPlacement): CadAssemblyPiece {
  const part = createCadPart(name, thickness);
  for (const [x, y, width, height] of rects)
    part.sketch = addRectangle(part.sketch, { x, y, width, height, dimensioned: true, positioned: true });
  return { id: name, name, part: evaluateCadPart(part).part!, placement };
}

// A 100 × 100 × 18 plate with a 20 × 20 through hole at its centre, and a 20 × 20 × 40 peg standing in the hole.
const plate = piece(
  'Plate',
  [
    [0, 0, 100, 100],
    [40, 40, 20, 20],
  ],
  18,
  at(0, 0, 0)
);
const peg = piece('Peg', [[40, 40, 20, 20]], 40, at(0, 0, -11));

it('lets a peg slide into its hole along the hole, from either end', () => {
  expect(assemblySweepCollisions([peg], [plate], 2, 1)).toEqual([]);
  expect(assemblySweepCollisions([peg], [plate], 2, -1)).toEqual([]);
});

it('refuses a peg pushed sideways through the plate, and says how far out it meets it', () => {
  const [hit] = assemblySweepCollisions([peg], [plate], 0, 1);
  expect(hit).toMatchObject({ moving: 'Peg', fixed: 'Plate' });
  // It meets the hole's far wall as soon as it leaves its place.
  expect(hit!.offset).toBeLessThan(0.01);
  expect(hit!.volume).toBeGreaterThan(1);
});

it('finds a thin wall the peg would have to pass, however far back it starts', () => {
  // A 1 mm web across the hole, 5 mm below the plate's top: the peg can only come in from below.
  const web = piece('Web', [[40, 40, 20, 20]], 1, at(0, 0, 12));
  expect(assemblySweepCollisions([piece('Short peg', [[40, 40, 20, 20]], 11, at(0, 0, -10))], [plate, web], 2, 1)).toEqual([]);
  const [hit] = assemblySweepCollisions([piece('Short peg', [[40, 40, 20, 20]], 11, at(0, 0, -10))], [plate, web], 2, -1);
  expect(hit).toMatchObject({ fixed: 'Web' });
});
