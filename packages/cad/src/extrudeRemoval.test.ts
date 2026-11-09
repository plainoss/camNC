import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  addCircle,
  addRectangle,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  cadPartsToCut,
  evaluateCadDocument,
  parseCadDocument,
  partIsBuiltOn,
  resolveDrawnPlacements,
  solveCadDocument,
  type CadDocument,
  type CadPart,
} from './index';
import { withPartCuts } from './cutParts';

function design(depth: number | 'through' = 6): CadDocument {
  const board = {
    ...createPlateDocument({ width: 100, height: 100, thickness: 18 }).parts[0]!,
    id: 'board',
    drawnOn: { on: { plane: 'top' as const }, offset: 0 },
  };
  const tool: CadPart = {
    ...createCadPart('Removal', 10),
    id: 'tool',
    drawnOn: { on: { plane: 'top' }, offset: 18, inward: true },
    remove: { depth },
  };
  tool.sketch = addRectangle(tool.sketch, { x: 20, y: 30, width: 40, height: 20 });
  return resolveDrawnPlacements({ ...createCadDocument(), parts: [board, tool] }).document;
}
const errors = (document: CadDocument) => evaluateCadDocument(document).diagnostics.filter(problem => problem.severity === 'error');
const cut = (document: CadDocument) => evaluateCadDocument(document).parts[0]!.cuts![0]!;

describe('positioned Extrude Remove', () => {
  it('cuts a blind volume from a default plane and passes the same cut to CAM and individual-part views', () => {
    const document = design();
    expect(errors(document)).toEqual([]);
    expect(cut(document)).toMatchObject({ side: 'top', from: 0, to: 6, through: false });
    const evaluated = evaluateCadDocument(document);
    expect(cadPartsToCut(document, evaluated.parts)).toHaveLength(1);
    const original = evaluateCadDocument({ ...document, parts: [document.parts[0]!] }).parts[0]!;
    expect(withPartCuts(document, original).cuts).toEqual(evaluated.parts[0]!.cuts);
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('uses direction, offset and symmetric extent rather than the source part thickness', () => {
    const document = design(12);
    const tool = document.parts[1]!;
    tool.symmetric = true;
    tool.drawnOn!.offset = 18;
    expect(cut(document).to).toBeCloseTo(6);
    delete tool.symmetric;
    tool.drawnOn!.offset = 21;
    expect(cut(document).to).toBeCloseTo(9);
    tool.drawnOn!.inward = false;
    expect(errors(document)[0]!.message).toMatch(/cuts nothing/);
  });

  it('cuts through all in the chosen direction and can limit its scope', () => {
    const document = design('through');
    expect(cut(document)).toMatchObject({ to: 18, through: true });
    document.parts[1]!.remove!.targets = [];
    expect(errors(document)[0]!.message).toMatch(/Pick a part/);
    document.parts[1]!.remove!.targets = ['board'];
    expect(errors(document)).toEqual([]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(document))).parts[1]!.remove!.targets).toEqual(['board']);
  });

  it('cuts a round profile through a parallel face', () => {
    const document = design();
    document.parts[1]!.sketch = addCircle(createCadPart().sketch, { x: 50, y: 50, radius: 10 });
    expect(errors(document)).toEqual([]);
    expect(cut(document).outline.length).toBeGreaterThan(4);
  });

  it('follows an up-to face after solving', async () => {
    const document = design();
    document.parts[1]!.upTo = { partId: 'board', face: 'underside' };
    const solved = await solveCadDocument(document);
    expect(solved.status).toBe('solved');
    expect(solved.document.parts[1]!.thickness).toBe(18);
    expect(solved.parts[0]!.cuts![0]).toMatchObject({ through: true, to: 18 });
  });

  it('uses inward as the default for a face Remove up to the opposite face', async () => {
    const document = design();
    document.parts[1]!.drawnOn = { on: { partId: 'board', face: 'top' }, offset: 0 };
    document.parts[1]!.upTo = { partId: 'board', face: 'underside' };
    const solved = await solveCadDocument(document);
    expect(solved.document.parts[1]!.thickness).toBe(18);
    expect(solved.parts[0]!.cuts![0]).toMatchObject({ through: true, to: 18 });
  });

  it('rejects invalid saved removal scopes', () => {
    const document = design();
    const malformed = JSON.parse(JSON.stringify(document));
    malformed.parts[1].remove.targets = 'board';
    expect(() => parseCadDocument(malformed)).toThrow(/remove targets/);
  });

  it('suppresses the removal without leaving cuts behind', () => {
    const document = design();
    document.parts[1]!.suppressed = true;
    expect(errors(document)).toEqual([]);
    expect(evaluateCadDocument(document).parts[0]!.cuts).toBeUndefined();
  });
});

describe('editing an earlier extrusion', () => {
  const saved = () =>
    parseCadDocument(
      JSON.parse(readFileSync(new URL('../../cad-script/fixtures/designs/extrude-operation-history.json', import.meta.url), 'utf8'))
    );
  it('keeps a later split cut when New becomes an Add of a separate sketch', async () => {
    const document = saved();
    const [board, tool] = document.parts as [CadPart, CadPart];
    expect(partIsBuiltOn(document, tool)).toMatch(/stays a part/);
    expect(partIsBuiltOn(document, tool, board)).toBeNull();
    const before = await solveCadDocument(structuredClone(document));
    tool.addTo = board.id;
    const after = await solveCadDocument(document);
    expect(after.status).toBe('solved');
    expect(after.diagnostics.filter(problem => problem.severity === 'error')).toEqual([]);
    expect(after.document.partCuts).toEqual(before.document.partCuts);
    expect(after.parts).toEqual(before.parts);
    expect(cadPartsToCut(after.document, after.parts)).toHaveLength(2);
  });

  it('cuts the saved perpendicular board from its top-plane sketch', async () => {
    const document = saved();
    delete document.partCuts;
    document.parts[1]!.remove = { depth: document.parts[1]!.thickness };
    const solved = await solveCadDocument(document);
    expect(solved.status).toBe('solved');
    expect(solved.diagnostics.filter(problem => problem.severity === 'error')).toEqual([]);
    expect(solved.parts[0]!.cuts).toHaveLength(1);
    expect(solved.parts[0]!.cuts![0]).toMatchObject({ through: true, to: 18 });
    expect(cadPartsToCut(solved.document, solved.parts)).toHaveLength(1);
  });
});
