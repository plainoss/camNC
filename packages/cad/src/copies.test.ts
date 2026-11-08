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
