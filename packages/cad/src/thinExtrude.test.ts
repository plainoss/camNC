import { describe, expect, it } from 'vitest';
import {
  addLine,
  assemblyReport,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  parseCadDocument,
  placePoint,
  setCadVariable,
  solveCadDocument,
  type CadDocument,
  type CadPart,
} from './index';

/** Where a part's flat outline sits in the studio, as the extent of its corners at both faces. */
function extent(document: CadDocument, partId: string) {
  const part = document.parts.find(candidate => candidate.id === partId)!;
  const shape = evaluateCadDocument(document).parts.find(candidate => candidate.partId === partId)!;
  const corners = shape.outline.flatMap(p => [0, part.thickness].map(z => placePoint(part.placement!, [p.x, p.y, z])));
  const round = (v: number) => Math.round(v * 1000) / 1000 + 0;
  return [0, 1, 2].map(axis => [round(Math.min(...corners.map(c => c[axis]!))), round(Math.max(...corners.map(c => c[axis]!)))]);
}

/** The hanging shelf's side, standing on the right plane, and its back drawn edge-on on the side's inner face. */
function shelf(): { document: CadDocument; side: CadPart; back: CadPart } {
  const side: CadPart = { ...createPlateDocument({ width: 130, height: 500, thickness: 20 }).parts[0]!, name: 'Side' };
  side.drawnOn = { on: { plane: 'right' }, offset: 0 };
  let back: CadPart = { ...createCadPart('Back', 4), drawnOn: { on: { partId: side.id, face: 'top' }, offset: -10 } };
  back.sketch = addLine(back.sketch, { x1: 10, y1: 0, x2: 10, y2: 500 });
  back = { ...back, thin: { depth: 380, midPlane: true } };
  return { document: { ...createCadDocument(), parts: [side, back] }, side, back };
}

describe('thin boards', () => {
  it('stands a board drawn as a line on its line, as deep as its depth and centred on it, and cuts it flat', async () => {
    const { document, back } = shelf();
    const solved = await solveCadDocument(document);
    expect(solved.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    // The side's inner face is at x = 20. The back starts 10 mm into it and reaches 380 mm across; 4 mm thick about y = 10.
    expect(extent(solved.document, back.id)).toEqual([
      [10, 390],
      [8, 12],
      [0, 500],
    ]);
    const flat = solved.parts.find(part => part.partId === back.id)!;
    expect(flat.thickness).toBe(4);
    expect(flat.outline).toEqual([
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 380 },
      { x: 0, y: 380 },
    ]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document))).parts[1]!.thin).toEqual({ depth: 380, midPlane: true });
  });

  it('follows its depth variable, and grows beside its line when it isn’t centred', async () => {
    const { document, back } = shelf();
    const variable = setCadVariable(document, { name: 'span', expression: '300 mm' });
    if ('error' in variable) throw new Error(variable.error);
    const withDepth: CadDocument = {
      ...variable.document,
      parts: variable.document.parts.map(part => (part.id === back.id ? { ...part, thin: { depth: 380, depthExpression: 'span' } } : part)),
    };
    const solved = await solveCadDocument(withDepth);
    const [x, y] = extent(solved.document, back.id);
    expect(x).toEqual([10, 310]);
    // Beside the line, to its right walking from its start: the line runs up +z on the side's face, which looks +x.
    expect(y![1]! - y![0]!).toBe(4);
    expect([y![0], y![1]]).toContain(10);
    expect(assemblyReport(solved.document, solved.parts)!.parts.map(part => part.name)).toEqual(['Side', 'Back']);
  });

  it('says what’s wrong with a thin board that isn’t one line', () => {
    const { document, back } = shelf();
    const broken = {
      ...document,
      parts: document.parts.map(part =>
        part.id === back.id ? { ...part, sketch: addLine(part.sketch, { x1: 10, y1: 500, x2: 100, y2: 500 }) } : part
      ),
    };
    expect(evaluateCadDocument(broken).diagnostics.map(d => d.code)).toContain('thin-profile');
  });
});
