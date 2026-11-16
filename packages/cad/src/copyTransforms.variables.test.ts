import { expect, it } from 'vitest';
import {
  addCopyTransform,
  addPartCopy,
  applyCadVariables,
  cadVariableProblems,
  cadVariableUses,
  createPlateDocument,
  evaluateCadDocument,
  setCadVariable,
  type CadDocument,
  type CadPhysicalTransform,
} from './index';

function moved() {
  const initial = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const part = initial.parts[0]!;
  part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const copied = addPartCopy(initial, part.id, { offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  const withGap = setCadVariable(copied.document, { name: 'gap', expression: '50mm' });
  if ('error' in withGap) throw new Error(withGap.error);
  return addCopyTransform(withGap.document, part.id, copied.id, { by: [50, 0, 0], byExpressions: ['gap', null, null] }).document;
}

const withMove = (document: CadDocument, change: Partial<CadPhysicalTransform>): CadDocument => ({
  ...document,
  copyTransforms: [{ ...document.copyTransforms![0]!, ...change } as CadPhysicalTransform],
});
const moveProblems = (document: CadDocument) =>
  cadVariableProblems(document)
    .filter(problem => problem.code === 'variable-value')
    .map(problem => problem.message);

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

it('turns a copy as its angle variable changes and renames it with the variable', () => {
  const withAngle = setCadVariable(moved(), { name: 'angle', expression: '30deg' });
  if ('error' in withAngle) throw new Error(withAngle.error);
  const document = applyCadVariables(
    withMove(withAngle.document, {
      byExpressions: [null, null, null],
      turn: { about: [0, 0, 0], axis: [0, 0, 1], degrees: 30, degreesExpression: 'angle' },
    })
  );
  expect(cadVariableUses(document, 'angle')).toBe(1);
  expect(cadVariableUses(document, 'gap')).toBe(0);
  expect(document.copyTransforms![0]!.turn).toMatchObject({ degrees: 30, degreesExpression: 'angle' });
  const id = document.variables!.find(variable => variable.name === 'angle')!.id;
  const further = setCadVariable(document, { id, name: 'angle', expression: '45deg' });
  if ('error' in further) throw new Error(further.error);
  expect(further.document.copyTransforms![0]!.turn).toMatchObject({ degrees: 45, degreesExpression: 'angle' });
  const renamed = setCadVariable(further.document, { id, name: 'tilt', expression: '45deg' });
  if ('error' in renamed) throw new Error(renamed.error);
  expect(renamed.document.copyTransforms![0]!.turn).toMatchObject({ degrees: 45, degreesExpression: 'tilt' });
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

it('says each value of a move that cannot follow its variables', () => {
  const broken = withMove(moved(), {
    byExpressions: ['missing', 'gap', 'absent'],
    turn: { about: [0, 0, 0], axis: [0, 0, 1], degrees: 30, degreesExpression: 'lost' },
  });
  expect(moveProblems(broken)).toEqual([
    expect.stringMatching(/^Translation missing: /),
    expect.stringMatching(/^Translation absent: /),
    expect.stringMatching(/^Rotation lost: /),
  ]);
});

it('says a move’s problems where the move is, before those of Cut parts steps', () => {
  const document = moved();
  const broken: CadDocument = {
    ...withMove(document, { byExpressions: ['missing', null, null] }),
    partCuts: [{ id: 'cut', targets: [], tools: [], clearance: 0, clearanceExpression: 'absent' }],
  };
  expect(moveProblems(broken)).toEqual([expect.stringMatching(/^Translation missing: /), expect.stringMatching(/absent/)]);
});

it('leaves a move that is switched off out of the problems', () => {
  expect(moveProblems(withMove(moved(), { byExpressions: ['missing', null, null], suppressed: true }))).toEqual([]);
});

it('leaves an expression without variables to the evaluation, which says why the move cannot be made', () => {
  const broken = withMove(moved(), { byExpressions: ['1 +', null, null] });
  expect(moveProblems(broken)).toEqual([]);
  expect(evaluateCadDocument(broken).diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'variable-value',
      partId: broken.copyTransforms![0]!.partId,
      message: expect.stringMatching(/^Translation 1 \+: /),
    })
  );
  // Its kept number is as it was typed, so only a value that follows a variable is worked out again.
  expect(applyCadVariables(withMove(moved(), { by: [7, 0, 0], byExpressions: ['20', null, null] })).copyTransforms![0]!.by).toEqual([
    7, 0, 0,
  ]);
});

it('brings each value of a move up to date by itself, while the move is made as a whole or not at all', () => {
  const stale = withMove(moved(), { by: [1, 2, 3], byExpressions: ['gap', 'missing', 'gap * 2'] });
  expect(applyCadVariables(stale).copyTransforms![0]!.by).toEqual([50, 2, 100]);
  expect(evaluateCadDocument(stale).diagnostics).toContainEqual(
    expect.objectContaining({ code: 'variable-value', message: expect.stringMatching(/^Translation missing: /) })
  );
  const positions = (document: CadDocument) =>
    Object.values(evaluateCadDocument(document).placements!).map(placement => placement.position);
  expect(positions(stale)).toEqual([
    [0, 0, 0],
    [200, 0, 0],
  ]);
  expect(positions(withMove(stale, { byExpressions: ['gap', null, 'gap * 2'] }))).toEqual([
    [0, 0, 0],
    [250, 2, 100],
  ]);
});
