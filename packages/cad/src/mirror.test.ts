import { describe, expect, it } from 'vitest';
import { createCadDocument, createPlateDocument, parseCadDocument } from './document';
import { addPartMirror, resolvePartPatterns } from './partPatterns';
import { placePoint, type Vec3 } from './placement';
import type { CadPlacement } from './types';

const kStanding: CadPlacement['rotation'] = [0, -Math.SQRT1_2, 0, Math.SQRT1_2];

describe('a part mirrored across a plane', () => {
  it.each([
    ['lying flat', [0, 0, 0, 1] as CadPlacement['rotation']],
    ['standing', kStanding],
  ])('is its mirror image across the right plane when %s', (_label, rotation) => {
    const part = { ...createPlateDocument({ width: 100, height: 60, thickness: 18 }).parts[0]!, name: 'Side' };
    part.placement = { position: [30, 5, 7], rotation };
    const { document } = addPartMirror({ ...createCadDocument(), parts: [part] }, part.id, { across: { plane: 'right' } });
    const copy = document.parts[0]!.copies![0]!;
    expect(copy.mirrored).toBe(true);
    // Every corner of the part, at either face, has its mirror image (x turned to -x) on the copy.
    for (const [x, y, z] of [
      [0, 0, 0],
      [100, 0, 0],
      [100, 60, 18],
      [0, 60, 18],
    ] as Vec3[]) {
      const original = placePoint(part.placement, [x, y, z]);
      const mirrored = placePoint(copy.placement, [-x, y, z]);
      expect(mirrored[0]).toBeCloseTo(-original[0], 6);
      expect(mirrored[1]).toBeCloseTo(original[1], 6);
      expect(mirrored[2]).toBeCloseTo(original[2], 6);
    }
  });

  it('follows the part when it moves', () => {
    const part = {
      ...createPlateDocument({ width: 100, height: 60 }).parts[0]!,
      placement: { position: [30, 0, 0], rotation: [0, 0, 0, 1] } as CadPlacement,
    };
    const { document } = addPartMirror({ ...createCadDocument(), parts: [part] }, part.id, { across: { plane: 'right' } });
    const moved = resolvePartPatterns({
      ...document,
      parts: [{ ...document.parts[0]!, placement: { position: [50, 0, 0], rotation: [0, 0, 0, 1] } }],
    });
    expect(moved.parts[0]!.copies![0]!.placement!.position[0]).toBeCloseTo(-50, 6);
    expect(parseCadDocument(JSON.parse(JSON.stringify(document))).parts[0]!.copies![0]!.mirror).toEqual({ across: { plane: 'right' } });
  });
});
