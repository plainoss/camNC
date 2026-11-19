import { addRectangle, createCadPart, sketchRegions } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { densityText, findMaterials, kMaterialLibrary, partCenterOfMass, partMass } from './materialLibrary';

it('finds materials by name or category, ignoring case, and none for a name it hasn’t got', () => {
  expect(findMaterials('')).toBe(kMaterialLibrary);
  expect(findMaterials('plywood')).toEqual([]);
  expect(findMaterials('oak').map(material => [material.name, densityText(material.density)])).toEqual([
    ['Oak, Red', '7.700e+2'],
    ['Oak, White', '7.700e+2'],
  ]);
  expect(findMaterials('METAL').every(material => material.category === 'Metal')).toBe(true);
  expect(densityText(0)).toBe('0.000e+0');
});

it('weighs a part by its material: a 100 × 60 × 40 oak board is 0.1848 kg', () => {
  const part = { ...createCadPart('Part 1', 40), drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 60 });
  const board = { ...part, regions: sketchRegions(part.sketch).map(region => region.id) };
  expect(partMass(board)).toBeNull();
  expect(partMass({ ...board, material: { name: 'Oak, White', density: 770 } })).toBeCloseTo(0.1848, 6);
  // Its center is the middle of the board, halfway up.
  expect(partCenterOfMass(board)).toBeNull();
  const center = partCenterOfMass({ ...board, material: { name: 'Oak, White', density: 770 } })!;
  expect(center.map(value => +value.toFixed(6))).toEqual([50, 30, 20]);
});
