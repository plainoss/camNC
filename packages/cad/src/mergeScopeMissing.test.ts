import { expect, it } from 'vitest';
import {
  addCircle,
  createCadDocument,
  createCadPart,
  designSteps,
  resolveExtrudeSteps,
  sketchRegions,
  type CadDocument,
  type CadPart,
} from './index';

it('marks an Add whose merge scope was emptied as missing a selection, on its Extrude row only', () => {
  const cup: CadPart = { ...createCadPart('Part 1', 20), id: 'cup', drawnOn: { on: { plane: 'top' }, offset: 0 } };
  cup.sketch = addCircle(cup.sketch, { x: 0, y: 0, radius: 38.9 });
  const boss: CadPart = {
    ...createCadPart('Part 2', 16),
    id: 'boss',
    drawnOn: { on: { partId: 'cup', face: 'top' }, offset: 0 },
    addTo: '',
  };
  boss.sketch = addCircle(boss.sketch, { x: 0, y: 0, radius: 33.6 });
  const document = resolveExtrudeSteps({
    ...createCadDocument(),
    parts: [
      { ...cup, regions: sketchRegions(cup.sketch).map(region => region.id) },
      { ...boss, regions: sketchRegions(boss.sketch).map(region => region.id) },
    ],
  });
  const rows = Object.fromEntries(designSteps(document).map(step => [step.label, step.broken ?? null]));
  expect(rows['Extrude 2']).toBe('Select the parts to merge with. 1 missing selection');
  expect(rows['Sketch 2']).toBeNull();
  // Merge with all needs no scope.
  const all: CadDocument = {
    ...document,
    parts: document.parts.map(part => (part.id === 'boss' ? ({ ...part, mergeAll: true } as CadPart) : part)),
  };
  expect(designSteps(all).find(step => step.label === 'Extrude 2')?.broken).toBeUndefined();
});
