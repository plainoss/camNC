import { describe, expect, it } from 'vitest';
import {
  createCadDocument,
  createPlateDocument,
  mateMove,
  placePoint,
  resolveDrawnPlacements,
  resolvePartPatterns,
  unmovedPick,
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
