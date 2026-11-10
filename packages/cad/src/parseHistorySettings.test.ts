import { describe, expect, it } from 'vitest';
import { createPlateDocument, parseCadDocument } from './document';

function refusesCleanly(input: unknown) {
  const before = structuredClone(input);
  let caught: unknown;
  try {
    parseCadDocument(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).constructor).toBe(Error);
  expect((caught as Error).message).not.toBe('');
  expect(input).toEqual(before);
}

const movedDocument = (moved: unknown) => {
  const document = createPlateDocument();
  document.parts[0]!.moved = moved as never;
  return document;
};

describe('saved part history is validated before its feature-list details are formatted', () => {
  // parseFuzz seed1/radial-stool mutant5 and seed2/mutant6, reduced to standalone inputs.
  it.each([
    { name: 'seed1: moved.by[0] is an object', moved: { by: [{}, 0, 0] } },
    { name: 'seed2: moved.by[1] is an array', moved: { by: [0, [], 0] } },
    { name: 'a null move', moved: null },
    { name: 'a primitive move', moved: 7 },
    { name: 'a non-array translation', moved: { by: {} } },
    { name: 'a short translation', moved: { by: [0, 0] } },
    { name: 'a nonfinite translation', moved: { by: [0, Infinity, 0] } },
    { name: 'a sparse translation', moved: { by: Array(3) } },
    { name: 'invalid translation expressions', moved: { by: [0, 0, 0], byExpressions: [null, {}, null] } },
    { name: 'a null turn', moved: { by: [0, 0, 0], turn: null } },
    { name: 'a malformed turn angle', moved: { by: [0, 0, 0], turn: { about: [0, 0, 0], axis: [0, 0, 1], degrees: {} } } },
    { name: 'a malformed turn origin', moved: { by: [0, 0, 0], turn: { about: [0, []], axis: [0, 0, 1], degrees: 30 } } },
    { name: 'a zero turn axis', moved: { by: [0, 0, 0], turn: { about: [0, 0, 0], axis: [0, 0, 0], degrees: 30 } } },
    { name: 'a malformed directional distance', moved: { along: { plane: 'top' }, distance: [] } },
    { name: 'a malformed move direction', moved: { along: 3, distance: 20 } },
  ])('refuses $name with a plain validation error', ({ moved }) => {
    refusesCleanly(movedDocument(moved));
  });

  it.each([
    { name: 'a non-array fillet list', fillets: {} },
    { name: 'a null fillet', fillets: [null] },
    { name: 'a malformed radius', fillets: [{ id: 'fillet', corners: ['missing-corner'], radius: {} }] },
    { name: 'a nonfinite radius', fillets: [{ id: 'fillet', corners: ['missing-corner'], radius: Infinity }] },
    { name: 'a malformed corner list', fillets: [{ id: 'fillet', corners: {}, radius: 5 }] },
  ])('refuses $name before history formatting or evaluation', ({ fillets }) => {
    const document = createPlateDocument();
    document.parts[0]!.fillets = fillets as never;
    refusesCleanly(document);
  });

  it.each([
    { by: [12.5, -3, 0], byExpressions: ['12.5mm', null, null] },
    { by: [0, 0, 0], turn: { about: [1, 2, 3], axis: [0, 0, 2], degrees: 30, degreesExpression: '30' } },
    { along: { plane: 'right' }, flip: true, distance: 20 },
  ])('preserves valid move settings and leaves the source untouched', moved => {
    const document = movedDocument(moved);
    const before = structuredClone(document);
    expect(parseCadDocument(document)).toEqual(before);
    expect(document).toEqual(before);
  });

  it('keeps geometric fillet problems editable after structural validation', () => {
    const document = createPlateDocument();
    document.parts[0]!.fillets = [{ id: 'fillet', corners: ['removed-corner'], radius: -1 }];
    expect(parseCadDocument(document)).toEqual(document);
  });

  it('validates feature containers before deriving the minimum reader version', () => {
    const document = createPlateDocument();
    document.version = 3;
    document.parts[0]!.features = {} as never;
    refusesCleanly(document);
    const unnecessaryVersion = { ...createPlateDocument(), version: 3 };
    expect(() => parseCadDocument(unnecessaryVersion)).toThrow('Invalid CAD document');
  });
});
