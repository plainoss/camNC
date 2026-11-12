import { cadVariableScope, createCadDocument, parseCadValue, type CadDocument, type CadLengthUnit } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { editCad } from './edit';

const plate = async (lengthUnit: CadLengthUnit) => {
  let measured = 0;
  const result = await editCad({ ...createCadDocument('Plate'), lengthUnit }, d => {
    d.variable('t', '18mm');
    d.variable('a', 't + 1');
    measured = d.value('t + 1');
    d.newPart('Plate', { thickness: 't + 2' }).profile.rect({ at: [0, 0], w: 't + 10', h: 80 });
  });
  expect(result.scriptError).toBeUndefined();
  return { document: result.document, measured };
};
const width = (document: CadDocument) =>
  document.parts[0]!.sketch.constraints.find(constraint => 'expression' in constraint && /t \+ 10/.test(String(constraint.expression))) as
    | { value: number; expression: string }
    | undefined;

describe('a script in a design measured in inches', () => {
  it('reads its plain numbers as mm and saves them saying so', async () => {
    const { document, measured } = await plate('in');
    expect(measured).toBe(19);
    expect(document.variables!.find(variable => variable.name === 'a')!.expression).toBe('t + 1 mm');
    expect(cadVariableScope(document).a!.value).toBe(19);
    expect(document.parts[0]).toMatchObject({ thickness: 20, thicknessExpression: 't + 2 mm' });
    expect(width(document)).toMatchObject({ value: 28, expression: 't + 10 mm' });
    // Edited in the app, where a plain number is in inches, the saved text keeps its size.
    expect(parseCadValue('t + 2 mm', { variables: cadVariableScope(document), lengthUnit: 'in' })).toMatchObject({ value: 20 });
  });

  it('leaves an mm design’s expressions as written', async () => {
    const { document } = await plate('mm');
    expect(document.variables!.find(variable => variable.name === 'a')!.expression).toBe('t + 1');
    expect(document.parts[0]).toMatchObject({ thickness: 20, thicknessExpression: 't + 2' });
    expect(width(document)).toMatchObject({ value: 28, expression: 't + 10' });
  });
});
