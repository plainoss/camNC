import { expect, it } from 'vitest';
import {
  addCircle,
  createCadDocument,
  createCadPart,
  designSteps,
  evaluateCadDocument,
  parseCadDocument,
  removeCadVariable,
  resolveExtrudeSteps,
  sketchRegions,
  solveCadDocument,
  type CadPart,
} from './index';

it('deletes a variable steps use: they fail, saying so, the part isn’t built, and the design still opens', async () => {
  const cup: CadPart = {
    ...createCadPart('Part 1', 20),
    id: 'cup',
    thicknessExpression: '#material',
    drawnOn: { on: { plane: 'top' }, offset: 0 },
  };
  cup.sketch = addCircle(cup.sketch, { x: 0, y: 0, radius: 38.9 });
  const pocket: CadPart = {
    ...createCadPart('Part 2', 20),
    id: 'pocket',
    drawnOn: { on: { partId: 'cup', face: 'top' }, offset: 0 },
    remove: { depth: 16, depthExpression: '#material - 4 mm' },
  };
  pocket.sketch = addCircle(pocket.sketch, { x: 0, y: 0, radius: 33.6 });
  const document = resolveExtrudeSteps({
    ...createCadDocument(),
    variables: [{ id: 'v', name: 'material', expression: '20 mm' }],
    parts: [{ ...cup, regions: sketchRegions(cup.sketch).map(region => region.id) }, pocket],
  });
  const removed = removeCadVariable(document, 'v');
  if ('error' in removed) throw new Error(removed.error);
  expect(removed.document.variables).toBeUndefined();
  const evaluated = evaluateCadDocument(removed.document);
  expect(evaluated.parts.map(part => part.partId)).not.toContain('cup');
  const rows = Object.fromEntries(designSteps(removed.document).map(step => [step.label, step.broken ?? null]));
  expect(rows['Extrude 1']).toBe('Variable not found, is suppressed, or has not been set.');
  expect(rows['Sketch 2']).toBe('Select a sketch plane. 1 missing selection');
  expect(() => parseCadDocument(JSON.parse(JSON.stringify(removed.document)))).not.toThrow();
  // Solved, as the editor checks it, the part isn't built either.
  const solved = await solveCadDocument(removed.document);
  expect(solved.parts.map(part => part.partId)).not.toContain('cup');
});
