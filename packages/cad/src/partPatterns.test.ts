import { describe, expect, it } from 'vitest';
import {
  assemblyReport,
  cadPartsToCut,
  createCadDocument,
  createPlateDocument,
  setPartPattern,
  solveCadDocument,
  type CadPart,
} from './index';

describe('part patterns', () => {
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
