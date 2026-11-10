import { describe, expect, it } from 'vitest';
import {
  assemblyReport,
  addPartMirror,
  cadCopyName,
  cadPartsToCut,
  createCadDocument,
  createPlateDocument,
  detachPartCopy,
  parseCadDocument,
  resolvePartPatterns,
  setPartPattern,
  solveCadDocument,
  type CadPart,
} from './index';

describe('part patterns', () => {
  it('lays copies along a picked edge, as it was picked', () => {
    let document = createPlateDocument({ width: 100, height: 50 });
    const part = document.parts[0]!;
    part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    document = setPartPattern(document, part.id, { axis: 'x', count: 3, spacing: 20, vector: [0, 0.6, 0.8] });
    expect(document.parts[0]!.copies!.map(copy => copy.placement!.position.map(value => +value.toFixed(6)))).toEqual([
      [0, 12, 16],
      [0, 24, 32],
    ]);
    // Saved and opened again, it keeps the edge's direction; a broken one is refused.
    expect(parseCadDocument(JSON.parse(JSON.stringify(document))).parts[0]!.pattern!.vector).toEqual([0, 0.6, 0.8]);
    const broken = JSON.parse(JSON.stringify(document));
    broken.parts[0].pattern.vector = [0, 0, 0];
    expect(() => parseCadDocument(broken)).toThrow(/pattern vector/);
  });

  it('keeps a picked direction, flips it and clears back to the saved axis', () => {
    let document = createPlateDocument({ width: 100, height: 50 });
    const part = document.parts[0]!;
    part.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    document = setPartPattern(document, part.id, { axis: 'x', count: 3, spacing: 20, direction: { along: { plane: 'front' } } });
    expect(document.parts[0]!.pattern!.direction).toEqual({ along: { plane: 'front' } });
    expect(document.parts[0]!.copies!.map(copy => copy.placement!.position)).toEqual([
      [0, -20, 0],
      [0, -40, 0],
    ]);
    document = setPartPattern(document, part.id, {
      axis: 'x',
      count: 3,
      spacing: 20,
      direction: { along: { plane: 'front' }, flip: true },
    });
    expect(document.parts[0]!.copies!.map(copy => copy.placement!.position)).toEqual([
      [0, 20, 0],
      [0, 40, 0],
    ]);
    document = setPartPattern(document, part.id, { axis: 'x', count: 3, spacing: 20 });
    expect(document.parts[0]!.pattern).not.toHaveProperty('direction');
    expect(document.parts[0]!.copies!.map(copy => copy.placement!.position)).toEqual([
      [20, 0, 0],
      [40, 0, 0],
    ]);
  });

  it('lays out the copies of an unplaced part once another part is drawn on it', async () => {
    const base: CadPart = { ...createPlateDocument({ width: 100, height: 50 }).parts[0]!, name: 'Base' };
    let document = setPartPattern({ ...createCadDocument(), parts: [base] }, base.id, { axis: 'x', count: 3, spacing: 200 });
    // Nothing places the base yet, so neither are its copies.
    expect(document.parts[0]!.copies!.every(copy => !copy.placement)).toBe(true);
    const cap: CadPart = {
      ...createPlateDocument({ width: 100, height: 50 }).parts[0]!,
      name: 'Cap',
      drawnOn: { on: { partId: base.id, face: 'top' }, offset: 0 },
    };
    document = { ...document, parts: [...document.parts, cap] };
    const solved = await solveCadDocument(document);
    const report = assemblyReport(solved.document, solved.parts)!;
    expect(report.parts.map(part => part.name).sort()).toEqual(['Base', 'Base 2', 'Base 3', 'Cap']);
    expect(solved.document.parts[0]!.copies!.map(copy => copy.placement?.position[0])).toEqual([200, 400]);
    expect(
      cadPartsToCut(solved.document, solved.parts)
        .flatMap(piece => piece.names)
        .sort()
    ).toEqual(['Base', 'Base 2', 'Base 3', 'Cap']);
  });
  it('keeps mirrors tied to the same surviving logical copy after detaching a neighbour and changing the pattern', () => {
    const target = createPlateDocument({ width: 80, height: 40, thickness: 18 }).parts[0]!;
    target.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const shelf = createPlateDocument({ width: 100, height: 60, thickness: 19 }).parts[0]!;
    shelf.name = 'Shelf';
    shelf.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    let document = setPartPattern({ ...createCadDocument(), parts: [target, shelf] }, shelf.id, { axis: 'z', count: 4, spacing: 300 });
    const detachedId = document.parts[1]!.copies![0]!.id;
    const supportId = document.parts[1]!.copies![1]!.id;
    const detached = detachPartCopy(document, shelf.id, detachedId);
    if ('error' in detached) throw new Error(detached.error);
    document = detached.document;
    const made = addPartMirror(document, target.id, { across: { partId: shelf.id, copyId: supportId, face: 'top' } });
    document = made.document;
    expect(document.parts[0]!.copies![0]!.placement!.position[2]).toBeCloseTo(1238, 6);
    expect(document.parts[1]!.copies!.map((_, index) => cadCopyName(document.parts[1]!, index))).toEqual(['Shelf 3', 'Shelf 4']);
    document = setPartPattern(document, shelf.id, { axis: 'z', count: 2, spacing: 400 });
    expect(document.parts[1]!.copies ?? []).toEqual([]);
    // A missing picked copy never becomes its source or its detached neighbour.
    expect(document.parts[0]!.copies![0]!.placement!.position[2]).toBeCloseTo(1238, 6);
    document = setPartPattern(parseCadDocument(JSON.parse(JSON.stringify(document))), shelf.id, { axis: 'z', count: 4, spacing: 400 });
    expect(document.parts[1]!.copies!.map(copy => copy.id)).toEqual([supportId, `${document.parts[1]!.pattern!.id}:3`]);
    expect(document.parts[0]!.copies![0]!.id).toBe(made.id);
    expect(document.parts[0]!.copies![0]!.placement!.position[2]).toBeCloseTo(1638, 6);
    expect(document.parts.find(part => part.id === detached.partId)!.placement!.position).toEqual([0, 0, 300]);
    expect(document.version).toBe(3);
    expect(resolvePartPatterns(document)).toEqual(document);
  });
});
