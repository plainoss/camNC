import { describe, expect, it } from 'vitest';
import {
  applyCadVariables,
  cadVariableProblems,
  cadVariableUses,
  createPlateDocument,
  setCadVariable,
  withCadLengthUnit,
  type CadDocument,
  type CadPart,
} from './index';

/** A part and a Cut parts step holding typed values of most kinds, each typed as `size`, `turns` or `many`. */
function everyTypedValue(): CadDocument {
  const document = createPlateDocument({ name: 'Plate', width: 200, height: 100 });
  const plate = document.parts[0]!;
  const width = plate.sketch.constraints.find(constraint => constraint.label === 'Width')!;
  const part: CadPart = {
    ...plate,
    thicknessExpression: 'size',
    sketch: {
      ...plate.sketch,
      constraints: plate.sketch.constraints.map(constraint => (constraint === width ? { ...constraint, expression: 'size' } : constraint)),
    },
    thin: { depth: 1, depthExpression: 'size' },
    cornerRelief: { diameter: 1, diameterExpression: 'size' },
    drawnOn: { on: { plane: 'top' }, offset: 1, offsetExpression: 'size' },
    placement: { position: [1, 2, 3], rotation: [0, 0, 0, 1], positionExpressions: ['size', null, 'size'] },
    moved: {
      by: [1, 2, 3],
      byExpressions: [null, 'size', null],
      turn: { about: [0, 0, 0], axis: [0, 0, 1], degrees: 1, degreesExpression: 'turns' },
    },
    pattern: { id: 'row', axis: 'x', count: 2, countExpression: 'many', spacing: 1, spacingExpression: 'size' },
    copies: [
      {
        id: 'copy',
        along: { along: { plane: 'top' }, distance: 1, distanceExpression: 'size' },
        placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1], positionExpressions: [null, 'size', null] },
        offset: { position: [0, 0, 0], rotation: [0, 0, 0, 1], positionExpressions: ['size', null, null] },
        turn: { about: [0, 0, 0], axis: [0, 0, 1], degrees: 1, degreesExpression: 'turns' },
      },
    ],
    remove: { depth: 1, depthExpression: 'size' },
    hole: { diameter: 1, diameterExpression: 'size' },
    fillets: [{ id: 'fillet', corners: [], radius: 1, radiusExpression: 'size' }],
    features: [{ type: 'cut', id: 'cut', sketchId: plate.sketch.id, regionId: 'region', depth: 1, depthExpression: 'size' }],
  };
  return {
    ...document,
    parts: [part, { ...plate, id: 'plain', name: 'Plain' }],
    partCuts: [
      {
        id: 'joint',
        tools: [part.id],
        targets: ['plain'],
        clearance: 1,
        clearanceExpression: 'size',
        split: { fingers: 2, fingersExpression: 'many' },
      },
    ],
    variables: [
      { id: 'size', name: 'size', expression: '12 mm' },
      { id: 'turns', name: 'turns', expression: '30 deg' },
      { id: 'many', name: 'many', expression: '4' },
    ],
  };
}

const kTyped = { size: 17, turns: 2, many: 2 };

