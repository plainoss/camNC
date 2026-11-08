import { describe, expect, it } from 'vitest';
import {
  createPlateDocument,
  evaluateCadDocument,
  parseCadDocument,
  placeAgainst,
  placementMatrix,
  placePoint,
  rotateVector,
  turnAbout,
  setPartPlacements,
  type CadPlacement,
  type Vec3,
} from './index';

const close = (actual: readonly number[], expected: readonly number[]) =>
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 9));
const facing = (placement: CadPlacement, normal: Vec3) => rotateVector(placement.rotation, normal);

describe('putting one face against another', () => {
  it('stands a flat part up against a side face, its clicked point on the clicked point', () => {
    const placed = placeAgainst(undefined, { point: [10, 10, 18], normal: [0, 0, 1] }, { point: [100, 0, 50], normal: [-1, 0, 0] });
    close(facing(placed, [0, 0, 1]), [1, 0, 0]);
    close(placePoint(placed, [10, 10, 18]), [100, 0, 50]);
    // A quarter turn stays an exact quarter turn.
    close(placed.rotation, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  });

  it('turns a part over to put its top against another top', () => {
    const placed = placeAgainst(undefined, { point: [0, 0, 18], normal: [0, 0, 1] }, { point: [5, 5, 18], normal: [0, 0, 1] });
    close(facing(placed, [0, 0, 1]), [0, 0, -1]);
    close(placePoint(placed, [0, 0, 18]), [5, 5, 18]);
  });

  it('only moves a part whose face already faces the other', () => {
    const start: CadPlacement = { position: [0, 0, 100], rotation: [0, 0, 0, 1] };
    const placed = placeAgainst(start, { point: [20, 30, 100], normal: [0, 0, -1] }, { point: [20, 30, 18], normal: [0, 0, 1] });
    expect(placed).toEqual({ position: [0, 0, 18], rotation: [0, 0, 0, 1] });
  });

  it('builds on where the part already is', () => {
    const upright = placeAgainst(undefined, { point: [0, 0, 0], normal: [0, 0, -1] }, { point: [0, 0, 0], normal: [1, 0, 0] });
    // Its underside now faces -x; put that against a face looking +x at x = 300.
    const moved = placeAgainst(
      upright,
      { point: placePoint(upright, [50, 50, 0]), normal: facing(upright, [0, 0, -1]) },
      { point: [300, 0, 0], normal: [1, 0, 0] }
    );
    close(facing(moved, [0, 0, -1]), [-1, 0, 0]);
    close(placePoint(moved, [50, 50, 0]), [300, 0, 0]);
  });

  it('turns a placed part a quarter turn about the face it sits on, keeping the contact point', () => {
    const placed = placeAgainst(undefined, { point: [0, 0, 0], normal: [0, 0, -1] }, { point: [10, 10, 18], normal: [0, 0, 1] });
    const turned = turnAbout(placed, [10, 10, 18], [0, 0, 1], 90);
    close(placePoint(turned, [0, 0, 0]), [10, 10, 18]);
    close(placePoint(turned, [1, 0, 0]), [10, 11, 18]);
    expect(turned.rotation).toEqual([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
    expect(turnAbout(turned, [10, 10, 18], [0, 0, 1], 90).rotation).toEqual([0, 0, 1, 0]);
  });

  it('gives the same matrix as placing points one at a time', () => {
    const placement = placeAgainst(undefined, { point: [3, 4, 18], normal: [0, 0, 1] }, { point: [7, -2, 9], normal: [0, 1, 0] });
    const m = placementMatrix(placement),
      p: Vec3 = [12, -5, 7];
    close(
      [0, 1, 2].map(r => m[r]! * p[0] + m[4 + r]! * p[1] + m[8 + r]! * p[2] + m[12 + r]!),
      placePoint(placement, p)
    );
  });
});

describe('saved placements', () => {
  it('never change the part itself, and survive saving', () => {
    const document = createPlateDocument({ width: 300, height: 600 });
    const placed = setPartPlacements(document, [
      { partId: document.parts[0]!.id, placement: { position: [10, 0, 0], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] } },
    ]);
    expect(placed.revision).toBe(document.revision + 1);
    expect(evaluateCadDocument(placed).parts).toEqual(evaluateCadDocument(document).parts);
    expect(parseCadDocument(JSON.parse(JSON.stringify(placed))).parts[0]!.placement).toEqual(placed.parts[0]!.placement);
    expect(setPartPlacements(placed, [{ partId: document.parts[0]!.id, placement: undefined }]).parts[0]).not.toHaveProperty('placement');
  });

  it('refuses a rotation that isn’t a unit quaternion', () => {
    const document = createPlateDocument();
    document.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 2] };
    expect(() => parseCadDocument(document)).toThrow('Invalid CAD placement');
  });
});
