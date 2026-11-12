import { expect, it } from 'vitest';
import { addCopyTransform, addPartCopy, cadVariableProblems, cadVariableUses, createPlateDocument, setCadVariable } from './index';

function moved() {
  const initial = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const part = initial.parts[0]!;
  part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const copied = addPartCopy(initial, part.id, { offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  const withGap = setCadVariable(copied.document, { name: 'gap', expression: '50mm' });
  if ('error' in withGap) throw new Error(withGap.error);
  return addCopyTransform(withGap.document, part.id, copied.id, { by: [50, 0, 0], byExpressions: ['gap', null, null] }).document;
}

it('moves a copy as its distance variable changes and renames it with the variable', () => {
  const document = moved();
  expect(cadVariableUses(document, 'gap')).toBe(1);
  const id = document.variables!.find(variable => variable.name === 'gap')!.id;
  const wider = setCadVariable(document, { id, name: 'gap', expression: '80mm' });
  if ('error' in wider) throw new Error(wider.error);
  expect(wider.document.copyTransforms![0]!.by).toEqual([80, 0, 0]);
  const renamed = setCadVariable(wider.document, { id, name: 'spacing', expression: '80mm' });
  if ('error' in renamed) throw new Error(renamed.error);
  expect(renamed.document.copyTransforms![0]!.byExpressions).toEqual(['spacing', null, null]);
});

it('says which move cannot follow its expression and keeps its last good distance', () => {
  const document = moved();
  const broken = {
    ...document,
    copyTransforms: [{ ...document.copyTransforms![0]!, byExpressions: ['missing', null, null] as [string, null, null] }],
  };
  expect(cadVariableProblems(broken)).toContainEqual(
    expect.objectContaining({
      code: 'variable-value',
      partId: document.copyTransforms![0]!.partId,
      message: expect.stringMatching(/^Translation missing/),
    })
  );
});
