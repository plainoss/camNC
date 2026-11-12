import { describe, expect, it } from 'vitest';
import { createPlateDocument } from './document';
import { designSteps } from './designSteps';
import { migrateDesignUnitNumbers, withCadLengthUnit } from './lengthUnits';
import { parseCadDocument } from './parseCadDocument';
import type { CadDocument, CadLengthUnit } from './types';
import { parseCadValue, type CadValueScope } from './valueExpressions';
import { applyCadVariables, cadFieldVariableExpression, cadVariableScope, setCadVariable } from './variables';

const lengths = (entries: Record<string, number>): CadValueScope =>
  Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, { value, kind: 'length' as const }]));
const reload = (document: CadDocument) => parseCadDocument(JSON.parse(JSON.stringify(document)));
const withVariable = (document: CadDocument, name: string, expression: string) => {
  const result = setCadVariable(document, { name, expression });
  if ('error' in result) throw new Error(result.error);
  return result.document;
};
const widthOf = (document: CadDocument) => document.parts[0]!.sketch.constraints.find(c => c.type === 'distanceX')! as { id: string };
const constraint = (document: CadDocument, id: string) =>
  document.parts[0]!.sketch.constraints.find(c => c.id === id) as unknown as { value: number; expression?: string };

describe('a plain number next to a variable is in the design’s unit', () => {
  it('reads "t + 0.125" in an inch design as an eighth of an inch more, and saves the inch', () => {
    const variables = lengths({ t: 19.05 });
    const parsed = parseCadValue('t + 0.125', { variables, lengthUnit: 'in' });
    expect(parsed).toEqual({ value: 22.225, expression: 't + 0.125 in' });
    // The saved text reads the same in any design unit.
    for (const lengthUnit of ['mm', 'cm', 'in'] as const)
      expect(parseCadValue('t + 0.125 in', { variables, lengthUnit })).toMatchObject({ value: 22.225 });
  });

  it('reads "t + 2" in a cm design as 2 cm more', () => {
    expect(parseCadValue('t + 2', { variables: lengths({ t: 20 }), lengthUnit: 'cm' })).toEqual({ value: 40, expression: 't + 2 cm' });
  });

  it('keeps mm designs as they were', () => {
    expect(parseCadValue('depth + 10', { variables: lengths({ depth: 6 }) })).toEqual({ value: 16, expression: 'depth + 10' });
  });

  it.each([
    ['1 + 2 + t', '(1 + 2) in + t', 101.6],
    ['(1 + 2) + t', '(1 + 2) in + t', 101.6],
    ['t - 1 - 0.5', 't - 1 in - 0.5 in', -12.7],
    ['2 * (t + 1)', '2 * (t + 1 in)', 101.6],
    ['min(t, 1)', 'min(t, 1 in)', 25.4],
    ['max(1, 2, t)', 'max(1 in, 2 in, t)', 50.8],
    ['t + round(1.4)', 't + round(1.4) in', 50.8],
    ['t + n', 't + n in', 127],
    ['=t + 1', '=t + 1 in', 50.8],
    ['t + 1 1/2', 't + 1 1/2 in', 63.5],
  ])('writes the unit into %s', (typed, saved, value) => {
    const variables = { ...lengths({ t: 25.4 }), n: { value: 4, kind: 'number' as const } };
    const parsed = parseCadValue(typed, { variables, lengthUnit: 'in' });
    expect(parsed).toMatchObject({ expression: saved });
    expect((parsed as { value: number }).value).toBeCloseTo(value, 9);
    expect((parseCadValue(saved, { variables }) as { value: number }).value).toBeCloseTo(value, 9);
  });

  it('still asks for a unit beside a typed one, and leaves angles in degrees', () => {
    expect(parseCadValue('2 + 1in', { lengthUnit: 'in' })).toHaveProperty('error');
    expect(parseCadValue('a + 5', { unit: 'deg', variables: { a: { value: 30, kind: 'angle' } }, lengthUnit: 'in' })).toEqual({
      value: 35,
      expression: 'a + 5',
    });
  });

  it('saves a variable typed in an inch design with its inch', () => {
    let document: CadDocument = { ...createPlateDocument(), lengthUnit: 'in' };
    document = withVariable(document, 't', '0.75 in');
    document = withVariable(document, 'plate', 't + 0.125');
    expect(document.variables!.find(variable => variable.name === 'plate')!.expression).toBe('t + 0.125 in');
    expect(cadVariableScope(document).plate!.value).toBeCloseTo(22.225, 9);
    // A plain number on its own is still a number variable.
    expect(withVariable(document, 'count', '3').variables!.at(-1)!.expression).toBe('3');
  });
});

