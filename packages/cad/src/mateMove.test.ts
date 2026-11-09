import { describe, expect, it } from 'vitest';
import {
  applyCadVariables,
  cadVariableUses,
  createCadDocument,
  createPlateDocument,
  mateMove,
  placePoint,
  resolveDrawnPlacements,
  resolvePartPatterns,
  setCadVariable,
  unmovedPick,
  type CadDocument,
  type CadPart,
} from './index';

const close = (actual: readonly number[], expected: readonly number[]) => expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 6));
const plate = (): CadPart => ({
  ...createPlateDocument({ width: 100, height: 100, thickness: 20 }).parts[0]!,
  drawnOn: { on: { plane: 'top' }, offset: 0 },
});
// The plate's top corner, with its top facing up, onto a point on a face that looks along -x.
const from = { point: [100, 100, 20] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
const to = { point: [300, 0, 50] as [number, number, number], normal: [-1, 0, 0] as [number, number, number] };

describe('mate connectors', () => {
  it('turns a part so its face meets the other, facing it, with the two points touching', () => {
    const moved = mateMove(from, to);
    expect(moved.turn?.degrees).toBeCloseTo(90, 6);
    const { document } = resolveDrawnPlacements({ ...createCadDocument(), parts: [{ ...plate(), moved }] });
    const placed = document.parts[0]!.placement!;
    close(placePoint(placed, [100, 100, 20]), [300, 0, 50]);
    // The top now looks along +x, against the face looking along -x.
    close(placePoint(placed, [100, 100, 21]), [301, 0, 50]);
  });

  it('only moves a part whose face already looks against the other', () => {
    expect(mateMove(from, { point: [0, 0, 50], normal: [0, 0, -1] })).toEqual({ by: [-100, -100, 30] });
  });

  it('finds where a point picked on a moved part was before the move', () => {
    const moved = mateMove(from, to);
    const back = unmovedPick({ point: [301, 0, 50], normal: [1, 0, 0] }, moved);
    close(back.point, [100, 100, 21]);
    close(back.normal, [0, 0, 1]);
  });

  it('turns a copy the same way, from wherever the part is', () => {
    const { by, turn } = mateMove(from, to);
    const part: CadPart = {
      ...plate(),
      placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      copies: [{ id: 'c', offset: { position: by, rotation: [0, 0, 0, 1] }, turn }],
    };
    const copy = resolvePartPatterns({ ...createCadDocument(), parts: [part] }).parts[0]!.copies![0]!;
    close(placePoint(copy.placement, [100, 100, 20]), [300, 0, 50]);
    close(placePoint(copy.placement, [100, 100, 21]), [301, 0, 50]);
  });
});

describe('a turn typed with variables', () => {
  const turned = (): CadDocument => ({
    ...createCadDocument(),
    variables: [
      { id: 'a', name: 'tilt', expression: '60 deg' },
      { id: 'l', name: 'lift', expression: '45 mm' },
    ],
    parts: [
      {
        ...plate(),
        moved: {
          by: [0, 0, 30],
          byExpressions: [null, null, 'lift'],
          turn: { about: [0, 0, 0], axis: [0, 0, 1], degrees: 30, degreesExpression: 'tilt' },
        },
        copies: [
          {
            id: 'c',
            offset: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            turn: { about: [0, 0, 0], axis: [0, 0, 1], degrees: 30, degreesExpression: 'tilt' },
          },
        ],
      },
    ],
  });

  it('follows them, and keeps turning as the move follows its own', () => {
    const part = applyCadVariables(turned()).parts[0]!;
    expect(part.moved).toMatchObject({ by: [0, 0, 45], turn: { degrees: 60 } });
    expect(part.copies![0]!.turn).toMatchObject({ degrees: 60 });
  });

  it('counts the angle as a use of the variable, and carries a rename through', () => {
    const document = turned();
    expect(cadVariableUses(document, 'tilt')).toBe(2);
    const renamed = setCadVariable(document, { id: 'a', name: 'slant', expression: '60 deg' });
    if ('error' in renamed) throw new Error(renamed.error);
    const part = renamed.document.parts[0]!;
    expect(part.moved).toMatchObject({ turn: { degreesExpression: 'slant', degrees: 60 } });
    expect(part.copies![0]!.turn).toMatchObject({ degreesExpression: 'slant' });
  });
});
