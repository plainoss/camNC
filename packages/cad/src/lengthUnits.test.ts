import { addFaceSketch, faceSketchDocument, withFaceSketchDocument } from './features';
import { describe, expect, it } from 'vitest';
import { createPlateDocument } from './document';
import { withCadLengthUnit } from './lengthUnits';
import { parseCadDocument } from './parseCadDocument';
import { parseCadValue } from './valueExpressions';
import { cadVariableScope } from './variables';

describe('design length units', () => {
  it.each([
    ['cm', 20],
    ['in', 50.8],
    ['m', 2000],
    ['ft', 609.6],
  ] as const)('interprets bare input in %s and stores a portable expression', (lengthUnit, value) => {
    const parsed = parseCadValue('2', { lengthUnit });
    expect(parsed).toMatchObject({ value });
    expect('expression' in parsed && parseCadValue(parsed.expression!)).toMatchObject({ value });
    expect(parseCadValue('2mm', { lengthUnit })).toEqual({ value: 2 });
    expect(parseCadValue('2', { unit: 'deg', lengthUnit })).toEqual({ value: 2 });
    expect(parseCadValue('2', { unit: 'scalar', lengthUnit })).toEqual({ value: 2 });
  });

  it('keeps existing arithmetic and scalar-variable lengths in mm across unit changes and reload', () => {
    const document = createPlateDocument();
    document.variables = [{ id: 'stock', name: 'stock', expression: '9' }];
    document.parts[0]!.thicknessExpression = '2 * stock';
    const width = document.parts[0]!.sketch.constraints.find(c => c.type === 'distanceX')!;
    Object.assign(width, { expression: '2 * 60' });
    const next = parseCadDocument(JSON.parse(JSON.stringify(withCadLengthUnit(document, 'cm'))));
    expect(next.parts[0]!.thickness).toBe(18);
    expect(next.parts[0]!.thicknessExpression).toBe('(2 * stock) mm');
    expect(document.parts[0]!.thicknessExpression).toBe('2 * stock');
    expect(parseCadValue(next.parts[0]!.thicknessExpression!, { variables: cadVariableScope(next), lengthUnit: 'cm' })).toMatchObject({
      value: 18,
    });
    expect(next.parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 120, expression: '(2 * 60) mm' });
    expect(withCadLengthUnit(next, 'in').parts).toEqual(next.parts);
  });

  it('preserves named dimensional lengths and validates the saved preference', () => {
    const document = createPlateDocument();
    document.variables = [{ id: 'stock', name: 'stock', expression: '18mm' }];
    document.parts[0]!.thicknessExpression = 'stock';
    const next = withCadLengthUnit(document, 'cm');
    expect(next.parts[0]!.thicknessExpression).toBe('stock');
    expect(parseCadValue('stock', { variables: cadVariableScope(next), lengthUnit: 'cm' })).toMatchObject({ value: 18 });
    expect(() => parseCadDocument({ ...document, lengthUnit: 'yards' })).toThrow('Invalid CAD document');
    expect(parseCadDocument(document).lengthUnit).toBeUndefined();
  });
});

it('carries the unit and title through editing a face sketch', () => {
  const base = createPlateDocument();
  base.lengthUnit = 'cm';
  const added = addFaceSketch(base, base.parts[0]!.id, 'top');
  const face = faceSketchDocument(added.document, base.parts[0]!.id, added.sketchId);
  expect(face.lengthUnit).toBe('cm');
  const edited = { ...withCadLengthUnit(face, 'in'), name: 'Cabinet side', variables: [{ id: 'width', name: 'width', expression: '2in' }] };
  const merged = withFaceSketchDocument(added.document, base.parts[0]!.id, added.sketchId, edited);
  expect(merged.name).toBe('Cabinet side');
  expect(merged.variables).toEqual(edited.variables);
  expect(merged.lengthUnit).toBe('in');
  expect(merged.parts).toEqual(added.document.parts);
});

it('preserves expressions outside a face editor when it changes the whole design unit', () => {
  const base = createPlateDocument();
  base.variables = [{ id: 'stock', name: 'stock', expression: '9' }];
  base.parts[0]!.thicknessExpression = '2 * stock';
  base.planes = [{ id: 'plane', name: 'Offset', on: { plane: 'top' }, offset: 20, offsetExpression: '2 * 10' }];
  const added = addFaceSketch(base, base.parts[0]!.id, 'top');
  const face = faceSketchDocument(added.document, base.parts[0]!.id, added.sketchId);
  const merged = withFaceSketchDocument(added.document, base.parts[0]!.id, added.sketchId, withCadLengthUnit(face, 'cm'));
  expect(merged.parts[0]!.thicknessExpression).toBe('(2 * stock) mm');
  expect(merged.planes![0]!.offsetExpression).toBe('(2 * 10) mm');
  expect(parseCadValue(merged.parts[0]!.thicknessExpression!, { variables: cadVariableScope(merged), lengthUnit: 'cm' })).toMatchObject({
    value: 18,
  });
});
