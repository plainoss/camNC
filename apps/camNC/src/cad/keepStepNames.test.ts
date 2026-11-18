import { addRectangle, createCadDocument, createCadPart, designSteps, type CadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { keepStepNames } from './keepStepNames';

const board = (name: string) => {
  const part = { ...createCadPart(name, 10), drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 40, height: 20 });
  return part;
};

it('keeps the later steps named as they were when an earlier one is deleted', () => {
  const before: CadDocument = { ...createCadDocument(), parts: [board('Part 1'), board('Part 2')] };
  const labels = (document: CadDocument) => designSteps(document).map(step => step.label);
  expect(labels(before)).toEqual(['Sketch 1', 'Extrude 1', 'Sketch 2', 'Extrude 2']);
  const after = { ...before, parts: before.parts.slice(1) };
  expect(labels(after)).toEqual(['Sketch 1', 'Extrude 1']);
  expect(labels(keepStepNames(before, after))).toEqual(['Sketch 2', 'Extrude 2']);
  // Nothing renamed, nothing changed.
  expect(keepStepNames(before, before)).toBe(before);
});
