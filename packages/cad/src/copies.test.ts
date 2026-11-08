import { describe, expect, it } from 'vitest';
import {
  addPartCopy,
  assemblyReport,
  createPlateDocument,
  evaluateCadDocument,
  mirrorEvaluatedPart,
  mirroredPartId,
  parseCadDocument,
  polygonArea,
  removePartCopy,
  setCadVariable,
  setPartPlacements,
  setPartCopyOffset,
  solveCadDocument,
  type CadDocument,
} from './index';

const plate = () => createPlateDocument({ width: 300, height: 600, thickness: 18 });

describe('copies of a part', () => {
  it('adds and removes copies, and saves them', () => {
    const document = plate(),
      partId = document.parts[0]!.id;
    const added = addPartCopy(document, partId, { mirrored: true });
    expect(added.document.parts[0]!.copies).toEqual([{ id: added.id, mirrored: true }]);
    expect(added.document.revision).toBe(document.revision + 1);
    expect(parseCadDocument(JSON.parse(JSON.stringify(added.document)))).toEqual(added.document);
    expect(removePartCopy(added.document, partId, added.id).parts[0]).not.toHaveProperty('copies');
  });

  it('places a copy on its own, and its typed position follows variables', () => {
    let document: CadDocument = plate();
    const partId = document.parts[0]!.id;
    const { document: withCopy, id } = addPartCopy(document, partId);
    document = setPartPlacements(withCopy, [
      { partId, copyId: id, placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1], positionExpressions: ['width - 18mm', null, null] } },
    ]);
    const result = setCadVariable(document, { name: 'width', expression: '600mm' });
    if ('error' in result) throw new Error(result.error);
    expect(result.document.parts[0]!.placement).toBeUndefined();
    expect(result.document.parts[0]!.copies![0]!.placement!.position).toEqual([582, 0, 0]);
  });

  it('mirrors a part across its sketch’s y axis, keeping its area and the way its loops run', () => {
    const part = evaluateCadDocument(plate()).parts[0]!;
    const mirrored = mirrorEvaluatedPart(part);
    expect(mirrored.partId).toBe(mirroredPartId(part.partId));
    expect(Math.min(...mirrored.outline.map(p => p.x))).toBeCloseTo(-300, 9);
    expect(Math.max(...mirrored.outline.map(p => p.x))).toBeCloseTo(0, 9);
    expect(polygonArea(mirrored.outline)).toBeCloseTo(polygonArea(part.outline), 9);
  });

  it('finds a copy placed where its part already is', () => {
    const document = plate(),
      partId = document.parts[0]!.id;
    const { document: withCopy, id } = addPartCopy(document, partId);
    const at = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] };
    const placed = setPartPlacements(withCopy, [
      { partId, placement: at },
      { partId, copyId: id, placement: { ...at, position: [100, 0, 0] } },
    ]);
    expect(assemblyReport(placed, evaluateCadDocument(placed).parts)!.collisions.map(clash => clash.parts)).toEqual([['Plate', 'Plate 2']]);
  });
});

describe('transformed copies', () => {
  it('sits where its offset puts it from the part, follows the part and a variable, and saves', async () => {
    let document = createPlateDocument({ width: 130, height: 500, thickness: 20 });
    const side = document.parts[0]!;
    side.placement = { position: [10, 0, 0], rotation: [0, 0, 0, 1] };
    const variable = setCadVariable(document, { name: 'breite', expression: '400 mm' });
    if ('error' in variable) throw new Error(variable.error);
    document = variable.document;
    const added = addPartCopy(document, side.id, {
      offset: { position: [380, 0, 0], rotation: [0, 0, 0, 1], positionExpressions: ['breite - 20mm', null, null] },
    });
    document = added.document;
    expect(document.parts[0]!.copies![0]!.placement!.position).toEqual([390, 0, 0]);
    let solved = await solveCadDocument(document);
    expect(solved.document.parts[0]!.copies![0]!.placement!.position).toEqual([390, 0, 0]);
    // The part moves, and the variable changes: the copy follows both.
    const moved = setCadVariable(
      { ...solved.document, parts: [{ ...solved.document.parts[0]!, placement: { position: [0, 5, 0], rotation: [0, 0, 0, 1] } }] },
      { id: solved.document.variables![0]!.id, name: 'breite', expression: '600 mm' }
    );
    if ('error' in moved) throw new Error(moved.error);
    solved = await solveCadDocument(moved.document);
    expect(solved.document.parts[0]!.copies![0]!.placement!.position).toEqual([580, 5, 0]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document))).parts[0]!.copies).toEqual(solved.document.parts[0]!.copies);
    // Changing the offset moves it, and it can be the part's mirror image.
    const changed = setPartCopyOffset(solved.document, side.id, added.id, {
      offset: { position: [-200, 0, 0], rotation: [0, 0, 0, 1] },
      mirrored: true,
    });
    expect(changed.parts[0]!.copies![0]).toMatchObject({ mirrored: true, placement: { position: [-200, 5, 0] } });
  });

  it('places an unplaced part at the origin once it has a transformed copy, so the copy sits where its offset says', () => {
    const source = plate();
    const part = source.parts[0]!;
    const added = addPartCopy(source, part.id, { offset: { position: [250, 0, 0], rotation: [0, 0, 0, 1] } }).document;
    expect(added.parts[0]!.copies![0]!.placement!.position).toEqual([250, 0, 0]);
    const report = assemblyReport(added, evaluateCadDocument(added).parts)!;
    expect(report.parts.map(entry => entry.name)).toEqual([part.name, `${part.name} 2`]);
  });
});
