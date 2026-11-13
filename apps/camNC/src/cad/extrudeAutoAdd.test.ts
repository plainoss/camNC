import {
  addRectangle,
  CAD_CHORD_TOLERANCE,
  createCadDocument,
  createCadPart,
  sketchRegions,
  type CadDocument,
  type CadPart,
} from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { autoAddTarget } from './extrudeAutoAdd';

const board = (name: string, x: number, y: number, width: number, height: number, thickness: number): CadPart => {
  const part = { ...createCadPart(name, thickness), drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  part.sketch = addRectangle(part.sketch, { x, y, width, height });
  return { ...part, regions: sketchRegions(part.sketch, CAD_CHORD_TOLERANCE).map(region => region.id) };
};

it('switches a New extrude to Add with the part its picked region runs into, and not one it only touches', () => {
  const first = board('Part 1', 0, 0, 100, 40, 10);
  const design = (second: CadPart): CadDocument => ({ ...createCadDocument(), parts: [first, second] });
  const across = board('Part 2', 0, 0, 40, 80, 30);
  expect(autoAddTarget(design(across), across.id)).toBe(first.id);
  const beside = board('Part 2', 100, 0, 40, 40, 10);
  expect(autoAddTarget(design(beside), beside.id)).toBeNull();
  const above = { ...board('Part 2', 0, 0, 40, 40, 10), drawnOn: { on: { plane: 'top' as const }, offset: 10 } };
  expect(autoAddTarget(design(above), above.id)).toBeNull();
  // Nothing picked, or chosen already, it stays as it is.
  const unpicked = { ...board('Part 2', 0, 0, 40, 80, 30), regions: [] };
  expect(autoAddTarget(design(unpicked), unpicked.id)).toBeNull();
});
