import { addRectangle, createCadDocument, createCadPart, resolveDrawnPlacements, type CadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { assemblyModel } from './assemblyModel';

const zRange = (positions: Float32Array) => {
  let low = Infinity,
    high = -Infinity;
  for (let i = 2; i < positions.length; i += 3) {
    low = Math.min(low, positions[i]!);
    high = Math.max(high, positions[i]!);
  }
  return [low, high].map(value => Math.round(value * 1000) / 1000);
};

it('shows a part drawn on another’s top sitting on that top, even when the other’s thickness changed since it was placed', () => {
  const base = { ...createCadPart('Part 1', 18), drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  base.sketch = addRectangle(base.sketch, { x: 0, y: 0, width: 100, height: 50 });
  const lid = { ...createCadPart('Part 2', 3), drawnOn: { on: { partId: base.id, face: 'top' as const }, offset: 0 } };
  lid.sketch = addRectangle(lid.sketch, { x: 10, y: 10, width: 30, height: 20 });
  const placed = resolveDrawnPlacements({ ...createCadDocument(), parts: [base, lid] }).document;
  // The base made thinner in its Extrude dialog, with nothing solved since.
  const thinner: CadDocument = { ...placed, parts: placed.parts.map(part => (part.id === base.id ? { ...part, thickness: 10 } : part)) };
  const model = assemblyModel(thinner);
  expect(zRange(model.meshes[0]!.positions)).toEqual([0, 10]);
  expect(zRange(model.meshes[1]!.positions)).toEqual([10, 13]);
});
