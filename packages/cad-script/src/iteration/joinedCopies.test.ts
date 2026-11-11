import { addRectangle, cadPartsToCut, createCadPart, parseCadDocument, polygonArea, solveCadDocument, type CadDocument } from '@wbcnc/cad';
import { profileFeatures } from '@wbcnc/cam';
import { expect, it } from 'vitest';
import { fullCadReport } from '../fullReport';
import { inspectCadDocument } from '../inspect';
import { cadViewBodies } from '../views/geometry';
import { axisMaterial } from './axisMaterial';
import { loadWoodworkingSource, sourcePart, sourceVariable } from './woodworkingChecks';

function cleat(document: CadDocument, name: string, host: string, x: number, y: number, width: number, height: number, hole = false) {
  const part = createCadPart(name, 6);
  part.sketch = addRectangle(part.sketch, { x, y, width, height, dimensioned: true, positioned: true });
  if (hole) part.sketch = addRectangle(part.sketch, { x: x + 5, y: y + 10, width: 4, height: 4, dimensioned: true, positioned: true });
  part.addTo = sourcePart(document, host).id;
  part.drawnOn = { on: { partId: part.addTo, face: 'top' }, offset: 0 };
  return part;
}

const expected = (shelves: number) =>
  [
    'Side',
    'Right side',
    'Bottom',
    'Top',
    'Back',
    ...Array.from({ length: shelves }, (_, i) => (i ? `Shelf ${i + 1}` : 'Shelf')),
    'Side cleat',
    'Side cleat · Right side',
    ...Array.from({ length: shelves }, (_, i) => (i ? `Shelf cleat · Shelf ${i + 1}` : 'Shelf cleat')),
  ].sort();

it('carries legacy joined material through a complete cabinet, edits, reload, physical views and CAM', async () => {
  const raw = await loadWoodworkingSource('task-start-cupboard-three-shelves');
  const side = cleat(raw, 'Side cleat', 'Side', 40, 120, 30, 30, true);
  const shelf = cleat(raw, 'Shelf cleat', 'Shelf', 60, 90, 24, 40);
  const eightPieceSource = { ...sourceVariable(raw, 'shelves', '1'), parts: [...raw.parts, side] };
  const eightPieceInspection = await inspectCadDocument(eightPieceSource, new Map(), { toolpaths: false });
  const eightPieceReport = await fullCadReport(eightPieceInspection.document, eightPieceInspection);
  const eightNames = ['Side', 'Right side', 'Bottom', 'Top', 'Back', 'Shelf', 'Side cleat', 'Side cleat · Right side'].sort();
  expect(eightPieceReport.boards.flatMap(board => board.parts.map(part => part.name)).sort()).toEqual(eightNames);
  expect(eightPieceReport.assembly?.parts.map(part => part.name).sort()).toEqual(eightNames);
  expect(eightPieceReport.unplanned ?? []).toEqual([]);
  expect(eightPieceReport.features.filter(feature => feature.part === 'Side cleat' && feature.kind === 'copy')).toEqual([]);
  let document = { ...raw, parts: [...raw.parts, side, shelf] };
  const ids = document.parts.map(part => part.id);
  let copyIds: string[] = [];
  for (const [count, width] of [
    [1, 800],
    [3, 800],
    [2, 900],
    [3, 900],
  ] as const) {
    document = parseCadDocument(
      JSON.parse(JSON.stringify(sourceVariable(sourceVariable(document, 'shelves', String(count)), 'width', `${width}mm`)))
    );
    const before = JSON.stringify(document);
    const result = await solveCadDocument(document);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    const pieces = cadPartsToCut(result.document, result.parts);
    expect(pieces.flatMap(piece => piece.names).sort()).toEqual(expected(count));
    expect(result.document.parts.map(part => part.id)).toEqual(ids);
    expect(result.document.version).toBeLessThan(4);
    expect(result.document.parts.find(part => part.id === side.id)!.copies).toBeUndefined();
    expect(result.document.parts.find(part => part.id === shelf.id)!.copies).toBeUndefined();
    const current = sourcePart(result.document, 'Shelf').copies?.map(copy => copy.id) ?? [];
    if (count === 3 && !copyIds.length) copyIds = current;
    else if (copyIds.length) expect(current).toEqual(copyIds.slice(0, count - 1));
    const bodies = cadViewBodies(result.document, result.parts);
    expect(bodies.map(body => body.name).sort()).toEqual(expected(count));
    const mirrored = bodies.find(body => body.name === 'Side cleat · Right side')!;
    const material = axisMaterial(mirrored.shape, mirrored.placement!);
    expect(material.volume).toBeCloseTo((30 * 30 - 4 * 4) * 6, 6);
    expect(material.bounds.min).toEqual([width - 24, 40, 120]);
    expect(material.bounds.max).toEqual([width - 18, 70, 150]);
    expect(material.containsWorld([width - 21, 47, 132])).toBe(false);
    expect(material.containsWorld([width - 21, 60, 140])).toBe(true);
    for (const [name, quantity, area] of [
      ['Side cleat', 2, 884],
      ['Shelf cleat', count, 960],
    ] as const) {
      const groups = pieces.filter(piece => piece.names.some(pieceName => pieceName === name || pieceName.startsWith(`${name} · `)));
      expect(groups.reduce((total, group) => total + group.names.length, 0)).toBe(quantity);
      for (const group of groups) {
        expect(
          Math.abs(polygonArea(group.part.outline)) - group.part.holes.reduce((total, hole) => total + Math.abs(polygonArea(hole)), 0)
        ).toBe(area);
        const handoff = profileFeatures(group.part);
        expect(handoff.problem).toBeUndefined();
        expect(handoff.features.levels.reduce((volume, level) => volume + level.z * level.area, 0)).toBeCloseTo(area * 6, 6);
      }
    }
    const inspected = await inspectCadDocument(result.document, new Map(), { toolpaths: false });
    expect(inspected.report.errors).toEqual([]);
    expect(inspected.report.assembly?.parts.map(part => part.name).sort()).toEqual(expected(count));
    expect(inspected.report.assembly?.collisions).toEqual([]);
    expect(inspected.report.parts.find(part => part.name === 'Side cleat')!.pieces).toEqual({
      names: ['Side cleat'],
      mirrored: ['Side cleat · Right side'],
    });
    const shelfReport = inspected.report.parts.find(part => part.name === 'Shelf cleat')!;
    expect(shelfReport.pieces?.names ?? [shelfReport.name]).toEqual(
      expected(count).filter(name => name === 'Shelf cleat' || name.startsWith('Shelf cleat · '))
    );
    expect(JSON.stringify(document)).toBe(before);
    document = result.document;
  }
});