describe('a variable made in a length field keeps its size', () => {
  it.each([
    ['300', 'mm', 'mm', '300 mm'],
    ['300', 'mm', 'cm', '300 cm'],
    ['2 * 15', 'mm', 'in', '(2 * 15) in'],
    ['30', 'deg', 'in', '30°'],
    ['18 mm', 'mm', 'cm', '18 mm'],
    ['t + 1', 'mm', 'cm', 't + 1'],
  ] as const)('saves %s typed in a %s field of a %s design as %s', (typed, unit, lengthUnit, saved) => {
    expect(cadFieldVariableExpression(typed, unit, lengths({ t: 10 }), lengthUnit)).toBe(saved);
  });

  it('leaves a count a number, and keeps the kind of a variable it redefines', () => {
    expect(cadFieldVariableExpression('5', 'scalar', {}, 'cm')).toBe('5');
    expect(cadFieldVariableExpression('400', 'mm', {}, 'cm', 'number')).toBe('400');
    expect(cadFieldVariableExpression('30', 'mm', {}, 'cm', 'angle')).toBe('30°');
    expect(cadFieldVariableExpression('4', 'scalar', {}, 'in', 'length')).toBe('4 in');
  });

  it('gives "#w" the same length after the design changes from mm to cm', () => {
    let document = createPlateDocument();
    const width = widthOf(document).id;
    document = withVariable(document, 'w', cadFieldVariableExpression('300', 'mm', {}, document.lengthUnit));
    document = applyCadVariables({
      ...document,
      parts: [
        {
          ...document.parts[0]!,
          sketch: {
            ...document.parts[0]!.sketch,
            constraints: document.parts[0]!.sketch.constraints.map(c => (c.id === width ? { ...c, value: 300, expression: '#w' } : c)),
          },
        },
      ],
    });
    const cm = reload(withCadLengthUnit(document, 'cm'));
    expect(cm.variables![0]!.expression).toBe('300 mm');
    expect(constraint(cm, width)).toMatchObject({ value: 300, expression: '#w' });
    // A second edge given #w in the cm design is the same 300 mm, which reads 30 cm.
    expect(parseCadValue('#w', { variables: cadVariableScope(cm), lengthUnit: 'cm' })).toEqual({ value: 300, expression: '#w' });
  });

  it('keeps a saved design whose variable is a plain number reading as it did', () => {
    const document: CadDocument = { ...createPlateDocument(), lengthUnit: 'cm', variables: [{ id: 'w', name: 'w', expression: '300' }] };
    const [bottom, left] = document.parts[0]!.sketch.constraints.filter(c => c.type === 'distanceX' || c.type === 'distanceY');
    Object.assign(bottom!, { value: 300, expression: '(#w) mm' });
    Object.assign(left!, { value: 3000, expression: '(#w) cm' });
    const loaded = reload(document);
    expect(loaded.variables).toEqual(document.variables);
    expect(constraint(loaded, bottom!.id)).toMatchObject({ value: 300, expression: '(#w) mm' });
    expect(constraint(loaded, left!.id)).toMatchObject({ value: 3000, expression: '(#w) cm' });
  });
});