describe('typed values', () => {
  it('brings every typed value up to date', () => {
    const [part] = applyCadVariables(everyTypedValue()).parts;
    expect(part).toMatchObject({
      thickness: 12,
      thin: { depth: 12 },
      cornerRelief: { diameter: 12 },
      drawnOn: { offset: 12 },
      placement: { position: [12, 2, 12] },
      moved: { by: [1, 12, 3], turn: { degrees: 30 } },
      pattern: { count: 4, spacing: 12 },
      copies: [{ along: { distance: 12 }, placement: { position: [0, 12, 0] }, offset: { position: [12, 0, 0] }, turn: { degrees: 30 } }],
      remove: { depth: 12 },
      hole: { diameter: 12 },
      fillets: [{ radius: 12 }],
      features: [{ depth: 12 }],
    });
    expect(part!.sketch.constraints.find(constraint => constraint.label === 'Width')).toMatchObject({ value: 12 });
    expect(applyCadVariables(everyTypedValue()).partCuts).toMatchObject([{ clearance: 12, split: { fingers: 4 } }]);
  });

  it('counts and renames every typed value', () => {
    const document = everyTypedValue();
    for (const [name, uses] of Object.entries(kTyped)) expect(cadVariableUses(document, name), name).toBe(uses);
    let renamed = document;
    for (const name of Object.keys(kTyped)) {
      const result = setCadVariable(renamed, {
        id: name,
        name: `${name}Now`,
        expression: document.variables!.find(v => v.id === name)!.expression,
      });
      if ('error' in result) throw new Error(result.error);
      renamed = result.document;
    }
    for (const [name, uses] of Object.entries(kTyped)) {
      expect(cadVariableUses(renamed, name), name).toBe(0);
      expect(cadVariableUses(renamed, `${name}Now`), name).toBe(uses);
    }
  });

  it('returns the same document, and the same parts, where nothing follows a new value', () => {
    const applied = applyCadVariables(everyTypedValue());
    expect(applyCadVariables(applied)).toBe(applied);
    const resized = applyCadVariables({
      ...applied,
      variables: applied.variables!.map(v => (v.id === 'size' ? { ...v, expression: '9 mm' } : v)),
    });
    expect(resized.parts[0]).not.toBe(applied.parts[0]);
    expect(resized.parts[1]).toBe(applied.parts[1]);
    expect(resized.parts[0]!.moved).toMatchObject({ by: [1, 9, 3] });
    expect((resized.parts[0]!.moved as { turn: unknown }).turn).toBe((applied.parts[0]!.moved as { turn: unknown }).turn);
  });

  it('keeps the last good value of one that can’t be worked out, and says why unless it’s a quiet one', () => {
    const applied = applyCadVariables(everyTypedValue());
    const broken = { ...applied, variables: applied.variables!.map(v => (v.id === 'size' ? { ...v, expression: '-3 mm' } : v)) };
    const [part] = applyCadVariables(broken).parts;
    // Allowed to be negative.
    expect(part).toMatchObject({ drawnOn: { offset: -3 }, placement: { position: [-3, 2, -3] }, moved: { by: [1, -3, 3] } });
    expect(part).toMatchObject({
      thickness: 12,
      thin: { depth: 12 },
      cornerRelief: { diameter: 12 },
      remove: { depth: 12 },
      hole: { diameter: 12 },
      fillets: [{ radius: 12 }],
      features: [{ depth: 12 }],
    });
    expect(cadVariableProblems(broken).map(problem => problem.message)).toEqual([
      'Thickness size: Thickness must be at least 0.1 mm.',
      'Depth size: A thin board needs some depth.',
      'Corner relief size: A bit needs to be wider than nothing.',
      'size: That would flip this line over. It needs to stay above zero.',
      'Cut depth size: A cut can’t be less than nothing deep.',
      // Said on each part the step joins.
      'Clearance size = -3 mm in Cut Plain with Plate: a clearance can’t be less than nothing.',
      'Clearance size = -3 mm in Cut Plain with Plate: a clearance can’t be less than nothing.',
    ]);
  });

  it('follows a part pattern’s spacing while its count can’t be worked out', () => {
    const applied = applyCadVariables(everyTypedValue());
    const broken = {
      ...applied,
      variables: applied.variables!.map(v =>
        v.id === 'many' ? { ...v, expression: '0' } : v.id === 'size' ? { ...v, expression: '20 mm' } : v
      ),
    };
    expect(applyCadVariables(broken).parts[0]!.pattern).toMatchObject({ count: 4, spacing: 20 });
    expect(cadVariableProblems(broken).map(problem => problem.message)).toContain(
      'Part pattern many: A part pattern makes one to 200, counting the part itself.'
    );
    const both = { ...broken, variables: broken.variables!.map(v => (v.id === 'size' ? { ...v, expression: '20 deg' } : v)) };
    expect(applyCadVariables(both).parts[0]!.pattern).toMatchObject({ count: 4, spacing: 12 });
    expect(
      cadVariableProblems(both)
        .map(problem => problem.message)
        .filter(message => message.startsWith('Part pattern'))
    ).toHaveLength(2);
  });

  it('leaves alone what holds no typed value', () => {
    const { partCuts: _partCuts, ...document } = everyTypedValue();
    const applied = applyCadVariables({
      ...document,
      variables: document.variables!.map(v => (v.id === 'size' ? { ...v, expression: '9 mm' } : v)),
    });
    expect(applied).not.toHaveProperty('partCuts');
    expect(applied).not.toHaveProperty('planes');
    expect(applied.parts[1]).not.toHaveProperty('features');
    const renamed = setCadVariable(applied, { id: 'turns', name: 'twist', expression: '30 deg' });
    if ('error' in renamed) throw new Error(renamed.error);
    expect(renamed.document).not.toHaveProperty('partCuts');
    expect(renamed.document.parts[1]).toBe(applied.parts[1]);
    expect(withCadLengthUnit(applied, 'in').parts[1]).toBe(applied.parts[1]);
  });

  it('gives every bare length, and nothing else, its unit when the design’s unit changes', () => {
    const document = everyTypedValue();
    const bare = {
      ...document,
      variables: [],
      parts: document.parts.map(part => ({
        ...part,
        ...(part.thicknessExpression && { thicknessExpression: '12' }),
        ...(part.pattern && { pattern: { ...part.pattern, countExpression: '3', spacingExpression: '40' } }),
        ...(part.moved && 'by' in part.moved && { moved: { ...part.moved, turn: { ...part.moved.turn!, degreesExpression: '45' } } }),
      })),
    };
    const [part] = withCadLengthUnit(bare, 'in').parts;
    expect(part).toMatchObject({
      thicknessExpression: '(12) mm',
      pattern: { countExpression: '3', spacingExpression: '(40) mm' },
      moved: { turn: { degreesExpression: '45' } },
    });
  });
});
