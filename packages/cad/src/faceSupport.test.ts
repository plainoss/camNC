import { describe, expect, it } from 'vitest';
import {
  addCircle,
  addCopyFaceSketch,
  cadSketchRegions,
  createPlateDocument,
  evaluatedPartCopy,
  setCopyCutDepth,
  setCutDepth,
  setPartPattern,
  solveCadDocument,
  type CadDocument,
  type CadFaceRef,
} from './index';
import { faceSupportShape } from './faceSupport';

function undersidePocket(document: CadDocument, copyId: string, on: CadFaceRef, radius: number, depth: number) {
  const partId = document.parts[0]!.id;
  const made = addCopyFaceSketch(document, partId, copyId, on);
  const part = made.document.parts[0]!;
  const face = part.features!.find(feature => feature.type === 'sketch' && feature.sketch.id === made.sketchId)!;
  if (face.type !== 'sketch') throw new Error('Missing face sketch');
  face.sketch = addCircle(face.sketch, { x: -225, y: 100, radius, dimensioned: true, positioned: true });
  const region = cadSketchRegions(part, made.sketchId).find(region =>
    region.points.every(point => Math.abs(point.x + 225) <= radius + 1e-6)
  )!;
  const next = setCutDepth(made.document, partId, made.sketchId, region.id, depth);
  return { document: next, cutId: next.parts[0]!.features!.at(-1)!.id };
}

describe('material on a selected copy face', () => {
  it.each([
    [0, false],
    [8, false],
    [0, true],
    [8, true],
  ] as const)(
    'keeps copy depth %d and mirrored %s separate from family holes, including underside pocket floors',
    async (depth, mirrored) => {
      let document = createPlateDocument({ width: 300, height: 200, thickness: 18 });
      document = setPartPattern(document, document.parts[0]!.id, { axis: 'z', count: 2, spacing: 100 });
      const source = document.parts[0]!;
      const copyId = source.copies![0]!.id;
      source.copies![0]!.mirrored = mirrored;
      source.sketch = addCircle(source.sketch, { x: 100, y: 100, radius: 6, dimensioned: true, positioned: true });
      const region = cadSketchRegions(source, source.sketch.id).find(region => region.curveIds.length === 1)!;
      document = setCopyCutDepth(document, source.id, copyId, source.sketch.id, region.id, depth);
      const parent = undersidePocket(document, copyId, 'underside', 12, 4);
      document = undersidePocket(parent.document, copyId, { floorOf: parent.cutId }, 5, 2).document;
      const solved = await solveCadDocument(document);
      expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
      const part = solved.document.parts[0]!;
      const copy = part.copies![0]!;
      const expected = evaluatedPartCopy(solved.parts[0]!, copy);
      const selected = faceSupportShape(part, copy)!;
      expect(selected.holes).toEqual([]);
      expect(selected.outline).toEqual(expected.outline);
      expect(selected.cuts).toEqual(expected.cuts);
      expect(selected.cuts!.map(cut => [cut.side, cut.from, cut.to])).toEqual([
        ...(depth ? [['top', 0, 8]] : []),
        ['underside', 0, 4],
        ['underside', 4, 6],
      ]);
      expect(faceSupportShape(part)!.holes).toHaveLength(1);
      expect(faceSupportShape(part)!.cuts ?? []).toEqual([]);
    }
  );
});
