import { describe, expect, it } from 'vitest';
import { cadVariableProblems, createPlateDocument, designSteps, setCadVariable, type CadDocument, type CadPartCut } from './index';

/** Two boards joined by one Cut parts step whose finger count and clearance follow #n and #gap. */
function joined(step: Partial<CadPartCut> = {}, variables: Record<string, string> = { n: '5', gap: '0.2mm' }): CadDocument {
  const plate = (name: string) => ({ ...createPlateDocument({ width: 100, height: 100, thickness: 18 }).parts[0]!, name });
  const across = plate('Across'),
    along = { ...plate('Along'), copies: [{ id: 'c1', placement: { position: [0, 0, 200], rotation: [0, 0, 0, 1] } }] } as typeof across;
  let document: CadDocument = {
    ...createPlateDocument({ width: 100, height: 100, thickness: 18 }),
    parts: [across, along],
    partCuts: [
      {
        id: 'joint',
        tools: [along.id],
        targets: [across.id],
        clearance: 0.2,
        clearanceExpression: 'gap',
        split: { fingers: 5, fingersExpression: 'n' },
        ...step,
      },
    ],
  };
  for (const [name, expression] of Object.entries(variables)) {
    const result = setCadVariable(document, { id: document.variables?.find(v => v.name === name)?.id, name, expression });
    if ('error' in result) throw new Error(result.error);
    document = result.document;
  }
  return document;
}

/** The same design with a variable's expression typed in directly, past the checks the variables panel makes. */
const typed = (document: CadDocument, name: string, expression: string): CadDocument => ({
  ...document,
  variables: document.variables!.map(variable => (variable.name === name ? { ...variable, expression } : variable)),
});

const fingers = 'Finger count n = 1 in Cut Across with Along: a finger joint needs a whole number of fingers, at least 2.';

describe('Cut parts values that can’t follow their variables', () => {
  it('are said on each joined part and on the step’s feature row', () => {
    const document = typed(joined(), 'n', '1');
    const [across, along] = document.parts.map(part => part.id);
    expect(cadVariableProblems(document)).toEqual([
      { code: 'variable-value', severity: 'error', partId: along, message: fingers },
      { code: 'variable-value', severity: 'error', partId: across, message: fingers },
    ]);
    expect(designSteps(document).find(step => step.kind === 'partCut')?.broken).toBe(fingers);
    expect(designSteps(joined()).find(step => step.kind === 'partCut')?.broken).toBeUndefined();
  });

  it('give a clearance below nothing with its value', () => {
    const document = typed(joined(), 'gap', '-1mm');
    expect(cadVariableProblems(document).map(problem => problem.message)).toEqual([
      'Clearance gap = -1 mm in Cut Across with Along: a clearance can’t be less than nothing.',
      'Clearance gap = -1 mm in Cut Across with Along: a clearance can’t be less than nothing.',
    ]);
  });

  it('name the part of a copy the step cuts with', () => {
    const document = typed(joined(), 'n', '2.5');
    const [across, along] = document.parts.map(part => part.id);
    document.partCuts![0]!.tools = [`${along}:c1`];
    expect(cadVariableProblems(document).map(problem => problem.partId)).toEqual([along, across]);
    expect(cadVariableProblems(document)[0]!.message).toBe(
      'Finger count n = 2.5 in Cut Across with Along 2: a finger joint needs a whole number of fingers, at least 2.'
    );
  });

  it('are said once, on no part, when the joined parts are gone', () => {
    const document = typed(joined({ tools: ['gone'], targets: ['gone too'] }), 'n', '0');
    expect(cadVariableProblems(document)).toEqual([
      {
        code: 'variable-value',
        severity: 'error',
        message:
          'Finger count n = 0 in Cut a removed part with a removed part: a finger joint needs a whole number of fingers, at least 2.',
      },
    ]);
  });

  it('aren’t said for a step that’s switched off, by itself or by its folder', () => {
    const off = typed(joined({ suppressed: true }), 'n', '1');
    expect(cadVariableProblems(off)).toEqual([]);
    expect(designSteps(off).find(step => step.kind === 'partCut')?.broken).toBeUndefined();
    const folded = typed(joined(), 'n', '1');
    folded.folders = [{ id: 'f', name: 'Joints', partIds: [], partCutIds: ['joint'], suppressed: true }];
    expect(cadVariableProblems(folded)).toEqual([]);
    folded.folders = [{ id: 'f', name: 'Joints', partIds: [], partCutIds: ['joint'] }];
    expect(cadVariableProblems(folded)).toHaveLength(2);
  });

  it('leave a variable that’s itself in error to say so once', () => {
    const document = typed(joined(), 'n', '3 +');
    expect(cadVariableProblems(document)).toEqual([
      expect.objectContaining({ code: 'invalid-variable', message: expect.stringMatching(/^n: /) }),
    ]);
  });
});
