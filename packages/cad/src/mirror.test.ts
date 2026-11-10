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

it.each([false, true])('mirrors across a physical copy face and follows its placement (mirrored support: %s)', mirrored => {
  const source = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const part = source.parts[0]!;
  part.placement = { position: [0, -19, 0], rotation: [0, 0, 0, 1] };
  const shelf = createPlateDocument({ width: 100, height: 600, thickness: 19 }).parts[0]!;
  shelf.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  shelf.copies = [{ id: 'shelf-copy', mirrored, placement: { position: [0, 0, 300], rotation: [0, 0, 0, 1] } }];
  source.parts.push(shelf);
  const edge = shelf.sketch.entities.find(entity => entity.type === 'line')!.id;
  const made = addPartMirror(source, part.id, { across: { partId: shelf.id, copyId: 'shelf-copy', face: { edge } } });
  // The first edge is y=0: reflecting the source's -19 origin puts it at +19, independent of shelf height.
  expect(made.document.parts[0]!.copies![0]!.placement!.position[1]).toBeCloseTo(19, 6);
  const moved = resolvePartPatterns({
    ...made.document,
    parts: made.document.parts.map(candidate =>
      candidate.id === shelf.id
        ? {
            ...candidate,
            copies: [{ ...candidate.copies![0]!, placement: { position: [0, 600, 300], rotation: [0, 0, 0, 1] } }],
          }
        : candidate
    ),
  });
  expect(moved.parts[0]!.copies![0]!.placement!.position[1]).toBeCloseTo(1219, 6);
  expect(parseCadDocument(JSON.parse(JSON.stringify(moved))).parts[0]!.copies![0]!.mirror).toEqual(
    made.document.parts[0]!.copies![0]!.mirror
  );
});

it('follows a picked pattern copy in the same edit, even when the mirrored part comes first', () => {
  const source = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const part = source.parts[0]!;
  part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const shelf = createPlateDocument({ width: 100, height: 60, thickness: 19 }).parts[0]!;
  shelf.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  shelf.pattern = { id: 'shelves', axis: 'z', count: 3, spacing: 300 };
  source.parts.push(shelf);
  const laid = resolvePartPatterns(source);
  const made = addPartMirror(laid, part.id, { across: { partId: shelf.id, copyId: 'shelves:2', face: 'top' } });
  expect(made.document.parts[0]!.copies![0]!.placement!.position[2]).toBeCloseTo(1238, 6);
  const moved = resolvePartPatterns({
    ...made.document,
    parts: made.document.parts.map(candidate =>
      candidate.id === shelf.id ? { ...candidate, pattern: { ...candidate.pattern!, spacing: 400 } } : candidate
    ),
  });
  expect(moved.parts[0]!.copies![0]!.placement!.position[2]).toBeCloseTo(1638, 6);
});

it('resolves mirror-face dependencies within one family in the same regeneration and refuses cycles', () => {
  const source = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const part = source.parts[0]!;
  part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const first = addPartMirror(source, part.id, { across: { plane: 'top' } });
  const second = addPartMirror(first.document, part.id, { across: { partId: part.id, copyId: first.id, face: 'top' } });
  expect(second.document.parts[0]!.copies![1]!.placement!.position[2]).toBeCloseTo(-36, 6);
  const changed = structuredClone(second.document);
  changed.parts[0]!.copies![0]!.mirror = { across: { partId: part.id, face: 'top' } };
  const next = resolvePartPatterns(changed);
  expect(next.parts[0]!.copies![1]!.placement!.position[2]).toBeCloseTo(36, 6);
  const cyclic = structuredClone(next);
  cyclic.parts[0]!.copies![0]!.mirror = { across: { partId: part.id, copyId: second.id, face: 'top' } };
  const stable = resolvePartPatterns(cyclic);
  expect(resolvePartPatterns(stable)).toEqual(stable);
  expect(stable.parts[0]!.copies!.map(copy => copy.placement)).toEqual(cyclic.parts[0]!.copies!.map(copy => copy.placement));
});

it('follows a joined body face inherited by a pattern copy in the same edit', () => {
  const source = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const target = source.parts[0]!;
  target.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const block = createPlateDocument({ width: 100, height: 100, thickness: 18 }).parts[0]!;
  block.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  block.pattern = { id: 'blocks', axis: 'z', count: 3, spacing: 300 };
  const boss = createPlateDocument({ width: 20, height: 20, thickness: 10 }).parts[0]!;
  boss.addTo = block.id;
  boss.placement = { position: [40, 40, 18], rotation: [0, 0, 0, 1] };
  source.parts.push(block, boss);
  const made = addPartMirror(resolvePartPatterns(source), target.id, { across: { partId: boss.id, copyId: 'blocks:2', face: 'top' } });
  expect(made.document.parts[0]!.copies![0]!.placement!.position[2]).toBeCloseTo(1256, 6);
  const next = resolvePartPatterns({
    ...made.document,
    parts: made.document.parts.map(part =>
      part.id === block.id
        ? {
            ...part,
            pattern: { ...part.pattern!, spacing: 400 },
          }
        : part
    ),
  });
  expect(next.parts[0]!.copies![0]!.placement!.position[2]).toBeCloseTo(1656, 6);
});
