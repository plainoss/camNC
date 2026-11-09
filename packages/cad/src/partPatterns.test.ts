import { describe, expect, it } from 'vitest';
import {
  assemblyReport,
  cadPartsToCut,
  createCadDocument,
  createPlateDocument,
  parseCadDocument,
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
});
