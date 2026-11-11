import { CAD_IDENTITY_PLACEMENT, createCadDocument, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { framesInsert, instanceBoxes } from './insertFraming';
import type { StudioCameraState } from './studioCamera';

type Vec = [number, number, number];
const at = (position: Vec) => ({ ...CAD_IDENTITY_PLACEMENT, position });

function placedPlate() {
  const document = createPlateDocument({ width: 120, height: 80 });
  document.parts[0]!.placement = at([0, 0, 0]);
  return document;
}

/** The plate and one more of it, `placement` away; without one it is laid out in the row of unplaced parts. */
function withSecondPlate(document: CadDocument, placement?: Vec): CadDocument {
  const second = { ...structuredClone(document.parts[0]!), id: crypto.randomUUID(), name: 'Second', placement: placement && at(placement) };
  return { ...document, parts: [...document.parts, second] };
}

const top = (center: Vec, height: number, aspect?: number): StudioCameraState => ({
  center,
  back: [0, 0, 1],
  up: [0, 1, 0],
  height,
  aspect,
  key: 'assembled',
});

describe('framesInsert', () => {
  it('fits a design that listed nothing as soon as a listed part is added, and not before', () => {
    const blank = createCadDocument();
    blank.parts.push(createCadPart('Part 1'));
    const plate = placedPlate();
    expect(framesInsert(blank, { ...blank, parts: [...blank.parts, plate.parts[0]!] }, top([0, 0, 0], 1e6, 1))).toBe(true);
    expect(framesInsert(blank, { ...blank, name: 'Renamed' }, null)).toBe(false);
  });

  it('never moves the camera for a change that adds no part or copy', () => {
    const before = placedPlate();
    expect(framesInsert(before, { ...before, name: 'Renamed' }, null)).toBe(false);
    expect(framesInsert(before, structuredClone(before), top([0, 0, 0], 1, 1))).toBe(false);
  });

  it('takes the view’s width from its aspect', () => {
    const before = placedPlate();
    const after = withSecondPlate(before, [300, 0, 0]);
    const added = [...instanceBoxes(after).values()].find(box => box.min[0] >= 299)!;
    expect(added.max[0]).toBeCloseTo(420);
    // 100 mm tall: 1:1 shows x 162–258 around 210, 5:1 shows x -32–452 and holds both plates.
    expect(framesInsert(before, after, top([210, 40, 0], 100, 1))).toBe(true);
    expect(framesInsert(before, after, top([210, 40, 0], 100, 5))).toBe(false);
    // A part reaching right to the edge (half width 210 mm around 210) is refitted rather than left cut off.
    expect(framesInsert(before, after, top([210, 40, 0], 100, 210 / 50))).toBe(true);
  });

  it('projects corners into a tilted view', () => {
    const before = placedPlate();
    const after = withSecondPlate(before, [300, 0, 0]);
    const s3 = Math.sqrt(3),
      s6 = Math.sqrt(6);
    const iso = (height: number): StudioCameraState => ({
      center: [210, 40, 0],
      back: [1 / s3, -1 / s3, 1 / s3],
      up: [-1 / s6, 1 / s6, 2 / s6],
      height,
      aspect: 1.5,
      key: 'assembled',
    });
    expect(framesInsert(before, after, iso(1000))).toBe(false);
    expect(framesInsert(before, after, iso(60))).toBe(true);
  });

  it('fits when it can’t tell what the view shows', () => {
    const before = placedPlate();
    const after = withSecondPlate(before, [300, 0, 0]);
    expect(framesInsert(before, after, { ...top([0, 0, 0], 1e6, 1), key: 'exploded' })).toBe(true);
    expect(framesInsert(before, after, top([0, 0, 0], 1e6))).toBe(true);
    expect(framesInsert(before, after, null)).toBe(true);
  });

  it('counts an unplaced part where the view lays it out', () => {
    const before = placedPlate();
    const after = withSecondPlate(before);
    expect(instanceBoxes(after).size).toBe(2);
    expect(framesInsert(before, after, top([60, 40, 0], 100, 1.5))).toBe(true);
    expect(framesInsert(before, after, top([60, 40, 0], 1e4, 1.5))).toBe(false);
  });

  it('counts an added copy', () => {
    const before = placedPlate();
    const after = structuredClone(before);
    after.parts[0]!.copies = [{ id: crypto.randomUUID(), placement: at([0, 300, 0]) }];
    expect(instanceBoxes(after).size).toBe(2);
    expect(framesInsert(before, after, top([60, 40, 0], 100, 1.5))).toBe(true);
    expect(framesInsert(before, after, top([60, 200, 0], 1000, 1.5))).toBe(false);
  });
});
