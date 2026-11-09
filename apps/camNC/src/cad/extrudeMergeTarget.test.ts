import { addCircle, addRectangle, createCadPart, parseCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import bracket from '../../../../packages/cad-script/fixtures/designs/face-extrusion-bracket.json';
import { extrudeMergeTarget } from './extrudeMergeTarget';

it('chooses the shelf that a side extrusion meets across a face, rather than its edge-only panel support', () => {
  const source = parseCadDocument(bracket);
  const document = { ...source, parts: source.parts.slice(0, 3) };
  const [panel, shelf, side] = document.parts;
  expect(extrudeMergeTarget(document, side!, panel!.id)).toBe(shelf!.id);
  expect(extrudeMergeTarget({ ...document, parts: document.parts.slice(0, 2) }, shelf!, panel!.id)).toBe(panel!.id);
  const withHole = { ...side!, sketch: addCircle(side!.sketch, { x: 30, y: 50, radius: 3 }) };
  expect(extrudeMergeTarget(document, withHole, panel!.id)).toBe(panel!.id);
});

it('keeps the support default when a separate cut removes the apparent contact face', () => {
  const source = parseCadDocument(bracket);
  const [panel, shelf, side] = source.parts;
  const tool = createCadPart('Contact cutter', 14.66);
  tool.sketch = addRectangle(tool.sketch, { x: 0, y: 0, width: 2, height: 65.7 });
  tool.placement = { position: [56.268, -90.7, 48.34], rotation: [0, 0, 0, 1] };
  const document = {
    ...source,
    parts: [panel!, shelf!, side!, tool],
    partCuts: [{ id: 'cut-contact', tools: [tool.id], targets: [shelf!.id], clearance: 0 }],
  };
  expect(extrudeMergeTarget(document, side!, panel!.id)).toBe(panel!.id);
  const remove = {
    ...tool,
    remove: { depth: 'through' as const, targets: [shelf!.id] },
    drawnOn: { on: { plane: 'top' as const }, offset: 0 },
  };
  expect(extrudeMergeTarget({ ...source, parts: [panel!, shelf!, side!, remove] }, side!, panel!.id)).toBe(panel!.id);
});
