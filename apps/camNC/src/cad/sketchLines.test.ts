import { addLine, createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { sketchLinesInModel } from './sketchLines';

it('lays a finished sketch’s curves on its plane, and leaves out parts already extruded', () => {
  const sketch = { ...createCadPart('Shelf', 18), drawnOn: { on: { plane: 'front' as const }, offset: 0 }, extrude: false as const };
  sketch.sketch = addLine(sketch.sketch, { x1: 0, y1: 100, x2: 400, y2: 100 });
  const part = { ...createCadPart('Side', 18) };
  part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 10, y2: 0 });
  const document: CadDocument = { ...createCadDocument(), parts: [part, sketch] };
  // The front plane runs along x and up z.
  expect(sketchLinesInModel(document)).toEqual([
    {
      partId: sketch.id,
      points: [
        [0, 0, 100],
        [400, 0, 100],
      ],
    },
  ]);
});
