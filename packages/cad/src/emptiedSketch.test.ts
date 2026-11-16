import { expect, it } from 'vitest';
import { addCircle, addRectangle, createCadDocument, createCadPart, designSteps, evaluateCadDocument, sketchRegions } from './index';

it('fails only the extrude of a sketch emptied after its regions were picked, adding and merging nothing', () => {
  const base = { ...createCadPart('Part 1', 18), id: 'base', drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  base.sketch = addRectangle(base.sketch, { x: 0, y: 0, width: 50, height: 50 });
  const drawn = { ...createCadPart('Part 2', 1.2), id: 'disc', drawnOn: { on: { partId: 'base', face: 'top' as const }, offset: 0 } };
  drawn.sketch = addCircle(drawn.sketch, { x: 10, y: 10, radius: 5 });
  const regions = sketchRegions(drawn.sketch).map(region => region.id);
  const emptied = { ...drawn, sketch: createCadPart().sketch, regions, mergeAll: true as const, addTo: 'base' };
  const document = {
    ...createCadDocument(),
    version: 7 as const,
    parts: [{ ...base, regions: sketchRegions(base.sketch).map(region => region.id) }, emptied],
  };
  const rows = designSteps(document).map(step => [step.label, step.broken ?? null]);
  expect(rows).toEqual([
    ['Sketch 1', null],
    ['Extrude 1', null],
    ['Sketch 2', null],
    ['Extrude 2', 'Select face or sketch region to extrude. 1 missing selection'],
  ]);
  expect(
    evaluateCadDocument(document)
      .diagnostics.filter(d => d.severity === 'error')
      .map(d => d.partId)
  ).toEqual(['disc']);
});