describe('designs saved in another unit before plain numbers took it', () => {
  const legacy = (lengthUnit: CadLengthUnit): CadDocument => {
    const document = createPlateDocument();
    document.lengthUnit = lengthUnit;
    document.variables = [
      { id: 't', name: 't', expression: '0.75 in' },
      { id: 'u', name: 'u', expression: 't + 1' },
      { id: 'n', name: 'n', expression: '3' },
    ];
    Object.assign(document.parts[0]!, { thickness: 19.175, thicknessExpression: 't + 0.125' });
    Object.assign(document.parts[0]!.sketch.constraints.find(c => c.type === 'distanceX')!, { value: 120, expression: '2 * 60' });
    return document;
  };

  it('writes out the mm their plain numbers meant when loading, so they keep their size', () => {
    const document = legacy('in');
    const loaded = reload(document);
    expect(loaded.parts[0]).toMatchObject({ thickness: 19.175, thicknessExpression: 't + 0.125 mm' });
    expect(constraint(loaded, widthOf(loaded).id)).toMatchObject({ value: 120, expression: '(2 * 60) mm' });
    expect(loaded.variables!.map(variable => variable.expression)).toEqual(['0.75 in', 't + 1 mm', '3']);
    expect(cadVariableScope(loaded)).toEqual(cadVariableScope(document));
    expect(applyCadVariables(loaded).parts[0]!.thickness).toBeCloseTo(19.175, 9);
    // Editing the field as it reads gives the same size in the design's unit.
    const edited = parseCadValue('t + 0.125 mm', { variables: cadVariableScope(loaded), lengthUnit: 'in' }) as { value: number };
    expect(edited.value).toBeCloseTo(19.175, 9);
    expect(reload(loaded)).toEqual(loaded);
  });

  it('writes out the mm of a part’s and a Cut parts step’s corner relief diameter', () => {
    const document = legacy('in');
    document.parts[0]!.cornerRelief = { diameter: 7, diameterExpression: 'u - 13.05' };
    document.partCuts = [
      { id: 'cut', tools: ['a'], targets: ['b'], clearance: 0, cornerRelief: { diameter: 8, diameterExpression: 't - 11.05' } },
      { id: 'plain', tools: ['a'], targets: ['b'], clearance: 0, cornerRelief: null },
    ];
    const migrated = migrateDesignUnitNumbers(document);
    expect(migrated.parts[0]!.cornerRelief).toEqual({ diameter: 7, diameterExpression: 'u - 13.05 mm' });
    expect(migrated.partCuts![0]!.cornerRelief).toEqual({ diameter: 8, diameterExpression: 't - 11.05 mm' });
    expect(migrated.partCuts![1]!.cornerRelief).toBeNull();
    const scope = cadVariableScope(migrated);
    expect((parseCadValue('t - 11.05 mm', { variables: scope, lengthUnit: 'in' }) as { value: number }).value).toBeCloseTo(8, 9);
  });

  it('leaves mm designs untouched', () => {
    const document = legacy('mm');
    delete document.lengthUnit;
    expect(reload(document)).toEqual(document);
  });

  it('keeps an inch design’s new expressions through a save and load', () => {
    let document: CadDocument = { ...createPlateDocument(), lengthUnit: 'in' };
    document = withVariable(document, 't', '0.75 in');
    const parsed = parseCadValue('t + 0.125', { variables: cadVariableScope(document), lengthUnit: 'in' }) as {
      value: number;
      expression: string;
    };
    Object.assign(document.parts[0]!, { thickness: parsed.value, thicknessExpression: parsed.expression });
    const loaded = reload(document);
    expect(loaded).toEqual(document);
    expect(applyCadVariables(loaded).parts[0]!.thickness).toBeCloseTo(22.225, 9);
    // Changing the unit afterwards keeps the size.
    const cm = withCadLengthUnit(loaded, 'cm');
    expect(cm.parts[0]!.thicknessExpression).toBe('t + 0.125 in');
    expect(applyCadVariables(cm).parts[0]!.thickness).toBeCloseTo(22.225, 9);
  });

  it('writes out mm when an mm design changes to inches', () => {
    let document = withVariable(createPlateDocument(), 't', '18 mm');
    Object.assign(document.parts[0]!, { thickness: 20, thicknessExpression: 't + 2' });
    document = withCadLengthUnit(document, 'in');
    expect(document.parts[0]!.thicknessExpression).toBe('t + 2 mm');
    expect(applyCadVariables(document).parts[0]!.thickness).toBe(20);
  });
});

describe('the feature list reads lengths in the design’s unit', () => {
  const plate = (lengthUnit?: CadLengthUnit, thicknessExpression?: string, thickness = 18) => {
    const document = createPlateDocument();
    if (lengthUnit) document.lengthUnit = lengthUnit;
    Object.assign(document.parts[0]!, { thickness, ...(thicknessExpression && { thicknessExpression }) });
    return designSteps(document).find(step => step.kind === 'extrude')!.detail;
  };

  it.each([
    [undefined, undefined, 18, '18 mm'],
    ['in', undefined, 18, '0.709 in'],
    ['cm', undefined, 18, '1.8 cm'],
    ['in', '(1) in', 25.4, '1 in'],
    ['in', 't + 0.125 in', 22.225, 't + 0.125 in = 0.875 in'],
    ['cm', 't + 2 cm', 40, 't + 2 cm = 4 cm'],
  ] as const)('in a %s design, %s at %s mm reads %s', (lengthUnit, expression, value, detail) => {
    expect(plate(lengthUnit, expression, value)).toBe(detail);
  });
});
